/**
 * Entropy + structural gates for the L0 base64 encoding detector (EN-001).
 *
 * Background — cortex#367: the EN-001 regex `[A-Za-z0-9+/]{21,}={0,2}` is
 * structurally "any 21+ char run of base64 alphabet". It false-positives on
 * every GitHub URL path, every commit SHA, and any long slash-delimited path.
 * That blocked review pings across cortex#358/#362/#363 and signal#51/#53.
 *
 * Real base64 of random bytes is high-entropy and has no internal structure.
 * URL paths, SHAs and code paths are low-to-mid entropy structured text. This
 * module supplies the gates that let the regex hit be confirmed or rejected:
 *
 *   1. shannonEntropy()      — bits/char; junk like "AAAA..." scores ~0.
 *   2. looksLikeShaToken()   — hex-only tokens of git SHA length (7/8/40).
 *   3. looksLikePathSegment()— slash-delimited path-ish runs / URL context.
 *   4. isLikelyBase64()      — the combined verdict used by encoding-detector.
 *
 * Pure CPU, no deps, no I/O. Used only for the base64 (EN-001) rule.
 */

/**
 * Shannon entropy of a string in bits per character.
 *
 * H = -Σ p(c) · log2 p(c) over the observed character distribution.
 *
 * Random base64 of real bytes lands ~4.5-6.0 bits/char (alphabet of 64).
 * Repeated-character junk ("AAAA...") scores ~0. Structured text (URL paths,
 * SHAs) lands in a mid band ~3.6-4.1 — too close to short real base64 to
 * separate on entropy alone, which is why the structural gates below exist.
 */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const ch of text) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  let entropy = 0;
  for (const ch in freq) {
    const p = freq[ch]! / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * True when the token is a git commit SHA: all hex characters and of a
 * canonical git object-name length — 7 or 8 (abbreviated) or 40 (full SHA-1).
 *
 * SHAs are the single biggest EN-001 false-positive source (cortex#367).
 * They are hex-only by definition, so this is a precise, zero-false-negative
 * check — a real base64 payload that happens to be all-hex is degenerate and
 * decodes to nothing meaningful anyway.
 */
export function looksLikeShaToken(text: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(text)) return false;
  return text.length === 7 || text.length === 8 || text.length === 40;
}

/**
 * True when the regex match sits inside a URL or a slash-delimited path.
 *
 * `/` is a member of the base64 alphabet, so the EN-001 regex happily eats
 * `metafactory/cortex/pull/363` out of a GitHub URL. Real base64 payloads do
 * occasionally contain `/`, but a payload that is *mostly* short slash-free
 * words joined by slashes is a path, not an encoded blob.
 *
 * Detection:
 *   - `://` appears anywhere in the matched run, OR
 *   - the run contains `/` AND splitting on `/` yields multiple segments that
 *     each look like path/URL words (lowercase-ish words, digits, hyphens).
 *
 * `before` is the slice of the line preceding the match — used to catch the
 * case where the match starts *after* the `://` (e.g. the regex match is
 * `metafactory/cortex/pull/363` and the `https://github.com/the-` prefix is
 * in `before`).
 */
export function looksLikePathSegment(text: string, before = ""): boolean {
  // Inside the match itself.
  if (text.includes("://")) return true;

  // Match begins immediately after a URL scheme+host prefix.
  if (/https?:\/\/\S*$/.test(before)) return true;

  if (!text.includes("/")) return false;

  const segments = text.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) return false;

  // Every non-empty segment must look like a path/URL word: lowercase letters,
  // digits and hyphens, no internal uppercase runs, no `+` or `=`. Real base64
  // segments around a `/` would carry mixed case and be long & dense.
  return segments.every((seg) => /^[a-z0-9][a-z0-9-]*$/.test(seg));
}

/**
 * Minimum Shannon entropy (bits/char) for a slash-free candidate to be treated
 * as real base64. Tuned against the cortex#367 corpus:
 *
 *   - repeated-char junk ("AAAA...")          → ~0.0   (rejected)
 *   - short real base64 ("dGhpcyBpcyBh...")   → ~3.99  (kept)
 *   - random-bytes base64 (>32 bytes)         → ~4.7-6 (kept)
 *
 * The structural gates (SHA + path) remove the mid-entropy structured-text
 * false positives, so this floor only has to reject low-entropy junk. 3.0 is
 * a conservative cut that keeps every legitimate base64 sample in the corpus.
 */
export const BASE64_ENTROPY_FLOOR = 3.0;

/**
 * Combined verdict: should this EN-001 regex hit be treated as real base64?
 *
 * Returns false (reject the hit) when the token is:
 *   - a git SHA (hex-only, length 7/8/40), or
 *   - inside a URL / a slash-delimited path, or
 *   - below the Shannon-entropy floor (low-entropy junk).
 *
 * Returns true only when the token survives all three gates.
 */
export function isLikelyBase64(text: string, before = ""): boolean {
  if (looksLikeShaToken(text)) return false;
  if (looksLikePathSegment(text, before)) return false;
  if (shannonEntropy(text) < BASE64_ENTROPY_FLOOR) return false;
  return true;
}
