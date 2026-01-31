# F-003: Typed References & Provenance

## Problem & Pain

When cross-project content passes the content filter, the downstream privileged agent needs structured data — not raw text. Without typed references:
- No provenance chain: privileged context can't verify where data came from
- No integrity guarantee: data could be modified between filter and consumption
- No trust boundary enforcement: any data could claim to be "filtered"
- No serialization format: cross-process transfer requires a defined schema

## Users & Context

- **Primary**: Quarantined agent creating typed references from filtered content
- **Secondary**: Privileged agent consuming and validating references
- **Tertiary**: Audit system recording provenance metadata

## Source Requirements

From F-088:
- **R-008: Data Provenance Tracking** — Every cross-project reference carries origin, trust_level, content_hash, filter_result, consumed_at, format

## Requirements

### R-001: TypedReference Schema

Zod-validated schema with required fields:
- `id`: UUID, auto-generated
- `origin`: string, extracted from file path (e.g., "pai-collab/blackboard")
- `trust_level`: literal `"untrusted"` — always untrusted for cross-project content
- `content_hash`: SHA-256 of source content
- `filter_result`: one of `"PASSED"`, `"OVERRIDE"`, `"HUMAN_APPROVED"`
- `consumed_at`: ISO 8601 timestamp, auto-generated
- `format`: file format from filter result
- `data`: `Record<string, unknown>` — structured extract, never raw text
- `source_file`: original file path

### R-002: TypedReference Builder

`createTypedReference(result, content, data, opts?)` function:
- Accepts FilterResult from F-001 pipeline
- Only accepts filter decisions that indicate content is safe: ALLOWED, OVERRIDE, HUMAN_APPROVED
- Rejects BLOCKED, HUMAN_REVIEW, HUMAN_REJECTED with error
- Auto-generates: UUID via `crypto.randomUUID()`, SHA-256 hash, ISO 8601 timestamp
- Extracts origin from file path
- Returns frozen (immutable) TypedReference

### R-003: Provenance Validation

`validateProvenance(ref)` function:
- Validates all required fields present and correctly typed
- Returns `{ valid: boolean, errors: string[] }`
- Can validate deserialized references (from JSON.parse)
- Uses the Zod schema for validation

### R-004: Immutability

Created references are frozen via `Object.freeze()`:
- All top-level properties read-only
- Attempts to modify throw in strict mode
- Provenance cannot be tampered with after creation

### R-005: Serialization

References must survive JSON round-trip:
- `JSON.stringify(ref)` → `JSON.parse(...)` → `validateProvenance(...)` returns valid
- All fields preserved through serialization
- Cross-process transfer format is JSON

### R-006: Filter Result Mapping

Map FilterDecision to TypedReference filter_result:
- ALLOWED → "PASSED"
- OVERRIDE → "OVERRIDE"
- HUMAN_APPROVED → "HUMAN_APPROVED"
- BLOCKED → reject (throw)
- HUMAN_REVIEW → reject (throw)
- HUMAN_REJECTED → reject (throw)

## Data Model

```typescript
const TypedReferenceSchema = z.object({
  id: z.string().uuid(),
  origin: z.string().min(1),
  trust_level: z.literal("untrusted"),
  content_hash: z.string().length(64), // SHA-256 hex
  filter_result: z.enum(["PASSED", "OVERRIDE", "HUMAN_APPROVED"]),
  consumed_at: z.string().datetime(),
  format: z.enum(["yaml", "json", "markdown", "mixed"]),
  data: z.record(z.unknown()),
  source_file: z.string().min(1),
});
```

## File Structure

```
src/lib/
├── typed-reference.ts    # Builder + provenance validation
└── types.ts              # Extended with TypedReference types
tests/
└── typed-reference.test.ts
```

## Edge Cases

- **Empty data object**: Valid — `{}` is acceptable structured extract
- **Very long file paths**: Origin extraction handles nested paths
- **Non-standard file paths**: Falls back to full path as origin
- **Frozen object with nested data**: `Object.freeze` is shallow — data object contents can still change (acceptable: we freeze the reference, not the payload)

## Success Criteria

1. TypedReferenceSchema validates all required fields correctly
2. `createTypedReference()` builds valid references from FilterResult
3. Only ALLOWED/OVERRIDE/HUMAN_APPROVED produce references
4. `validateProvenance()` returns true for complete, false for incomplete references
5. Created references are frozen (immutable top-level)
6. JSON serialization round-trip preserves all provenance
7. All tests pass, zero type errors

---
*Expanded from stub, 2026-01-31*
*Source requirements: R-008 from F-088*
