# F-003: Typed References & Provenance — Tasks

## T-3.1: Add TypedReference types to types.ts [T]
**depends:** none
**TDD**: Write schema validation tests → add Zod schema → verify green
- TypedReferenceSchema with all fields
- TypedReferenceFilterResult enum
- ProvenanceResult interface

## T-3.2: Implement createTypedReference builder [T]
**depends:** T-3.1
**TDD**: Write builder tests (valid + rejection cases) → implement → verify green
- Auto-generate UUID, hash, timestamp
- Extract origin from path
- Map filter decision to reference filter_result
- Reject non-passing decisions

## T-3.3: Implement validateProvenance [T]
**depends:** T-3.1
**TDD**: Write validation tests (valid/invalid cases) → implement → verify green
- Uses Zod schema safeParse
- Returns { valid, errors[] }

## T-3.4: Enforce immutability [T]
**depends:** T-3.2
**TDD**: Write freeze tests → add Object.freeze → verify green
- Created references are frozen
- Modification attempts throw

## T-3.5: Verify serialization round-trip [T]
**depends:** T-3.2, T-3.3
**TDD**: Write round-trip test → verify green (should pass without new code)
- JSON.stringify → JSON.parse → validateProvenance = valid

## T-3.6: Update exports and final verification [T]
**depends:** T-3.1, T-3.2, T-3.3, T-3.4, T-3.5
- Update src/index.ts
- Run full test suite (all features)
- Run typecheck
