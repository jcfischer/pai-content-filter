# F-004: Dual-Context Sandboxing

## Problem & Pain

When a PAI agent reads cross-project content, prompt injection in that content could hijack the agent's full tool set (Bash, email, calendar, file writes). Without context isolation:
- A poisoned PROJECT.yaml could trigger `Bash` commands
- Injected instructions could access USER/ personal data
- The filter (F-001) catches known patterns, but novel attacks bypass it
- Defense-in-depth requires architectural isolation, not just pattern matching

## Users & Context

- **Primary**: PAI system automatically isolating cross-project reads
- **Secondary**: Operators configuring quarantine profiles
- **Tertiary**: Security auditors reviewing quarantine violations

## Source Requirements

From F-088:
- **R-004: Dual-Context Architecture** — Quarantined context (content reader) + Privileged context (decision maker) with one-way data flow

## Requirements

### R-001: MCP Profile Configuration

Static JSON profile for the quarantined context:
- Profile name: `cross-project`
- Allowed tools: Read, Glob, Grep, WebFetch (read-only operations)
- Denied tools: Bash, Write, Edit, NotebookEdit, plus all MCP server tools
- Denied paths: `~/.claude/skills/CORE/USER/` (personal data)
- Schema-validated via Zod

### R-002: Quarantine Runner

`runQuarantine(files, opts?)` function:
- Spawns an isolated child process
- Passes file list as arguments
- Process runs with restricted tool set (defined by MCP profile)
- Captures stdout as JSON array of TypedReferences
- Returns QuarantineResult with references, errors, timing

### R-003: Provenance Gate

Every TypedReference from quarantined output:
- Validated via `validateProvenance()` from F-003
- Invalid references rejected with error details
- Valid references returned in result
- Partial success: some valid, some invalid — return both

### R-004: Error Handling

Three error paths:
- **Timeout**: configurable (default 30s), kills process, returns timeout error
- **Non-zero exit**: returns exit code and stderr
- **Malformed output**: stdout not valid JSON array, returns parse error with raw output

### R-005: Command Builder

Pluggable command construction for testability:
- Default: spawns `k cross-project` with file args
- Tests: substitute with mock script
- `buildCommand(files, profile)` returns `{ cmd, args }`

## Data Model

```typescript
interface QuarantineConfig {
  timeoutMs: number;         // default 30000
  profilePath: string;       // path to cross-project-profile.json
  command?: string;          // override command (for testing)
}

interface QuarantineResult {
  success: boolean;
  references: TypedReference[];
  errors: string[];
  durationMs: number;
  filesProcessed: number;
  exitCode: number | null;
}

interface CrossProjectProfile {
  name: string;
  allowedTools: string[];
  deniedTools: string[];
  deniedPaths: string[];
}
```

## File Structure

```
src/lib/
└── quarantine-runner.ts  # Runner + command builder
config/
└── cross-project-profile.json
tests/
└── quarantine-runner.test.ts
```

## Edge Cases

- **No files provided**: Return empty result (success: true, 0 references)
- **Process killed externally**: Treat as non-zero exit
- **Empty stdout**: Valid — return empty references array
- **Mixed valid/invalid references**: Return valid ones, report invalid as errors
- **Extremely large output**: Read limit on stdout (1MB default)

## Success Criteria

1. MCP profile validates against schema with correct allowed/denied tools
2. Runner spawns process and collects TypedReference JSON from stdout
3. All collected references pass provenance validation
4. Timeout, exit code, malformed output all handled correctly
5. QuarantineResult has complete metadata
6. All tests pass, zero type errors

---
*Expanded from stub, 2026-01-31*
*Source requirements: R-004 from F-088*
