# Third-Party Notices

`@metafactory/content-filter` incorporates algorithms, patterns, and ideas from
the following open-source projects.

---

## Rebuff

- **Repository:** https://github.com/protectai/rebuff
- **Author:** Protect AI
- **License:** MIT

The **L1 heuristic prompt-injection scorer** (`src/lib/heuristic-scorer.ts`,
introduced in v0.2.0 — see cortex#370) is a dependency-free **port of Rebuff's
heuristic-detection algorithm**, not a use of the published `rebuff` npm
package.

What was ported (the algorithm only):

- Input + corpus-phrase normalization (lowercase, strip punctuation, collapse
  whitespace) — Rebuff's `normalizeString`.
- Sliding same-word-length windows over the input and taking the max
  similarity per corpus phrase — Rebuff's `getInputSubstrings` /
  `matchedWords`.
- Sørensen–Dice bigram coefficient as the string-similarity measure — Rebuff
  uses the `string-similarity` package's `compareTwoStrings`; that function is
  ~15 lines and is **inlined** here (`diceCoefficient`) so no dependency is
  added.
- The detector score is the maximum similarity across the whole attack
  corpus — Rebuff's `detectPromptInjectionUsingHeuristicOnInput`.
- The seed attack-phrase corpus (`config/attack-corpus.json`) draws on
  Rebuff's open heuristic corpus, extended with this repository's existing
  `PI-*` regex patterns.

What was **not** ported: Rebuff's vector-DB similarity layer and its
LLM-as-judge layer. `@metafactory/content-filter`'s L1 is a heuristic
string-similarity scorer — offline, zero-config, pure CPU — not an ML
classifier. The published `rebuff` package is **not** a dependency of this
project (it pulls `@pinecone-database/pinecone`, `chromadb`, `langchain`, and
`openai`; the algorithm port avoids all of that).

### MIT License

```
MIT License

Copyright (c) 2023 Protect AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Microsoft Presidio

- **Repository:** https://github.com/microsoft/presidio
- **Author:** Microsoft
- **License:** MIT

The `PII-*` detection patterns in `config/filter-patterns.yaml` are derived
from Microsoft Presidio's recognizer patterns (adapted via Arbor's
`arbor_eval` PII-detection module). Pattern inspiration only — no code import.
