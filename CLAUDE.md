# pai-content-filter

Inbound content security for PAI cross-project collaboration.

## Stack

- TypeScript + Bun (no npm/yarn/pnpm)
- Zod for schema validation
- Zero other external dependencies

## Development

```bash
bun test              # Run all 380 tests
bun run typecheck     # Type checking (tsc --noEmit)
bun run src/cli.ts    # CLI entry point
```

## Project Structure

```
src/
├── cli.ts                     # CLI: check, audit, config subcommands
├── index.ts                   # Public API exports
└── lib/
    ├── content-filter.ts      # Core pipeline: encoding → schema → pattern → decision
    ├── pattern-matcher.ts     # YAML config loader + regex matching
    ├── encoding-detector.ts   # Base64, unicode, hex, URL-encoded, HTML entity detection
    ├── schema-validator.ts    # Zod validation for YAML/JSON formats
    ├── audit.ts               # JSONL append-only audit trail with rotation
    ├── human-review.ts        # Override and review decision flows
    ├── typed-reference.ts     # Immutable TypedReference builder + provenance validation
    ├── command-parser.ts      # Bash command tokenizer and classifier (F-006)
    ├── sandbox-rewriter.ts    # Command rewriter targeting sandbox directory (F-006)
    ├── quarantine-runner.ts   # Subprocess isolation for cross-project reads
    ├── alerts.ts              # Structured stderr block alerts
    └── types.ts               # All Zod schemas and TypeScript types

hooks/
├── ContentFilter.hook.ts      # PreToolUse gate: scan files on Read/Glob/Grep
└── SandboxEnforcer.hook.ts    # PreToolUse gate: redirect acquisitions to sandbox

config/
├── filter-patterns.yaml       # Pattern library (28 patterns + 6 encoding rules)
├── cross-project-profile.json # MCP profile for quarantined context
└── schemas/                   # Zod schemas for EXTEND.yaml, REGISTRY.md, SOPs
    ├── extend-yaml.ts
    ├── registry-md.ts
    └── sop.ts

tests/
├── content-filter.test.ts     # F-001: 42 tests
├── encoding-detector.test.ts  # F-001: 48 tests
├── audit.test.ts              # F-002: 22 tests
├── human-review.test.ts       # F-002: 14 tests
├── typed-reference.test.ts    # F-003: 33 tests
├── quarantine-runner.test.ts  # F-004: 24 tests
├── command-parser.test.ts     # F-006: 37 command parser tests
├── sandbox-rewriter.test.ts   # F-006: 25 sandbox rewriter tests
├── canary.test.ts             # F-005: 61 canary + performance tests
└── integration/
    ├── pipeline.test.ts       # F-005: 17 end-to-end pipeline tests
    ├── hook.test.ts           # F-005: 14 hook integration tests
    └── sandbox-enforcer.test.ts # F-006: 14 hook integration tests
```

## Module Map

| Module | Feature | Purpose |
|--------|---------|---------|
| content-filter | F-001 | `filterContent()`, `filterContentString()` — core pipeline |
| pattern-matcher | F-001 | `loadConfig()`, `matchPatterns()` — YAML pattern library |
| encoding-detector | F-001 | `detectEncoding()` — obfuscation detection |
| schema-validator | F-001 | `validateSchema()` — Zod-based format validation |
| audit | F-002 | `logAuditEntry()`, `readAuditLog()` — JSONL logging |
| human-review | F-002 | `overrideDecision()`, `submitReview()` — human-in-loop |
| typed-reference | F-003 | `createTypedReference()`, `validateProvenance()` — immutable refs |
| quarantine-runner | F-004 | `runQuarantine()`, `loadProfile()` — subprocess isolation |
| alerts | F-005 | `alertBlock()` — stderr alert output |
| command-parser | F-006 | `extractFirstCommand()`, `tokenize()`, `classifyCommand()` — Bash command parsing |
| sandbox-rewriter | F-006 | `rewriteCommand()`, `buildHookOutput()`, `extractRepoName()` — sandbox redirection |

## Key Patterns

- **Pipeline**: encoding detection → schema validation → pattern matching → decision
- **Decision types**: ALLOWED, BLOCKED, HUMAN_REVIEW, OVERRIDE, HUMAN_APPROVED, HUMAN_REJECTED
- **Fail-open**: audit failures and hook errors never block the pipeline
- **Immutability**: TypedReferences are `Object.freeze()`d after creation
- **TDD**: All features built test-first (RED → GREEN)

## SpecFlow

All 6 features complete. Specs in `.specify/specs/f-00N-*/`.
