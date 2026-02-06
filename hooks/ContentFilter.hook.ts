#!/usr/bin/env bun

/**
 * PreToolUse hook: Content filter security gate.
 *
 * Intercepts Read/Glob/Grep tool calls targeting sandbox directory paths.
 * Any file under the sandbox directory is treated as untrusted external
 * content and must pass the content filter pipeline before an agent can
 * read it.
 *
 * Exit codes:
 *   0 — Allow (passthrough, clean content, or HUMAN_REVIEW)
 *   2 — Block (malicious content detected or infrastructure error)
 *
 * Fail-closed: any error in the filter pipeline → exit 2 (block on failure).
 * Use bypassFilter() to explicitly allow content that was blocked by error.
 *
 * Environment:
 *   CONTENT_FILTER_SANDBOX_DIR — directory where external content lives (required)
 *   CONTENT_FILTER_SHARED_DIR — deprecated alias (fallback if SANDBOX_DIR not set)
 */

import { filterContent } from "../src/lib/content-filter";
import { existsSync } from "fs";

const GATED_TOOLS = new Set(["Read", "Glob", "Grep"]);

async function main(): Promise<void> {
  try {
    // Read stdin with timeout — prevents hang if stdin never closes
    const raw = await Promise.race([
      Bun.stdin.text(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('stdin timeout')), 3000)
      ),
    ]).then(t => t.trim()).catch(() => '');

    if (!raw) {
      console.error("[ContentFilter] BLOCKED: empty stdin (fail-closed)");
      process.exit(2); // fail-closed: empty stdin
    }

    let input: { tool_name?: string; tool_input?: Record<string, unknown> };
    try {
      input = JSON.parse(raw);
    } catch {
      console.error("[ContentFilter] BLOCKED: malformed JSON input (fail-closed)");
      process.exit(2); // fail-closed: malformed JSON
    }

    const toolName = input.tool_name;
    const toolInput = input.tool_input;

    // Only gate Read/Glob/Grep
    if (!toolName || !GATED_TOOLS.has(toolName)) {
      process.exit(0); // passthrough
    }

    // Extract file path from tool input
    const filePath =
      typeof toolInput?.file_path === "string"
        ? toolInput.file_path
        : typeof toolInput?.path === "string"
          ? toolInput.path
          : null;

    if (!filePath) {
      process.exit(0); // no file path to gate
    }

    // Check if path is within sandbox directory
    const sandboxDir =
      process.env.CONTENT_FILTER_SANDBOX_DIR ??
      process.env.CONTENT_FILTER_SHARED_DIR; // deprecated fallback
    if (!sandboxDir || !filePath.startsWith(sandboxDir)) {
      process.exit(0); // not in sandbox — passthrough
    }

    // Check file exists before filtering
    if (!existsSync(filePath)) {
      console.error(`[ContentFilter] BLOCKED: file not found: ${filePath} (fail-closed)`);
      process.exit(2); // fail-closed: file not found
    }

    // Run content filter
    const result = filterContent(filePath);

    if (result.decision === "BLOCKED") {
      // Output block reason to stderr
      const patternIds = result.matches.map((m) => m.pattern_id).join(", ");
      const encodingTypes = result.encodings.map((e) => e.type).join(", ");
      const reasons: string[] = [];
      if (patternIds) reasons.push(`patterns: ${patternIds}`);
      if (encodingTypes) reasons.push(`encodings: ${encodingTypes}`);
      if (!result.schema_valid) reasons.push("schema validation failed");

      console.error(
        `[ContentFilter] BLOCKED: ${filePath} — ${reasons.join("; ")}`
      );
      process.exit(2);
    }

    // ALLOWED or HUMAN_REVIEW — allow through
    process.exit(0);
  } catch (e) {
    // Fail-closed: any uncaught error → block
    console.error(
      `[ContentFilter] BLOCKED (fail-closed): ${e instanceof Error ? e.message : String(e)}`
    );
    process.exit(2);
  }
}

main();
