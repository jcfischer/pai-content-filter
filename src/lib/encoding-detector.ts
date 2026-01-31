import type { EncodingRule, EncodingMatch } from "./types";

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
