import { basename, join } from "node:path";
import type {
  ParsedCommand,
  EnforcerMode,
  RewriteResult,
  HookOutput,
} from "./types";

/**
 * Extract repository name from various URL formats.
 *
 * Supports HTTPS, SSH, GitLab nested groups, gh short format,
 * and URLs with trailing slashes or .git suffixes.
 *
 * Returns "download" as fallback when no name can be extracted.
 */
export function extractRepoName(url: string): string {
  if (!url) return "download";

  let cleaned = url;

  // Handle SSH format: git@host:owner/repo.git -> owner/repo.git
  if (cleaned.includes("@") && cleaned.includes(":")) {
    const colonIdx = cleaned.indexOf(":");
    cleaned = cleaned.slice(colonIdx + 1);
  }

  // Strip protocol prefix (https://, http://, etc.)
  cleaned = cleaned.replace(/^[a-zA-Z]+:\/\//, "");

  // Strip trailing slashes
  cleaned = cleaned.replace(/\/+$/, "");

  // Strip .git suffix
  cleaned = cleaned.replace(/\.git$/, "");

  // Take the last path segment
  const segments = cleaned.split("/").filter(Boolean);
  const last = segments.at(-1);

  // If we only got a hostname (e.g. "example.com") or nothing, fallback
  if (!last || last.includes(".")) {
    // Check if it looks like a bare hostname with no path
    if (!last || segments.length <= 1) return "download";
  }

  return last;
}

/**
 * Rewrite a parsed command to target the sandbox directory.
 *
 * Pure function: takes parsed command data, returns rewrite result.
 * In "block" mode, signals that a rewrite would be needed but does
 * not provide the rewritten command.
 */
export function rewriteCommand(
  parsed: ParsedCommand,
  sandboxDir: string,
  mode: EnforcerMode
): RewriteResult {
  const unchanged: RewriteResult = {
    rewritten: parsed.raw,
    original: parsed.raw,
    changed: false,
    newPath: null,
  };

  if (parsed.type === "passthrough") {
    return unchanged;
  }

  if (parsed.type === "git-clone" || parsed.type === "gh-clone") {
    return rewriteClone(parsed, sandboxDir, mode);
  }

  if (parsed.type === "curl-download") {
    return rewriteOutputFlag(parsed, sandboxDir, mode, ["-o", "--output"]);
  }

  if (parsed.type === "wget-download") {
    return rewriteOutputFlag(parsed, sandboxDir, mode, [
      "-O",
      "--output-document",
    ]);
  }

  if (parsed.type === "wget-dir") {
    return rewriteDirFlag(parsed, sandboxDir, mode);
  }

  return unchanged;
}

/**
 * Build Claude Code hook output from a rewrite result.
 *
 * Returns null when no change is needed (passthrough).
 */
export function buildHookOutput(
  result: RewriteResult,
  mode: EnforcerMode
): HookOutput | null {
  if (!result.changed) return null;

  if (mode === "rewrite") {
    return {
      updatedInput: { command: result.rewritten },
      permissionDecision: "allow",
    };
  }

  // block mode
  return {
    permissionDecision: "deny",
  };
}

// ============================================================
// Internal helpers
// ============================================================

function blockResult(parsed: ParsedCommand): RewriteResult {
  return {
    rewritten: parsed.raw,
    original: parsed.raw,
    changed: true,
    newPath: null,
  };
}

function rewriteClone(
  parsed: ParsedCommand,
  sandboxDir: string,
  mode: EnforcerMode
): RewriteResult {
  const repoName = extractRepoName(parsed.url ?? "");
  const dest = parsed.destination;

  // No destination specified: append sandbox/repoName
  if (!dest) {
    const newPath = join(sandboxDir, repoName);
    if (mode === "block") return blockResult(parsed);
    return {
      rewritten: `${parsed.raw} ${newPath}`,
      original: parsed.raw,
      changed: true,
      newPath,
    };
  }

  // Destination already inside sandbox
  if (dest.startsWith(sandboxDir)) {
    return {
      rewritten: parsed.raw,
      original: parsed.raw,
      changed: false,
      newPath: null,
    };
  }

  // Destination is "." — replace with sandbox/repoName
  if (dest === ".") {
    const newPath = join(sandboxDir, repoName);
    if (mode === "block") return blockResult(parsed);
    const rewritten = parsed.raw.replace(/\s\.\s*$/, ` ${newPath}`);
    return {
      rewritten,
      original: parsed.raw,
      changed: true,
      newPath,
    };
  }

  // Destination outside sandbox: redirect to sandbox/basename(destination)
  const destName = basename(dest);
  const newPath = join(sandboxDir, destName);
  if (mode === "block") return blockResult(parsed);

  const rewritten = parsed.raw.replace(dest, newPath);
  return {
    rewritten,
    original: parsed.raw,
    changed: true,
    newPath,
  };
}

function rewriteOutputFlag(
  parsed: ParsedCommand,
  sandboxDir: string,
  mode: EnforcerMode,
  flagNames: string[]
): RewriteResult {
  const tokens = [...parsed.tokens];
  let outputIdx = -1;

  // Find the flag token and its value
  for (let i = 0; i < tokens.length; i++) {
    if (flagNames.includes(tokens[i]!)) {
      outputIdx = i;
      break;
    }
  }

  if (outputIdx === -1 || outputIdx + 1 >= tokens.length) {
    return {
      rewritten: parsed.raw,
      original: parsed.raw,
      changed: false,
      newPath: null,
    };
  }

  const valueIdx = outputIdx + 1;
  const currentPath = tokens[valueIdx]!;

  // Already inside sandbox
  if (currentPath.startsWith(sandboxDir)) {
    return {
      rewritten: parsed.raw,
      original: parsed.raw,
      changed: false,
      newPath: null,
    };
  }

  // Rewrite needed
  if (mode === "block") return blockResult(parsed);

  const fileName = basename(currentPath);
  const newPath = join(sandboxDir, fileName);
  tokens[valueIdx] = newPath;

  return {
    rewritten: tokens.join(" "),
    original: parsed.raw,
    changed: true,
    newPath,
  };
}

function rewriteDirFlag(
  parsed: ParsedCommand,
  sandboxDir: string,
  mode: EnforcerMode
): RewriteResult {
  const tokens = [...parsed.tokens];
  const dirFlags = ["-P", "--directory-prefix"];
  let dirIdx = -1;

  for (let i = 0; i < tokens.length; i++) {
    if (dirFlags.includes(tokens[i]!)) {
      dirIdx = i;
      break;
    }
  }

  if (dirIdx === -1 || dirIdx + 1 >= tokens.length) {
    return {
      rewritten: parsed.raw,
      original: parsed.raw,
      changed: false,
      newPath: null,
    };
  }

  const valueIdx = dirIdx + 1;
  const currentDir = tokens[valueIdx]!;

  // Already targeting sandbox
  if (currentDir.startsWith(sandboxDir)) {
    return {
      rewritten: parsed.raw,
      original: parsed.raw,
      changed: false,
      newPath: null,
    };
  }

  // Rewrite needed
  if (mode === "block") return blockResult(parsed);

  tokens[valueIdx] = sandboxDir;

  return {
    rewritten: tokens.join(" "),
    original: parsed.raw,
    changed: true,
    newPath: sandboxDir,
  };
}
