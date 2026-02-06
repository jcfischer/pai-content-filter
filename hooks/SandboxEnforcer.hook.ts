#!/usr/bin/env bun

/**
 * PreToolUse hook: Sandbox enforcer for external content acquisition.
 *
 * Intercepts Bash tool calls that acquire external content (git clone,
 * curl -o, wget -O/-P) and blocks them if they target a path outside
 * the sandbox directory. The error message tells Claude the correct
 * command to use, causing an automatic retry to the sandbox.
 *
 * Strategy: exit 2 + stderr instruction. Claude Code's updatedInput
 * mechanism does not apply in bypassPermissions mode, so we block
 * and instruct instead. Commands already targeting the sandbox pass
 * through unmodified.
 *
 * Exit codes:
 *   0 — Passthrough (not an acquisition command, or already sandboxed)
 *   2 — Blocked (acquisition targets path outside sandbox, or infrastructure error)
 *
 * Fail-closed: any error in the hook → exit 2 (block on failure).
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
    // Read stdin with timeout — prevents hang if stdin never closes
    const raw = await Promise.race([
      Bun.stdin.text(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('stdin timeout')), 3000)
      ),
    ]).then(t => t.trim()).catch(() => '');

    if (!raw) {
      console.error("[SandboxEnforcer] BLOCKED: empty stdin (fail-closed)");
      process.exit(2); // fail-closed: empty stdin
    }

    let input: { tool_name?: string; tool_input?: Record<string, unknown> };
    try {
      input = JSON.parse(raw);
    } catch {
      console.error("[SandboxEnforcer] BLOCKED: malformed JSON input (fail-closed)");
      process.exit(2); // fail-closed: malformed JSON
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

    // Parse and classify command
    const firstCmd = extractFirstCommand(command);
    const tokens = tokenize(firstCmd);
    const parsed = classifyCommand(tokens);
    const result = rewriteCommand(parsed, sandboxDir, mode);
    const hookOutput = buildHookOutput(result, mode);

    if (!hookOutput) {
      process.exit(0); // passthrough: not an acquisition or already sandboxed
    }

    // Acquisition command targeting outside sandbox — block with instruction
    const rewrittenCmd = hookOutput.hookSpecificOutput.updatedInput?.command;
    if (rewrittenCmd) {
      console.error(
        `[SandboxEnforcer] BLOCKED: External content must go to sandbox. ` +
        `Use this command instead: ${rewrittenCmd}`
      );
      process.exit(2);
    }

    // Block mode or no rewrite available
    console.error(
      `[SandboxEnforcer] BLOCKED: ${parsed.type} must target sandbox directory ${sandboxDir}`
    );
    process.exit(2);
  } catch (e) {
    // Fail-closed: any uncaught error → block
    console.error(
      `[SandboxEnforcer] BLOCKED (fail-closed): ${e instanceof Error ? e.message : String(e)}`
    );
    process.exit(2);
  }
}

main();
