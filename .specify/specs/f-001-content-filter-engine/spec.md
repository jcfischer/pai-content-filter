# F-001: Content Filter Engine

## Overview

The foundation content filtering library for inbound security. Provides pattern matching, schema validation, and encoding detection as a deterministic, code-based filter pipeline. No LLM classification — all decisions are regex + Zod.

This is Layer 1 of the defense-in-depth architecture. It catches known attack patterns and is necessary but insufficient on its own (Layer 2 architectural isolation is the primary defense).

## Problem Statement

Shared repository content (EXTEND.yaml, REGISTRY.md, SOPs, PRs) from pai-collab may contain prompt injection, data exfiltration instructions, or tool invocation payloads. Before any agent processes this content, it must pass through a deterministic filter that detects known attack patterns, validates structure, and rejects obfuscated content.

**Origin:** Decomposed from F-088 (Inbound Content Security) requirements R-001, R-002, R-003.

## Requirements

### R-001: Pattern Matching Engine (from F-088 R-001)

The system SHALL scan content against a YAML-based pattern library:

- **GIVEN** content from a shared repository
- **WHEN** the pattern matcher processes the content
- **THEN** it SHALL match against categorized patterns:
  - **Injection patterns** (10+ rules): system prompt overrides, role-play triggers, context manipulation, multi-turn injection, delimiter injection
  - **Exfiltration patterns** (5+ rules): direct exfil commands, path traversal, network exfil
  - **Tool invocation patterns** (5+ rules): explicit tool calls, code execution, file operations
- **AND** matching SHALL be case-insensitive by default
- **AND** multi-line support for patterns spanning line boundaries
- **AND** all matches returned (not just first) for comprehensive reporting
- **AND** each match includes: pattern ID, matched text, line number, column

### R-002: Schema Validation (from F-088 R-001)

The system SHALL validate structured files against strict Zod schemas:

- **GIVEN** a structured file (YAML, JSON)
- **WHEN** the schema validator processes the file
- **THEN** it SHALL parse the file in strict mode
- **AND** for YAML: strip all comments before validation
- **AND** for JSON: reject trailing commas or JSON5-style comments
- **AND** reject files with unknown/extra keys
- **AND** reject files with wrong value types
- **AND** produce detailed error: which field failed, expected vs actual type

Schemas needed:
- `extend-yaml.ts` — EXTEND.yaml expected structure
- `registry-md.ts` — REGISTRY.md expected table structure
- `sop.ts` — SOP markdown heading structure

### R-003: Encoding Detection (from F-088 R-003)

The system SHALL detect and reject encoded/obfuscated content without attempting to decode:

- **GIVEN** content from a shared repository
- **WHEN** the encoding detector scans the content
- **THEN** it SHALL detect:
  - Base64-encoded strings longer than 20 characters
  - Unicode escape sequences (`\u00XX`, `\x00`)
  - Hex-encoded text blocks
  - URL-encoded strings in non-URL contexts
  - HTML entities used for obfuscation (`&#x6A;avascript:`)
  - Multi-file split patterns (content referencing assembly from other files)
- **AND** encoded content is rejected outright — NO automatic decode-and-scan
- **AND** the block reason specifies which encoding type was detected

### R-004: YAML Pattern Library

The system SHALL use a human-editable YAML configuration for all patterns:

- **GIVEN** the filter pattern configuration
- **WHEN** patterns are loaded
- **THEN** the YAML file SHALL define patterns with: id, name, category, regex, severity, description
- **AND** patterns SHALL be organized by category (injection, exfiltration, tool_invocation, encoding)
- **AND** the configuration SHALL be hot-reloadable (no restart required)
- **AND** all pattern regexes SHALL compile without error on load (fail-fast)

### R-005: Filter Orchestrator

The system SHALL compose pattern matching, encoding detection, and schema validation into a pipeline:

- **GIVEN** a file to filter
- **WHEN** `filterContent(file, format)` is called
- **THEN** the pipeline SHALL execute in order:
  1. Detect file format (yaml, json, markdown, mixed)
  2. Run encoding detection — if encodings found, BLOCK immediately
  3. For structured formats: run schema validation — if schema fails, BLOCK
  4. For structured formats: strip comments, then run pattern matching
  5. For free-text (markdown): run pattern matching, then flag HUMAN_REVIEW regardless
- **AND** decision logic:
  - Any encoding match → `BLOCKED`
  - Schema validation failure → `BLOCKED`
  - Pattern match with severity `block` → `BLOCKED`
  - Free-text format (even clean) → `HUMAN_REVIEW`
  - Structured format, clean → `ALLOWED`

### R-006: CLI Interface

The system SHALL expose filtering via CLI:

- `content-filter check <file>` — Run filter, print ALLOWED/BLOCKED/HUMAN_REVIEW with details
- `content-filter config` — Display loaded filter configuration summary
- Exit codes: 0 = allowed, 1 = error, 2 = blocked
- Machine-readable output with `--json` flag

### R-007: Library Interface

The system SHALL expose core logic as importable TypeScript modules:

- `src/lib/content-filter.ts` — Top-level orchestrator
- `src/lib/pattern-matcher.ts` — Pattern matching engine
- `src/lib/encoding-detector.ts` — Encoding detection
- `src/lib/schema-validator.ts` — Schema validation
- `src/lib/types.ts` — All TypeScript interfaces and Zod schemas

All modules importable by CLI, hooks, and other features.

## Non-Functional Requirements

- **NF-001:** Filter processing SHALL complete in under 1 second per file for structured formats
- **NF-002:** Filter SHALL work fully offline (no network calls)
- **NF-003:** Zero new dependencies beyond Zod
- **NF-004:** Compatible with Bun runtime (no Node.js-only APIs)

## Data Model

```typescript
// Filter configuration (YAML-sourced)
interface FilterConfig {
  version: string;
  patterns: FilterPattern[];
  schemas: Record<string, ZodSchema>;
  encoding_rules: EncodingRule[];
}

interface FilterPattern {
  id: string;                          // e.g., "PI-001"
  name: string;                        // e.g., "system_prompt_override"
  category: "injection" | "exfiltration" | "tool_invocation" | "encoding";
  pattern: string;                     // regex
  severity: "block" | "review";
  description: string;
}

interface EncodingRule {
  type: "base64" | "unicode" | "hex" | "url_encoded" | "html_entity";
  pattern: string;                     // detection regex
  min_length?: number;                 // for base64: 20 chars
}

type FileFormat = "yaml" | "json" | "markdown" | "mixed";

interface FilterResult {
  decision: "ALLOWED" | "BLOCKED" | "HUMAN_REVIEW";
  matches: PatternMatch[];
  encodings: EncodingMatch[];
  schema_valid: boolean;
  file: string;
  format: FileFormat;
}

interface PatternMatch {
  pattern_id: string;
  pattern_name: string;
  category: string;
  severity: string;
  matched_text: string;
  line: number;
  column: number;
}

interface EncodingMatch {
  type: string;
  matched_text: string;
  line: number;
  column: number;
}
```

## File Structure

```
src/
├── lib/
│   ├── types.ts              # All interfaces and Zod schemas
│   ├── content-filter.ts     # Filter orchestrator
│   ├── pattern-matcher.ts    # Pattern matching engine
│   ├── encoding-detector.ts  # Encoding detection
│   └── schema-validator.ts   # Schema validation
├── commands/
│   └── content-filter.ts     # CLI entry point
└── cli.ts                    # CLI runner
config/
├── filter-patterns.yaml      # Pattern library
└── schemas/
    ├── extend-yaml.ts        # EXTEND.yaml Zod schema
    ├── registry-md.ts        # REGISTRY.md structure
    └── sop.ts                # SOP markdown structure
tests/
├── types.test.ts
├── pattern-matcher.test.ts
├── encoding-detector.test.ts
├── schema-validator.test.ts
└── content-filter.test.ts
```

## Success Criteria

- [ ] Pattern library loads from YAML with 20+ patterns across 3 categories
- [ ] All pattern regexes compile without error
- [ ] Schema validation catches malformed EXTEND.yaml, REGISTRY.md, SOPs
- [ ] Encoding detection catches base64, unicode, hex, URL-encoded, HTML entities
- [ ] Pipeline short-circuits on encoding match (doesn't run further checks)
- [ ] Free-text always returns HUMAN_REVIEW even when clean
- [ ] CLI exits with correct codes (0/1/2)
- [ ] Library modules independently importable
- [ ] Processing completes in < 1 second for typical files

## References

- F-088 spec: `kai-improvement-roadmap/.specify/specs/f-088-inbound-content-security/spec.md`
- F-088 plan: `kai-improvement-roadmap/.specify/specs/f-088-inbound-content-security/plan.md`
- F-088 tasks: Groups 1-2 (T-1.0 through T-2.4, T-5.1)
- CaMeL paper: https://arxiv.org/abs/2503.18813
- pai-collab issues: #16, #17, #18, #24

---
*Decomposed from F-088, 2026-01-31*
*Source requirements: R-001, R-002, R-003*
