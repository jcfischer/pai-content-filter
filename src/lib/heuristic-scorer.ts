/**
 * L1 — heuristic prompt-injection scorer.
 *
 * A ported, dependency-free reimplementation of the heuristic-detection
 * ALGORITHM from Rebuff (github.com/protectai/rebuff, MIT). Rebuff's heuristic
 * layer scores an input against a curated corpus of known prompt-injection
 * phrases using normalized string similarity; this module does the same.
 *
 * What was ported (algorithm only — NOT the package):
 *   - normalize input + corpus phrase to lowercase, strip punctuation, collapse
 *     whitespace (Rebuff `normalizeString`).
 *   - for each corpus phrase, slide a window over the input the same WORD count
 *     as the phrase and take the max similarity over all windows
 *     (Rebuff `getInputSubstrings` + `matchedWords`).
 *   - similarity = Sørensen-Dice bigram coefficient (Rebuff uses the
 *     `string-similarity` npm package's `compareTwoStrings`; that function is
 *     ~15 lines so it is inlined here per the cortex#370 scope lock — no new
 *     dependency).
 *   - the detector score is the maximum similarity across the whole corpus
 *     (Rebuff `detectPromptInjectionUsingHeuristicOnInput`).
 *
 * What was NOT ported: Rebuff's vector-DB layer and LLM-judge layer. cortex#370
 * locks scope to L0 + L1. This is a heuristic string-similarity scorer, not an
 * ML classifier — it is deliberately small, offline, zero-config, pure CPU.
 *
 * See THIRD-PARTY-NOTICES.md for the MIT attribution.
 */

import type { HeuristicResult, HeuristicVerdict } from "./types";

// ---------------------------------------------------------------------------
// Sørensen-Dice bigram coefficient (inlined — replaces `string-similarity`)
// ---------------------------------------------------------------------------

/**
 * Sørensen-Dice coefficient over character bigrams of two strings.
 *
 * Returns 1.0 for identical strings, 0.0 for no shared bigrams. This is the
 * exact algorithm `string-similarity`'s `compareTwoStrings` uses; inlined to
 * avoid adding a dependency (cortex#370 scope lock).
 *
 * Identical-string and single-character cases are handled explicitly because
 * strings shorter than 2 chars have no bigrams.
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count > 0) {
      bigrams.set(bigram, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (a.length - 1 + (b.length - 1));
}

// ---------------------------------------------------------------------------
// Normalization (ported from Rebuff `normalizeString`)
// ---------------------------------------------------------------------------

/**
 * Lowercase, strip punctuation, collapse runs of whitespace to single spaces.
 * Matches Rebuff's normalization so corpus phrases and input compare cleanly.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split normalized text into word tokens.
 */
function words(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(" ");
}

// ---------------------------------------------------------------------------
// Sliding-window similarity (ported from Rebuff `getInputSubstrings` /
// `matchedWords` / `detectPromptInjectionUsingHeuristicOnInput`)
// ---------------------------------------------------------------------------

/**
 * Maximum Dice similarity between any `windowSize`-word window of `inputWords`
 * and the target `phrase`.
 *
 * Rebuff scores each corpus phrase against every same-length window of the
 * input rather than the whole input, so a short attack phrase buried inside a
 * long benign message still scores high.
 */
function maxWindowSimilarity(
  inputWords: string[],
  windowSize: number,
  phrase: string,
): number {
  if (windowSize === 0 || inputWords.length < windowSize) {
    // Input shorter than the phrase — compare the whole input directly.
    return diceCoefficient(inputWords.join(" "), phrase);
  }
  let best = 0;
  for (let i = 0; i + windowSize <= inputWords.length; i++) {
    const window = inputWords.slice(i, i + windowSize).join(" ");
    const sim = diceCoefficient(window, phrase);
    if (sim > best) best = sim;
    if (best === 1) break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Verdict thresholds
// ---------------------------------------------------------------------------

/**
 * L1 score → verdict mapping. Tuned against the cortex#370 test corpus.
 *
 * The whole point of cortex#370 is FEWER false positives, so the thresholds
 * are deliberately conservative:
 *
 *   score >= BLOCK_THRESHOLD  → "block"  — near-verbatim known attack phrasing.
 *                                          Only this verdict makes cortex
 *                                          reject a message, so the bar is set
 *                                          high (0.95) to avoid blocking legit
 *                                          dev text that merely shares phrasing.
 *   score >= REVIEW_THRESHOLD → "review" — structurally similar. cortex treats
 *                                          REVIEW as allowed (no operator in the
 *                                          per-message loop) — it only annotates
 *                                          the result, never blocks.
 *   score <  REVIEW_THRESHOLD → "allow"
 *
 * Bigram similarity cannot perfectly separate a paraphrased attack ("disregard
 * all prior instructions", ~0.86) from benign text that reuses attack
 * vocabulary ("the new instructions for the deploy script", ~0.87). Those
 * overlap, so the mid band is REVIEW (non-blocking) by design — L1 is a
 * heuristic scorer, not an ML classifier, and is honest about that limit.
 */
export const L1_BLOCK_THRESHOLD = 0.95;
export const L1_REVIEW_THRESHOLD = 0.82;

function verdictForScore(score: number): HeuristicVerdict {
  if (score >= L1_BLOCK_THRESHOLD) return "block";
  if (score >= L1_REVIEW_THRESHOLD) return "review";
  return "allow";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score `input` against the attack-phrase `corpus` for prompt-injection
 * heuristics.
 *
 * Returns a 0..1 score (max similarity to any corpus phrase), the verdict
 * derived from the threshold mapping, and — when the score crosses the review
 * threshold — the corpus phrase that matched best, for diagnostics.
 *
 * Pure CPU, no I/O, no network. Empty input scores 0.
 */
export function scoreHeuristic(
  input: string,
  corpus: string[],
): HeuristicResult {
  const normalizedInput = normalizeText(input);
  const inputWords = words(normalizedInput);

  if (inputWords.length === 0 || corpus.length === 0) {
    return { score: 0, verdict: "allow" };
  }

  let bestScore = 0;
  let bestPhrase: string | undefined;

  for (const rawPhrase of corpus) {
    const phrase = normalizeText(rawPhrase);
    if (phrase.length === 0) continue;
    const phraseWordCount = words(phrase).length;

    const sim = maxWindowSimilarity(inputWords, phraseWordCount, phrase);
    if (sim > bestScore) {
      bestScore = sim;
      bestPhrase = rawPhrase;
      if (bestScore === 1) break;
    }
  }

  const score = Math.round(bestScore * 1000) / 1000;
  const verdict = verdictForScore(score);

  return {
    score,
    verdict,
    matched_phrase: verdict === "allow" ? undefined : bestPhrase,
  };
}
