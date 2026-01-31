# F-003: Typed References & Provenance

## Overview

TypedReference builder that creates structured data extracts with immutable provenance metadata. This is the data transfer format between quarantined and privileged contexts — the quarantined agent produces TypedReferences, the privileged agent consumes them.

**Status:** Stub — to be fully specified when implementation reaches this feature.

## Source Requirements

From F-088:
- **R-008: Data Provenance Tracking** — Every cross-project reference carries origin, trust_level, content_hash, filter_result, consumed_at, format

## Key Capabilities

### TypedReference Builder
- Creates structured extracts from quarantined content processing
- Auto-generates: UUID, SHA-256 content hash, ISO 8601 timestamp
- Origin extracted from file path (repo name)
- `trust_level` always `"untrusted"` for cross-project content
- Output format: JSON (serializable for cross-process transfer)

### Provenance Validation
- `validateProvenance(ref)` — verify reference has all required metadata
- Privileged context SHALL reject references without valid provenance
- Provenance is immutable once attached — no modification after creation
- Any agent consuming a reference can query its provenance

## Dependencies

- **F-001** (Content Filter Engine) — provides filter_result for provenance

## Data Model

```typescript
interface TypedReference {
  id: string;                          // UUID
  origin: string;                      // e.g., "pai-collab/blackboard"
  trust_level: "untrusted";            // always untrusted for cross-project
  content_hash: string;                // SHA-256 of source content
  filter_result: "PASSED" | "OVERRIDE" | "HUMAN_APPROVED";
  consumed_at: string;                 // ISO 8601
  format: "yaml" | "json" | "markdown" | "mixed";
  data: Record<string, unknown>;       // structured extract, never raw text
  source_file: string;                 // original file path
}
```

## File Structure

```
src/lib/
└── typed-reference.ts    # TypedReference builder + provenance validation
```

## F-088 Task Mapping

| F-088 Task | Description |
|------------|-------------|
| T-4.1 | Typed reference builder |

---
*Decomposed from F-088, 2026-01-31*
*Source requirements: R-008*
