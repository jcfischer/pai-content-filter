import type { EncodingRule, EncodingMatch } from "./types";

/**
 * Detect whether a string looks like a code identifier (camelCase, PascalCase,
 * or snake_case) rather than base64-encoded data.
 *
 * Heuristics:
 * 1. Must be purely alphanumeric (plus underscores for snake_case)
 * 2. Must NOT contain base64 padding (=), +, or /
 * 3. For camelCase/PascalCase: split at camelCase boundaries and verify each
 *    word segment is all-lowercase letters (optionally starting with uppercase).
 *    Real base64 has random case mixing within segments.
 * 4. For snake_case: has underscores separating lowercase word segments.
 *
 * The segment check is critical: `updateWorkItemMetadata` splits into
 * [update, Work, Item, Metadata] where each segment after the capital
 * is all-lowercase. Base64 like `dGhpcyBpcyBhIHRlc3Qgc3RyaW5n` splits
 * into segments with digits and mixed case within each segment.
 */
export function looksLikeIdentifier(text: string): boolean {
  // Base64 with padding is almost certainly real base64
  if (text.includes("=")) return false;

  // + and / are base64 chars but not valid in identifiers
  if (text.includes("+") || text.includes("/")) return false;

  // Must be purely alphanumeric (with optional underscores for snake_case)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) return false;

  // Must not contain digits — identifiers rarely have digits, base64 commonly does
  if (/\d/.test(text)) return false;

  // snake_case: has underscores separating lowercase word segments
  if (text.includes("_") && /^[a-z_][a-z]*(?:_[a-z]+)+$/.test(text)) {
    return true;
  }

  // Strip leading underscore(s) for private identifier convention
  const stripped = text.replace(/^_+/, "");
  if (stripped.length === 0) return false;

  // Split at camelCase boundaries (before each uppercase letter)
  const segments = stripped.split(/(?=[A-Z])/);

  // Need at least 3 segments (e.g., "update" + "Work" + "Item")
  if (segments.length < 3) return false;

  // Every segment must be: optional uppercase letter followed by all lowercase
  // This catches real identifiers and rejects base64 with random mixing
  for (const seg of segments) {
    if (seg.length === 0) continue;
    if (!/^[A-Z]?[a-z]+$/.test(seg)) return false;
  }

  return true;
}

export function detectEncoding(
  content: string,
  rules: EncodingRule[]
): EncodingMatch[] {
  const matches: EncodingMatch[] = [];
  const lines = content.split("\n");

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern, "g");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        const text = match[0]!;

        // For rules with min_length, enforce minimum
        if (rule.min_length && text.length < rule.min_length) {
          if (text.length === 0) regex.lastIndex++;
          continue;
        }

        // Skip url_encoded matches inside actual URLs
        if (rule.type === "url_encoded") {
          const before = line.slice(0, match.index);
          if (/https?:\/\/\S*$/.test(before)) {
            if (text.length === 0) regex.lastIndex++;
            continue;
          }
        }

        // Skip base64 matches that look like code identifiers
        if (rule.type === "base64" && looksLikeIdentifier(text)) {
          if (text.length === 0) regex.lastIndex++;
          continue;
        }

        matches.push({
          type: rule.type,
          matched_text: text.length > 80 ? text.slice(0, 80) + "..." : text,
          line: lineIdx + 1,
          column: match.index + 1,
        });

        if (text.length === 0) regex.lastIndex++;
      }
    }
  }

  return matches;
}
