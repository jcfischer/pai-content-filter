# F-003: Typed References & Provenance — Technical Plan

## Architecture

Single new module `src/lib/typed-reference.ts` with Zod schema in `types.ts`. No modifications to F-001 or F-002 modules — TypedReference is a consumer of FilterResult, not a modifier.

### Data Flow

```
FilterResult (ALLOWED/OVERRIDE/HUMAN_APPROVED)
  + content string
  + structured data extract
  → createTypedReference()
  → frozen TypedReference with provenance
  → JSON serialization for cross-process transfer
  → validateProvenance() on receiving end
```

## Key Decisions

1. **Zod schema for validation** — consistent with project pattern, used in types.ts
2. **Object.freeze for immutability** — shallow freeze sufficient (we protect provenance fields, not payload contents)
3. **Origin extraction from path** — take last two path segments (e.g., `/foo/bar/baz.md` → `bar/baz.md`)
4. **Filter result mapping** — explicit map, not string passthrough, to decouple from FilterDecision enum
5. **Trust level always "untrusted"** — by design, cross-project content cannot be trusted

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/types.ts` | Modify | Add TypedReference schema and types |
| `src/lib/typed-reference.ts` | Create | Builder + validation functions |
| `src/index.ts` | Modify | Export new module |
| `tests/typed-reference.test.ts` | Create | TDD test suite |
