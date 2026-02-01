# Implementation Tasks: F-006 Sandbox Enforcer Hook

## Progress Tracking

| Task | Status | Notes |
|------|--------|-------|
| T-1.1 | ☑ | Types & schemas |
| T-2.1 | ☑ | extractFirstCommand + tokenize |
| T-2.2 | ☑ | classifyCommand |
| T-2.3 | ☑ | Command parser tests (37 tests) |
| T-3.1 | ☑ | extractRepoName |
| T-3.2 | ☑ | rewriteCommand |
| T-3.3 | ☑ | buildHookOutput |
| T-3.4 | ☑ | Sandbox rewriter tests (25 tests) |
| T-4.1 | ☑ | Hook entry point |
| T-4.2 | ☑ | Integration tests (14 tests) |
| T-5.1 | ☑ | Exports & CLAUDE.md |

## Group 1: Foundation

### T-1.1: Add F-006 types to types.ts [T]
- **File:** `src/lib/types.ts`
- **Test:** Validated transitively by T-2.3 and T-3.4 (types used in all subsequent tests)
- **Dependencies:** none
- **Description:** Add `CommandType` Zod enum (`git-clone`, `gh-clone`, `curl-download`, `wget-download`, `wget-dir`, `passthrough`), `ParsedCommand` interface, `EnforcerMode` Zod enum (`rewrite`, `block`), `RewriteResult` interface, and `HookOutputSchema` Zod schema. All types are additive — no modifications to existing types.
- **Req coverage:** Foundation for R-001, R-003, R-006

## Group 2: Command Parser

### T-2.1: Implement extractFirstCommand and tokenize [T]
- **File:** `src/lib/command-parser.ts`
- **Test:** `tests/command-parser.test.ts`
- **Dependencies:** T-1.1
- **Description:** Create `extractFirstCommand(raw: string): string` — splits on `&&`, `||`, `;` and returns the first segment (trimmed). Create `tokenize(segment: string): string[]` — splits on whitespace. Handle edge cases: empty input, whitespace-only, single command (no splitting needed).
- **Req coverage:** R-001 (chained command handling), R-002 (preserving non-acquisition commands)

### T-2.2: Implement classifyCommand [T]
- **File:** `src/lib/command-parser.ts`
- **Test:** `tests/command-parser.test.ts`
- **Dependencies:** T-1.1, T-2.1
- **Description:** Create `classifyCommand(tokens: string[]): ParsedCommand` — pattern-match first tokens to identify command type. Must handle:
  - `git clone [flags] <url> [destination]` → `git-clone` (consume value-flags from `GIT_CLONE_VALUE_FLAGS`)
  - `gh repo clone <owner/repo> [destination]` → `gh-clone`
  - `curl -o <path> <url>` / `curl <url> -o <path>` → `curl-download` (flag position varies; consume `CURL_VALUE_FLAGS`)
  - `wget -O <path> <url>` → `wget-download` (consume `WGET_VALUE_FLAGS`)
  - `wget -P <dir> <url>` → `wget-dir`
  - All others (`git commit`, `git push`, `ls`, `npm install`, etc.) → `passthrough`
- **Req coverage:** R-001 (intercept commands), R-002 (passthrough for safe commands)

### T-2.3: Write command parser tests [T] [P with T-2.1, T-2.2]
- **File:** `tests/command-parser.test.ts`
- **Dependencies:** T-1.1 (write tests first — TDD)
- **Description:** Write failing tests BEFORE implementation (RED phase). Test cases from plan:
  - `extractFirstCommand`: single command, `&&` chain, `||` chain, `;` chain, empty/whitespace
  - `classifyCommand`: git clone (bare, with dir, with flags like `--depth 1`), gh repo clone, curl -o (both flag positions), wget -O, wget -P, passthrough commands (git commit, git push, git branch, git diff, git log, git status, ls, npm install, bun test)
  - Flag-value consumption: `git clone --depth 1 <url>` must not treat `1` as URL
  - Estimated: ~30 test cases
- **Req coverage:** R-001, R-002

## Group 3: Sandbox Rewriter

### T-3.1: Implement extractRepoName [T]
- **File:** `src/lib/sandbox-rewriter.ts`
- **Test:** `tests/sandbox-rewriter.test.ts`
- **Dependencies:** T-1.1
- **Description:** Create `extractRepoName(url: string): string` — extract repository name from URL. Handle: HTTPS with/without `.git` suffix, SSH `git@` URLs, GitLab subgroup paths, trailing slashes. Returns last path segment with `.git` stripped.
- **Req coverage:** R-003 (determines sandbox subdirectory name)

### T-3.2: Implement rewriteCommand [T]
- **File:** `src/lib/sandbox-rewriter.ts`
- **Test:** `tests/sandbox-rewriter.test.ts`
- **Dependencies:** T-1.1, T-3.1
- **Description:** Create `rewriteCommand(parsed: ParsedCommand, sandboxDir: string, mode: EnforcerMode): RewriteResult`. Logic:
  - `passthrough` type → return unchanged
  - `git-clone` / `gh-clone`: no destination → append `sandboxDir/repoName`; destination outside sandbox → rewrite to `sandboxDir/basename`; destination inside sandbox → unchanged; `.` destination → rewrite to sandbox path
  - `curl-download`: output path outside sandbox → rewrite `-o` target to `sandboxDir/filename`; inside sandbox → unchanged
  - `wget-download`: rewrite `-O` target; `wget-dir`: rewrite `-P` directory
  - Block mode: if rewrite would be needed, return block result instead
- **Req coverage:** R-003 (rewrite via updatedInput), R-006 (enforcer mode)

### T-3.3: Implement buildHookOutput [T]
- **File:** `src/lib/sandbox-rewriter.ts`
- **Test:** `tests/sandbox-rewriter.test.ts`
- **Dependencies:** T-1.1, T-3.2
- **Description:** Create `buildHookOutput(result: RewriteResult, mode: EnforcerMode): HookOutput | null`. Logic:
  - Changed + rewrite mode → `{ updatedInput: { command }, permissionDecision: "allow" }`
  - Changed + block mode → `{ permissionDecision: "deny" }`
  - Not changed → `null` (passthrough — hook outputs nothing)
- **Req coverage:** R-003, R-004

### T-3.4: Write sandbox rewriter tests [T] [P with T-3.1, T-3.2, T-3.3]
- **File:** `tests/sandbox-rewriter.test.ts`
- **Dependencies:** T-1.1 (write tests first — TDD)
- **Description:** Write failing tests BEFORE implementation (RED phase). Test cases from plan:
  - `extractRepoName`: HTTPS URLs, SSH URLs, subgroup paths, trailing slashes, `.git` suffix
  - `rewriteCommand`: all command types × (no dest, outside sandbox, inside sandbox, `.` dest) × (rewrite mode, block mode)
  - `buildHookOutput`: changed+rewrite, changed+block, not changed
  - Estimated: ~25 test cases
- **Req coverage:** R-003, R-004, R-006

## Group 4: Hook Integration

### T-4.1: Create SandboxEnforcer hook entry point [T]
- **File:** `hooks/SandboxEnforcer.hook.ts`
- **Test:** `tests/integration/sandbox-enforcer.test.ts`
- **Dependencies:** T-2.1, T-2.2, T-3.2, T-3.3
- **Description:** Create thin hook wrapper following `ContentFilter.hook.ts` pattern (~50 lines):
  1. Read stdin → `JSON.parse` → extract `tool_input.command`
  2. Read `CONTENT_FILTER_SANDBOX_DIR` env var (fail-open if missing)
  3. Read `CONTENT_FILTER_ENFORCER_MODE` env var (default: `rewrite`)
  4. Call `classifyCommand(tokenize(extractFirstCommand(command)))`
  5. Call `rewriteCommand(parsed, sandboxDir, mode)`
  6. Call `buildHookOutput(result, mode)`
  7. If output: write stderr message → write stdout JSON
  8. Exit 0 (always — fail-open on all errors)
  - Stderr messages: `[SandboxEnforcer] Redirected <type> to sandbox: <path>` or `[SandboxEnforcer] BLOCKED: ...`
- **Req coverage:** R-003, R-004, R-005 (git pull is passthrough — not a clone command), R-006

### T-4.2: Write integration tests [T]
- **File:** `tests/integration/sandbox-enforcer.test.ts`
- **Dependencies:** T-4.1
- **Description:** Hook subprocess tests — spawn `bun run hooks/SandboxEnforcer.hook.ts` with piped stdin. Test cases:
  - `git clone <url>` → stdout contains `updatedInput` with sandbox path
  - `git clone <url> <dir>` outside sandbox → rewritten destination
  - `git clone <url> <sandbox/dir>` → no rewrite (passthrough)
  - `curl -o <path> <url>` outside sandbox → rewritten output path
  - `git commit -m "msg"` → passthrough (empty stdout)
  - `git pull` → passthrough (empty stdout)
  - Malformed JSON stdin → exit 0, empty stdout
  - Empty stdin → exit 0, empty stdout
  - Missing `CONTENT_FILTER_SANDBOX_DIR` → exit 0 (passthrough)
  - Block mode → stdout contains `permissionDecision: "deny"`
  - Stderr contains `[SandboxEnforcer]` message on rewrite
  - Chained `git clone a && cd a` → first segment rewritten
  - Estimated: ~15 test cases
- **Req coverage:** All success criteria from spec

## Group 5: Exports & Documentation

### T-5.1: Update exports and CLAUDE.md [P]
- **Files:** `src/index.ts`, `CLAUDE.md`
- **Test:** Validated by typecheck (`bun run typecheck`)
- **Dependencies:** T-2.1, T-2.2, T-3.1, T-3.2, T-3.3
- **Description:**
  - `src/index.ts`: Export `extractFirstCommand`, `tokenize`, `classifyCommand` from `command-parser.ts`; export `rewriteCommand`, `buildHookOutput`, `extractRepoName` from `sandbox-rewriter.ts`; export `CommandType`, `EnforcerMode`, `HookOutputSchema` from `types.ts`; export types `ParsedCommand`, `RewriteResult`, `HookOutput`
  - `CLAUDE.md`: Add `command-parser` and `sandbox-rewriter` to module map; add `SandboxEnforcer.hook.ts` to hooks; update test counts; add new test files to project structure
- **Req coverage:** Project conventions

## Execution Order

```
T-1.1 (foundation — no deps)
  │
  ├── T-2.3 + T-3.4 (write tests first — TDD RED, parallel)
  │
  ├── T-2.1 → T-2.2 (parser implementation — GREEN)
  │
  ├── T-3.1 → T-3.2 → T-3.3 (rewriter implementation — GREEN)
  │
  ├── T-5.1 (exports — parallel with T-4.x)
  │
  └── T-4.1 → T-4.2 (hook + integration tests)
```

**Critical path:** T-1.1 → T-2.1 → T-2.2 → T-3.2 → T-4.1 → T-4.2

## Requirement Traceability

| Requirement | Tasks |
|-------------|-------|
| R-001: Intercept acquisition commands | T-2.1, T-2.2, T-2.3 |
| R-002: Preserve local operations | T-2.2, T-2.3 |
| R-003: Rewrite via updatedInput | T-3.2, T-3.3, T-3.4, T-4.1 |
| R-004: Clear stderr feedback | T-3.3, T-4.1, T-4.2 |
| R-005: Handle git pull | T-4.1, T-4.2 |
| R-006: Environment configuration | T-3.2, T-4.1, T-4.2 |
