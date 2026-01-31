# Technical Plan: Sandbox Enforcer Hook (F-006)

## Architecture Overview

Three modules following library-first principle. The hook is a thin wrapper (~40 lines); all parsing and rewriting logic lives in `src/lib/` for independent testing.

```
stdin (JSON)                                   stdout (JSON)
  │                                               ▲
  ▼                                               │
┌──────────────────────────────────────────────────────────────┐
│  hooks/SandboxEnforcer.hook.ts  (PreToolUse on Bash)         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. Read stdin → JSON.parse                             │  │
│  │ 2. Extract tool_input.command                          │  │
│  │ 3. Call pipeline ──────────────────────────┐           │  │
│  │ 4. Write stderr message                    │           │  │
│  │ 5. Write stdout JSON                       │           │  │
│  │ 6. Exit 0 (always)                         │           │  │
│  └────────────────────────────────────────────│───────────┘  │
└───────────────────────────────────────────────│──────────────┘
                                                │
                              ┌─────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  src/lib/command-parser.ts  (pure functions, zero I/O)       │
│                                                              │
│  extractFirstCommand(raw)                                    │
│    └── split on && || ; → first segment                      │
│                                                              │
│  tokenize(segment)                                           │
│    └── split on whitespace → string[]                        │
│                                                              │
│  classifyCommand(tokens)                                     │
│    └── pattern-match first tokens → ParsedCommand            │
│        { type, url, destination, flags, tokens }             │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  src/lib/sandbox-rewriter.ts  (pure functions, zero I/O)     │
│                                                              │
│  rewriteCommand(parsed, sandboxDir, mode)                    │
│    └── compute new destination → RewriteResult               │
│        { rewritten, original, changed, newPath }             │
│                                                              │
│  buildHookOutput(result, mode)                               │
│    └── format for Claude Code hook protocol → HookOutput     │
│        { updatedInput?, permissionDecision }                 │
│                                                              │
│  extractRepoName(url)                                        │
│    └── URL → basename (strip .git, extract last segment)     │
└──────────────────────────────────────────────────────────────┘
```

### Module Separation Rationale

- **command-parser.ts** has zero knowledge of sandbox paths — it is a pure command tokenizer/classifier
- **sandbox-rewriter.ts** has zero knowledge of command syntax — it receives a classified command and rewrites paths
- **SandboxEnforcer.hook.ts** is glue code only — reads stdin, calls pipeline, writes stdout/stderr

This separation means parser tests need zero filesystem setup, rewriter tests need zero command parsing, and the hook integration test is the only place both combine.

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Project standard — all existing hooks and modules use Bun |
| Validation | Zod | Project standard — all types in types.ts use Zod schemas |
| Testing | `bun test` | Project standard — 303+ existing tests use `bun:test` |
| External deps | None | Project constraint — zero external dependencies beyond Zod |
| Hook protocol | Claude Code PreToolUse | Same protocol as ContentFilter.hook.ts (stdin JSON → stdout JSON) |

## Data Model

### New Types (added to `src/lib/types.ts`)

```typescript
// --- Command Parser Types (F-006) ---

export const CommandType = z.enum([
  "git-clone",
  "gh-clone",
  "curl-download",
  "wget-download",
  "wget-dir",
  "passthrough",
]);
export type CommandType = z.infer<typeof CommandType>;

export interface ParsedCommand {
  type: CommandType;
  url: string | null;         // extracted URL (null for passthrough)
  destination: string | null; // explicit destination path (null if absent)
  flags: string[];            // preserved flags (e.g., ["--depth", "1"])
  tokens: string[];           // original token array
  raw: string;                // original command string (first segment)
}

// --- Sandbox Rewriter Types (F-006) ---

export const EnforcerMode = z.enum(["rewrite", "block"]);
export type EnforcerMode = z.infer<typeof EnforcerMode>;

export interface RewriteResult {
  rewritten: string;    // full command string after rewrite
  original: string;     // original command string
  changed: boolean;     // whether any rewrite occurred
  newPath: string | null; // new sandbox destination (null if unchanged)
}

export const HookOutputSchema = z.object({
  updatedInput: z.object({
    command: z.string(),
  }).optional(),
  permissionDecision: z.enum(["allow", "ask", "deny"]).optional(),
});
export type HookOutput = z.infer<typeof HookOutputSchema>;
```

### Relationship to Existing Types

```
Existing types.ts                    New F-006 types
──────────────────                   ──────────────────
FilterDecision (enum)                CommandType (enum)
  └── ALLOWED/BLOCKED/...             └── git-clone/gh-clone/...
FilterResult (interface)             ParsedCommand (interface)
  └── decision, matches, file          └── type, url, destination
                                     RewriteResult (interface)
                                       └── rewritten, changed, newPath
                                     HookOutput (schema)
                                       └── updatedInput, permissionDecision
```

No changes to existing types. F-006 types are additive only.

### Flag-Value Consumption Table

Hardcoded per command type to prevent misclassifying flag values as URLs/destinations:

```typescript
const GIT_CLONE_VALUE_FLAGS = new Set([
  "--depth", "--branch", "-b", "--origin", "-o",
  "--config", "-c", "--reference", "--separate-git-dir",
  "--template", "-j", "--jobs",
]);

const CURL_VALUE_FLAGS = new Set([
  "-o", "--output", "-H", "--header", "-d", "--data",
  "-u", "--user", "-x", "--proxy", "-e", "--referer",
  "-A", "--user-agent", "--connect-timeout", "--max-time",
]);

const WGET_VALUE_FLAGS = new Set([
  "-O", "--output-document", "-P", "--directory-prefix",
  "--header", "--post-data", "--user", "--password",
  "--timeout", "--tries", "-t",
]);
```

## API Contracts

### Hook Input (stdin)

Received from Claude Code when a Bash tool call is intercepted:

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "git clone https://github.com/someone/repo.git ~/work/repo",
    "description": "Clone repository"
  }
}
```

### Hook Output (stdout)

**Rewrite case** — command redirected to sandbox:

```json
{
  "updatedInput": {
    "command": "git clone https://github.com/someone/repo.git ~/work/sandbox/repo"
  },
  "permissionDecision": "allow"
}
```

**Block case** — command denied (block mode only):

```json
{
  "permissionDecision": "deny"
}
```

**Passthrough case** — no output, exit 0:

(empty stdout, hook exits silently)

**Ambiguous case** — ask user to confirm:

```json
{
  "permissionDecision": "ask"
}
```

### Hook stderr Messages

All user-facing feedback goes to stderr (following ContentFilter pattern):

```
[SandboxEnforcer] Redirected git clone to sandbox: ~/work/sandbox/repo
[SandboxEnforcer] Redirected download to sandbox: ~/work/sandbox/data.json
[SandboxEnforcer] BLOCKED: Cannot safely rewrite piped download. Use: curl <url> -o ~/work/sandbox/<filename>
[SandboxEnforcer] BLOCKED: External content acquisition denied (block mode)
```

### Hook Configuration (Claude Code settings.json)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "CONTENT_FILTER_SANDBOX_DIR=~/work/sandbox bun run hooks/SandboxEnforcer.hook.ts"
      },
      {
        "matcher": "Read|Glob|Grep",
        "command": "CONTENT_FILTER_SANDBOX_DIR=~/work/sandbox bun run hooks/ContentFilter.hook.ts"
      }
    ]
  }
}
```

Both hooks share `CONTENT_FILTER_SANDBOX_DIR`. No conflicts — different matchers.

### Environment Variables

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `CONTENT_FILTER_SANDBOX_DIR` | Sandbox directory path | — | Yes (fail-open if missing) |
| `CONTENT_FILTER_ENFORCER_MODE` | `rewrite` or `block` | `rewrite` | No |

## Implementation Phases

TDD workflow: RED (write failing test) → GREEN (implement) → refactor.

### Phase 1: Types & Schemas

Add new Zod schemas and TypeScript interfaces to `src/lib/types.ts`:
- `CommandType` enum
- `ParsedCommand` interface
- `EnforcerMode` enum
- `RewriteResult` interface
- `HookOutputSchema` Zod schema

**Requirement coverage:** Foundation for all requirements.

### Phase 2: Command Parser (TDD)

Create `src/lib/command-parser.ts` with tests in `tests/command-parser.test.ts`:

1. **RED:** Write tests for `extractFirstCommand()`:
   - Single command → returns as-is
   - `cmd1 && cmd2` → returns `cmd1`
   - `cmd1 || cmd2` → returns `cmd1`
   - `cmd1 ; cmd2` → returns `cmd1`
   - Empty/whitespace → returns empty

2. **RED:** Write tests for `classifyCommand()`:
   - `git clone <url>` → `{ type: "git-clone", url, destination: null }`
   - `git clone <url> <dir>` → `{ type: "git-clone", url, destination: dir }`
   - `git clone --depth 1 <url>` → preserves flags, finds URL
   - `gh repo clone owner/repo` → `{ type: "gh-clone" }`
   - `curl -o file.json <url>` → `{ type: "curl-download", destination: "file.json" }`
   - `curl <url> -o file.json` → same (flag position doesn't matter)
   - `wget -O file <url>` → `{ type: "wget-download" }`
   - `wget -P dir <url>` → `{ type: "wget-dir" }`
   - `git commit -m "msg"` → `{ type: "passthrough" }`
   - `ls -la` → `{ type: "passthrough" }`
   - `npm install` → `{ type: "passthrough" }`

3. **GREEN:** Implement parser to pass all tests.

**Requirement coverage:** R-001 (intercept commands), R-002 (preserve local ops).

### Phase 3: Sandbox Rewriter (TDD)

Create `src/lib/sandbox-rewriter.ts` with tests in `tests/sandbox-rewriter.test.ts`:

1. **RED:** Write tests for `extractRepoName()`:
   - `https://github.com/owner/repo.git` → `repo`
   - `https://github.com/owner/repo` → `repo`
   - `git@github.com:owner/repo.git` → `repo`
   - `https://gitlab.com/group/subgroup/repo.git` → `repo`
   - Edge: URL with trailing slash → strip before extract

2. **RED:** Write tests for `rewriteCommand()`:
   - git-clone with no destination → appends `sandboxDir/repo`
   - git-clone with destination outside sandbox → rewrites to `sandboxDir/dirname`
   - git-clone with destination inside sandbox → returns unchanged
   - git-clone with `.` as destination → rewrites `.` to sandbox path
   - curl-download outside sandbox → rewrites `-o` path
   - wget-download outside sandbox → rewrites `-O` path
   - wget-dir outside sandbox → rewrites `-P` path
   - passthrough → returns unchanged
   - Block mode + rewrite needed → returns block result

3. **RED:** Write tests for `buildHookOutput()`:
   - Changed + rewrite mode → `{ updatedInput, permissionDecision: "allow" }`
   - Changed + block mode → `{ permissionDecision: "deny" }`
   - Not changed → null (passthrough)

4. **GREEN:** Implement rewriter to pass all tests.

**Requirement coverage:** R-003 (rewrite via updatedInput), R-004 (stderr feedback), R-006 (env config).

### Phase 4: Hook Entry Point

Create `hooks/SandboxEnforcer.hook.ts`:

1. Thin wrapper following `ContentFilter.hook.ts` pattern
2. Read stdin → parse JSON → extract `tool_input.command`
3. Call `classifyCommand(extractFirstCommand(command))`
4. Call `rewriteCommand(parsed, sandboxDir, mode)`
5. Call `buildHookOutput(result, mode)`
6. Write stderr message → write stdout JSON → exit 0
7. Fail-open on all errors

**Requirement coverage:** R-003, R-004, R-005 (git pull handling — passthrough since it's not a clone command).

### Phase 5: Integration Tests

Create `tests/integration/sandbox-enforcer.test.ts`:

1. Hook subprocess tests (spawn `bun run hooks/SandboxEnforcer.hook.ts`):
   - `git clone <url>` → stdout contains `updatedInput` with sandbox path
   - `git clone <url> <sandbox/dir>` → no rewrite
   - `curl -o path <url>` → rewrite output path
   - `git commit -m "msg"` → passthrough (empty stdout)
   - Malformed JSON stdin → exit 0
   - Empty stdin → exit 0
   - Missing `CONTENT_FILTER_SANDBOX_DIR` → exit 0 (passthrough)
   - Block mode → stdout contains `permissionDecision: "deny"`

2. Full chain test:
   - SandboxEnforcer rewrites clone → content lands in sandbox dir → ContentFilter scans on read

**Requirement coverage:** All success criteria from spec.

### Phase 6: Exports & Documentation

1. Update `src/index.ts` — export new modules
2. Update `CLAUDE.md` — add new files to module map and test counts

**Requirement coverage:** Project conventions.

## File Structure

```
src/lib/
├── command-parser.ts        # NEW — tokenizer + command classifier
├── sandbox-rewriter.ts      # NEW — path rewriting + hook output builder
├── types.ts                 # MODIFY — add CommandType, ParsedCommand, RewriteResult, HookOutput
├── content-filter.ts        # unchanged
├── pattern-matcher.ts       # unchanged
├── encoding-detector.ts     # unchanged
├── schema-validator.ts      # unchanged
├── audit.ts                 # unchanged
├── human-review.ts          # unchanged
├── typed-reference.ts       # unchanged
├── quarantine-runner.ts     # unchanged
└── alerts.ts                # unchanged

hooks/
├── SandboxEnforcer.hook.ts  # NEW — PreToolUse hook entry point
└── ContentFilter.hook.ts    # unchanged

tests/
├── command-parser.test.ts           # NEW — parser unit tests (bulk of tests)
├── sandbox-rewriter.test.ts         # NEW — rewriter unit tests
├── integration/
│   ├── sandbox-enforcer.test.ts     # NEW — hook integration tests
│   ├── pipeline.test.ts             # unchanged
│   └── hook.test.ts                 # unchanged
├── content-filter.test.ts           # unchanged
├── encoding-detector.test.ts        # unchanged
├── audit.test.ts                    # unchanged
├── human-review.test.ts             # unchanged
├── typed-reference.test.ts          # unchanged
├── quarantine-runner.test.ts        # unchanged
└── canary.test.ts                   # unchanged

src/
├── index.ts                 # MODIFY — export new modules
└── cli.ts                   # unchanged (no CLI commands for F-006 in v1)
```

### New File Count: 5 created, 2 modified

| File | Action | Estimated Lines |
|------|--------|----------------|
| `src/lib/command-parser.ts` | Create | ~120 |
| `src/lib/sandbox-rewriter.ts` | Create | ~100 |
| `hooks/SandboxEnforcer.hook.ts` | Create | ~50 |
| `tests/command-parser.test.ts` | Create | ~250 |
| `tests/sandbox-rewriter.test.ts` | Create | ~200 |
| `tests/integration/sandbox-enforcer.test.ts` | Create | ~150 |
| `src/lib/types.ts` | Modify | +30 |
| `src/index.ts` | Modify | +10 |

## Dependencies

### Internal Dependencies (within pai-content-filter)

| Module | Depends On | Why |
|--------|-----------|-----|
| `command-parser.ts` | `types.ts` | `CommandType`, `ParsedCommand` types |
| `sandbox-rewriter.ts` | `types.ts` | `RewriteResult`, `HookOutput`, `EnforcerMode` types |
| `SandboxEnforcer.hook.ts` | `command-parser.ts`, `sandbox-rewriter.ts` | Pipeline composition |

### External Dependencies

None. Zero new external dependencies.

### Runtime Dependencies

| Dependency | Type | Required |
|-----------|------|----------|
| Bun runtime | Runtime | Yes — runs hook scripts |
| `CONTENT_FILTER_SANDBOX_DIR` env | Configuration | Yes (fail-open if missing) |
| Claude Code hook protocol | Platform | Yes — provides stdin JSON, interprets stdout JSON |

### Prerequisites Before Implementation

1. F-001 through F-005 complete (they are — 303 tests passing)
2. No changes to existing modules required
3. No database, no network, no external APIs

## Risk Assessment

### Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Shell command parsing misses edge cases | Medium — bypass allows unscanned content | High — shell syntax is infinitely complex | Fail-open design; document known limitations; v2 can add quote-aware parsing |
| Claude Code changes hook protocol | High — hook stops working | Low — stable API | Integration test catches immediately; protocol is simple JSON |
| `updatedInput` field not honored by Claude Code | High — rewrites silently ignored | Low — documented feature | Integration test validates end-to-end; fallback is block mode |
| Agent uses unlisted download tool (e.g., `aria2c`, `rsync`) | Medium — content bypasses sandbox | Medium — agents can learn new tools | Maintain command allowlist; add patterns in v2 |
| Chained commands bypass first-segment-only parsing | Medium — second clone in chain unscanned | Medium — agents chain commands regularly | Document limitation; v2 can parse all segments |

### Failure Mode Analysis

| Failure Mode | Trigger | Behavior | Rationale |
|-------------|---------|----------|-----------|
| Unparseable command | Complex shell constructs, heredocs | Passthrough (exit 0) | Fail-open — spec mandates |
| Missing SANDBOX_DIR env | Env var not set | Passthrough (exit 0) | Cannot enforce without a target |
| Path with spaces | `git clone url "my dir"` | Fail-open (spaces break tokenizer) | v1 constraint; documented |
| Pipe chain | `curl url \| jq > file` | Passthrough | Cannot safely rewrite piped output |
| Subshell | `$(git clone ...)` | Passthrough | Hook sees outer command only |
| Script execution | `bash script.sh` containing clone | Passthrough | Hook sees `bash script.sh`, not contents |
| Multiple clones | `git clone a && git clone b` | Rewrite first only | Spec mandates first-segment-only |
| Malformed JSON stdin | Claude Code bug or protocol change | Passthrough (exit 0) | Fail-open |
| Empty stdin | No input | Passthrough (exit 0) | Fail-open |
| URL without recognizable repo name | `https://example.com/download` | Use last path segment as dirname | Best-effort; may produce awkward names |

### Assumptions That Could Break

| Assumption | What Would Invalidate It | Detection | Mitigation |
|-----------|-------------------------|-----------|------------|
| Claude Code sends `tool_input.command` for Bash | API change in hook protocol | Hook receives unexpected JSON shape | Fail-open + integration test |
| `updatedInput` rewrites the command | Claude Code removes this feature | Rewritten commands don't execute | Block mode as fallback |
| Agents use standard git/curl/wget | New download tools emerge | Bypass via unknown tools | Extensible command classifier |
| Whitespace tokenization suffices for v1 | Agents send quoted paths frequently | Fail-open + audit trail (future v2) | v2: quote-aware tokenizer |

### Blast Radius

- **Files touched:** 5 new, 2 modified
- **Existing code affected:** None (new hook, new modules; no changes to F-001–F-005)
- **Rollback:** Remove hook entry from `settings.json` — instant disable, zero code changes needed
- **Test isolation:** New tests are independent; existing 303 tests unaffected

## Requirement Traceability

| Requirement | Plan Section | Module |
|-------------|-------------|--------|
| R-001: Intercept acquisition commands | Phase 2 (parser), Data Model (CommandType) | command-parser.ts |
| R-002: Preserve local operations | Phase 2 (passthrough classification) | command-parser.ts |
| R-003: Rewrite via updatedInput | Phase 3 (rewriter), API Contracts | sandbox-rewriter.ts |
| R-004: Clear stderr feedback | Phase 4 (hook), API Contracts (stderr) | SandboxEnforcer.hook.ts |
| R-005: Handle git pull | Phase 4 (passthrough — not a clone) | SandboxEnforcer.hook.ts |
| R-006: Environment configuration | API Contracts (env vars), Phase 4 | SandboxEnforcer.hook.ts |
