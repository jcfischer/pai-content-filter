/**
 * Attack-phrase corpus for the L1 heuristic scorer.
 *
 * The corpus lives as plain data in `config/attack-corpus.json` so it is
 * updatable without a code change. It is embedded here via Bun's text import
 * (same mechanism as default-config.ts) so it is available in compiled
 * binaries where `import.meta.dir` resolves to a non-existent path.
 */

// Imported with `type: "text"` so Bun embeds the raw JSON string (works in
// compiled binaries). Typed as `string` explicitly — TS would otherwise infer
// the parsed-object shape and reject the JSON.parse() call below.
import corpusJsonRaw from "../../config/attack-corpus.json" with { type: "text" };

const corpusJson: string = corpusJsonRaw as unknown as string;

interface AttackCorpusFile {
  version: string;
  description: string;
  phrases: string[];
}

/**
 * Parse + validate the embedded corpus once at module load.
 *
 * Fail-closed on a malformed corpus: the heuristic layer is a security control,
 * so a broken corpus must surface loudly rather than silently disabling L1.
 */
function loadEmbeddedCorpus(): string[] {
  const parsed = JSON.parse(corpusJson) as AttackCorpusFile;
  if (!Array.isArray(parsed.phrases) || parsed.phrases.length === 0) {
    throw new Error(
      "attack-corpus.json is malformed: `phrases` must be a non-empty array",
    );
  }
  return parsed.phrases.filter((p) => typeof p === "string" && p.length > 0);
}

/** The default L1 attack-phrase corpus (frozen — treat as immutable data). */
export const ATTACK_CORPUS: readonly string[] = Object.freeze(
  loadEmbeddedCorpus(),
);
