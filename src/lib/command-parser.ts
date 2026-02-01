import type { CommandType, ParsedCommand } from "./types";

// ============================================================
// Flag-value consumption tables
// When a flag appears in this set, the NEXT token is its value
// and must not be misclassified as a URL or destination.
// ============================================================

const GIT_CLONE_VALUE_FLAGS = new Set([
  "--depth",
  "--branch",
  "-b",
  "--origin",
  "-o",
  "--config",
  "-c",
  "--reference",
  "--separate-git-dir",
  "--template",
  "-j",
  "--jobs",
]);

const CURL_VALUE_FLAGS = new Set([
  "-o",
  "--output",
  "-H",
  "--header",
  "-d",
  "--data",
  "-u",
  "--user",
  "-x",
  "--proxy",
  "-e",
  "--referer",
  "-A",
  "--user-agent",
  "--connect-timeout",
  "--max-time",
]);

const WGET_VALUE_FLAGS = new Set([
  "-O",
  "--output-document",
  "-P",
  "--directory-prefix",
  "--header",
  "--post-data",
  "--user",
  "--password",
  "--timeout",
  "--tries",
  "-t",
]);

// ============================================================
// extractFirstCommand
// ============================================================

/**
 * Split a raw command string on the first occurrence of &&, ||, or ;
 * and return the first segment, trimmed. Handles empty/whitespace input.
 */
export function extractFirstCommand(raw: string): string {
  // Find the earliest separator position
  const separators = ["&&", "||", ";"] as const;
  let earliestIndex = -1;

  for (const sep of separators) {
    const idx = raw.indexOf(sep);
    if (idx !== -1 && (earliestIndex === -1 || idx < earliestIndex)) {
      earliestIndex = idx;
    }
  }

  const segment =
    earliestIndex === -1 ? raw : raw.substring(0, earliestIndex);

  return segment.trim();
}

// ============================================================
// tokenize
// ============================================================

/**
 * Split a command segment on whitespace, filtering empty strings.
 */
export function tokenize(segment: string): string[] {
  return segment.split(/\s+/).filter((t) => t.length > 0);
}

// ============================================================
// classifyCommand
// ============================================================

/**
 * Pattern-match tokens to identify command type and extract
 * URL, destination, and flags.
 */
export function classifyCommand(tokens: string[]): ParsedCommand {
  const raw = tokens.join(" ");
  const base: ParsedCommand = {
    type: "passthrough",
    url: null,
    destination: null,
    flags: [],
    tokens,
    raw,
  };

  if (tokens.length === 0) {
    return base;
  }

  const cmd = tokens[0];

  // --- git clone ---
  if (cmd === "git" && tokens[1] === "clone") {
    return classifyGitClone(tokens, raw);
  }

  // --- gh repo clone ---
  if (cmd === "gh" && tokens[1] === "repo" && tokens[2] === "clone") {
    return classifyGhClone(tokens, raw);
  }

  // --- curl ---
  if (cmd === "curl") {
    return classifyCurl(tokens, raw);
  }

  // --- wget ---
  if (cmd === "wget") {
    return classifyWget(tokens, raw);
  }

  return base;
}

// ============================================================
// Internal classifiers
// ============================================================

function classifyGitClone(tokens: string[], raw: string): ParsedCommand {
  const flags: string[] = [];
  let url: string | null = null;
  let destination: string | null = null;

  // Skip tokens[0]="git", tokens[1]="clone"
  let i = 2;
  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (GIT_CLONE_VALUE_FLAGS.has(tok)) {
      // Value flag: consume the flag and its value
      flags.push(tok);
      i++;
      if (i < tokens.length) {
        flags.push(tokens[i]!);
      }
    } else if (tok.startsWith("-")) {
      // Boolean flag
      flags.push(tok);
    } else if (url === null) {
      // First positional argument is the URL
      url = tok;
    } else if (destination === null) {
      // Second positional argument is the destination
      destination = tok;
    }

    i++;
  }

  return {
    type: "git-clone",
    url,
    destination,
    flags,
    tokens,
    raw,
  };
}

function classifyGhClone(tokens: string[], raw: string): ParsedCommand {
  // tokens[0]="gh", tokens[1]="repo", tokens[2]="clone"
  const url = tokens[3] ?? null;
  const destination = tokens[4] ?? null;

  return {
    type: "gh-clone",
    url,
    destination,
    flags: [],
    tokens,
    raw,
  };
}

function classifyCurl(tokens: string[], raw: string): ParsedCommand {
  const flags: string[] = [];
  let url: string | null = null;
  let destination: string | null = null;
  let hasOutputFlag = false;

  // Skip tokens[0]="curl"
  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (tok === "-o" || tok === "--output") {
      // Output flag: next token is the destination
      hasOutputFlag = true;
      flags.push(tok);
      i++;
      if (i < tokens.length) {
        destination = tokens[i]!;
      }
    } else if (CURL_VALUE_FLAGS.has(tok)) {
      // Other value flag: consume the flag and its value
      flags.push(tok);
      i++;
      if (i < tokens.length) {
        flags.push(tokens[i]!);
      }
    } else if (tok.startsWith("-")) {
      // Boolean flag
      flags.push(tok);
    } else {
      // Positional argument — treat as URL
      if (url === null) {
        url = tok;
      }
    }

    i++;
  }

  // curl without -o/--output is stdout = passthrough
  if (!hasOutputFlag) {
    return {
      type: "passthrough",
      url,
      destination: null,
      flags,
      tokens,
      raw,
    };
  }

  return {
    type: "curl-download",
    url,
    destination,
    flags,
    tokens,
    raw,
  };
}

function classifyWget(tokens: string[], raw: string): ParsedCommand {
  const flags: string[] = [];
  let url: string | null = null;
  let destination: string | null = null;
  let type: CommandType = "passthrough";

  // Skip tokens[0]="wget"
  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (tok === "-O" || tok === "--output-document") {
      // Output file flag
      type = "wget-download";
      flags.push(tok);
      i++;
      if (i < tokens.length) {
        destination = tokens[i]!;
      }
    } else if (tok === "-P" || tok === "--directory-prefix") {
      // Directory prefix flag
      type = "wget-dir";
      flags.push(tok);
      i++;
      if (i < tokens.length) {
        destination = tokens[i]!;
      }
    } else if (WGET_VALUE_FLAGS.has(tok)) {
      // Other value flag: consume the flag and its value
      flags.push(tok);
      i++;
      if (i < tokens.length) {
        flags.push(tokens[i]!);
      }
    } else if (tok.startsWith("-")) {
      // Boolean flag
      flags.push(tok);
    } else {
      // Positional argument — treat as URL
      if (url === null) {
        url = tok;
      }
    }

    i++;
  }

  return {
    type,
    url,
    destination,
    flags,
    tokens,
    raw,
  };
}
