#!/usr/bin/env bun

/**
 * PreToolUse hook: Sandbox enforcer for external content acquisition.
 *
 * Intercepts Bash tool calls and rewrites git clone, curl -o, wget -O,
 * and wget -P commands to target the sandbox directory.
 *
 * Exit codes:
 *   0 — Always (fail-open)
 *
 * Stdout JSON (when rewrite needed):
 *   { "updatedInput": { "command": "..." }, "permissionDecision": "allow" }
 *
 * In block mode:
 *   { "permissionDecision": "deny" }
 *
 * Environment:
 *   CONTENT_FILTER_SANDBOX_DIR — sandbox directory (required)
 *   CONTENT_FILTER_ENFORCER_MODE — "rewrite" (default) or "block"
 */

import {
  extractFirstCommand,
  tokenize,
  classifyCommand,
} from "../src/lib/command-parser";
import {
  rewriteCommand,
  buildHookOutput,
} from "../src/lib/sandbox-rewriter";
import type { EnforcerMode } from "../src/lib/types";

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

    // Only gate Bash tool
    if (input.tool_name !== "Bash") {
      process.exit(0);
    }

    const command =
      typeof input.tool_input?.command === "string"
        ? input.tool_input.command
        : null;

    if (!command) {
      process.exit(0); // no command to gate
    }

    // Read environment
    const sandboxDir = process.env.CONTENT_FILTER_SANDBOX_DIR;
    if (!sandboxDir) {
      process.exit(0); // fail-open: no sandbox configured
    }

    const modeRaw = process.env.CONTENT_FILTER_ENFORCER_MODE ?? "rewrite";
    const mode: EnforcerMode = modeRaw === "block" ? "block" : "rewrite";

    // Parse and rewrite
    const firstCmd = extractFirstCommand(command);
    const tokens = tokenize(firstCmd);
    const parsed = classifyCommand(tokens);
    const result = rewriteCommand(parsed, sandboxDir, mode);
    const hookOutput = buildHookOutput(result, mode);

    if (!hookOutput) {
      process.exit(0); // passthrough
    }

    // Log to stderr
    if (mode === "rewrite" && result.newPath) {
      console.error(
        `[SandboxEnforcer] Redirected ${parsed.type} to sandbox: ${result.newPath}`
      );
    } else if (mode === "block" && result.changed) {
      console.error(
        `[SandboxEnforcer] BLOCKED: ${parsed.type} requires sandbox directory`
      );
    }

    // Output hook response
    console.log(JSON.stringify(hookOutput));
    process.exit(0);
  } catch (e) {
    // Fail-open: any uncaught error → allow
    console.error(
      `[SandboxEnforcer] Error (fail-open): ${e instanceof Error ? e.message : String(e)}`
    );
    process.exit(0);
  }
}

main();
