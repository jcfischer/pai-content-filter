#!/usr/bin/env bun

/**
 * PreToolUse hook: Content filter security gate.
 *
 * Intercepts Read/Glob/Grep tool calls targeting shared repo paths.
 * Runs the content filter pipeline on the target file.
 *
 * Exit codes:
 *   0 — Allow (passthrough, clean content, or HUMAN_REVIEW)
 *   2 — Block (malicious content detected)
 *
 * Fail-open: any error → exit 0 (never block on infrastructure failure).
 *
 * Environment:
 *   CONTENT_FILTER_SHARED_DIR — directory prefix for shared repo paths (required)
 */

import { filterContent } from "../src/lib/content-filter";
import { existsSync } from "fs";

const GATED_TOOLS = new Set(["Read", "Glob", "Grep"]);

async function main(): Promise<void> {
  try {
    // Read stdin
    const chunks: Buffer[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf-8").trim();

    if (!raw) {
      process.exit(0); // fail-open: empty stdin
    }

    let input: { tool_name?: string; tool_input?: Record<string, unknown> };
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0); // fail-open: malformed JSON
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

    // Check if path is within shared repo directory
    const sharedDir = process.env.CONTENT_FILTER_SHARED_DIR;
    if (!sharedDir || !filePath.startsWith(sharedDir)) {
      process.exit(0); // not a shared path — passthrough
    }

    // Check file exists before filtering
    if (!existsSync(filePath)) {
      process.exit(0); // fail-open: file not found
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
    // Fail-open: any uncaught error → allow
    console.error(
      `[ContentFilter] Error (fail-open): ${e instanceof Error ? e.message : String(e)}`
    );
    process.exit(0);
  }
}

main();
