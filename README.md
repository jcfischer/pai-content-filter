# @metafactory/content-filter

Inbound content security for agent workflows. Scans any externally-sourced content before an agent reads it.

> **Note:** This package was previously published as `pai-content-filter` under `jcfischer/pai-content-filter`. It was transferred to the metafactory org on 2026-04-07 and renamed to drop the `pai-` prefix. The security model and API are unchanged.

## What This Does

Defense-in-depth security for when PAI agents consume content from external sources — cloned repos, downloaded artifacts, shared blackboards, PR content, or any file that didn't originate from the agent's own workspace. Three layers:

1. **Layer 1 — Content Filter** (F-001): Deterministic pattern matching, schema validation, and encoding detection. Catches known attack patterns.
2. **Layer 2 — Architectural Isolation** (F-004): Tool-restricted sandbox. Quarantined agent processes untrusted content with no access to personal tools or data. Primary defense.
3. **Layer 3 — Audit + Override** (F-002): Human-in-the-loop with persistent accountability trail. Last line of defense.

**Key principle:** Pattern matching is necessary but insufficient. Layer 2 must hold even when Layer 1 is completely bypassed.

## The Sandbox Directory

The core concept: **all externally-sourced content lives in a sandbox directory**. Any file under this directory is treated as untrusted and must pass the content filter before an agent can read it.

```
~/work/
  my-project/          # Your own code — NOT filtered
  another-project/     # Your own code — NOT filtered
  sandbox/             # <-- CONTENT_FILTER_SANDBOX_DIR
    pai-collab/        # Cloned external repo — FILTERED
    downloaded-pr/     # Fetched PR content — FILTERED
    external-data/     # Any external artifact — FILTERED
```

**The rule:** Agents must place all externally-sourced content (git clones, downloads, fetched artifacts) under the sandbox directory. The hook automatically gates any Read/Glob/Grep targeting paths inside it.

Content outside the sandbox is not filtered — your own project files, personal documents, and tools are unaffected.

## How It Works

There are three ways to invoke the filter. The PreToolUse hook is the primary integration.

### 1. PreToolUse Hook (automatic, primary)

The hook intercepts tool calls in Claude Code **before they execute**. When an agent tries to Read a file inside the sandbox directory, the hook runs the full filter pipeline and blocks the read if malicious content is detected.

**Setup** — add both hooks to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "CONTENT_FILTER_SANDBOX_DIR=~/work/sandbox bun run /path/to/pai-content-filter/hooks/SandboxEnforcer.hook.ts"
      },
      {
        "matcher": "Read|Glob|Grep",
        "command": "CONTENT_FILTER_SANDBOX_DIR=~/work/sandbox bun run /path/to/pai-content-filter/hooks/ContentFilter.hook.ts"
      }
    ]
  }
}
```

**How the two hooks work together:**

1. **SandboxEnforcer** (F-006) — intercepts Bash commands. When the agent runs `git clone`, `curl -o`, or `wget -O/P`, the hook rewrites the destination to target the sandbox directory. This ensures all externally-acquired content lands in the sandbox.

2. **ContentFilter** (F-001) — intercepts Read/Glob/Grep. When the agent tries to read a file inside the sandbox, the hook runs the full filter pipeline and blocks if malicious content is detected.

Together they form a complete inbound security gate: SandboxEnforcer routes content to the sandbox, ContentFilter scans it on read.

**What happens at runtime:**

```
Agent calls: Read("~/work/sandbox/pai-collab/EXTEND.yaml")
    │
    ▼
Claude Code sees PreToolUse hook matches "Read"
    │
    ▼
Spawns hook, pipes JSON to stdin:
  {"tool_name": "Read", "tool_input": {"file_path": "~/work/sandbox/pai-collab/EXTEND.yaml"}}
    │
    ▼
Hook checks:
  1. Is tool Read/Glob/Grep?              → yes, continue
  2. Is path inside SANDBOX_DIR?          → yes, continue
  3. Does file exist?                     → yes, continue
  4. Run filterContent(path)              → pipeline executes
    │
    ├── BLOCKED  → exit 2 → Claude Code PREVENTS the tool call
    ├── ALLOWED  → exit 0 → Claude Code proceeds normally
    └── REVIEW   → exit 0 → Claude Code proceeds (human review logged)
```

**Files outside the sandbox are never filtered.** The hook checks `filePath.startsWith(sandboxDir)` and exits 0 (passthrough) for anything else.

**Fail-open design:** Any error (malformed stdin, missing file, regex crash) exits 0. The hook never blocks on infrastructure failure.

### 2. CLI (manual checking)

For pre-reviewing files before consuming them:

```bash
# Check a single file
bun run src/cli.ts check path/to/EXTEND.yaml

# JSON output for scripting
bun run src/cli.ts check path/to/file.yaml --json

# View audit trail
bun run src/cli.ts audit --last 20

# View loaded patterns
bun run src/cli.ts config
```

Exit codes: 0 (ALLOWED/HUMAN_REVIEW), 1 (error), 2 (BLOCKED).

### 3. Library (programmatic)

For embedding the filter in other tools:

```typescript
import { filterContent, filterContentString } from "@metafactory/content-filter";

// Filter a file
const result = filterContent("path/to/EXTEND.yaml");
// result.decision: "ALLOWED" | "BLOCKED" | "HUMAN_REVIEW"

// Filter a string (for testing or dynamic content)
const result = filterContentString(content, "file.yaml", "yaml");

// Create a typed reference from allowed content
import { createTypedReference } from "@metafactory/content-filter";
const ref = createTypedReference(result, content, { name: "project" });

// Override a blocked result (requires reason + approver)
import { overrideDecision } from "@metafactory/content-filter";
const override = overrideDecision(result, content, "admin", "reviewed manually", auditConfig);
```

## The Filter Pipeline

All three invocation paths run the same pipeline (defined in `src/lib/content-filter.ts`):

```
File → Detect Format → Encoding Detection → Schema Validation
     → L0 Pattern Matching → L1 Heuristic Scorer → Combined Decision
```

| Step | What It Does | Short-Circuit |
|------|-------------|---------------|
| **1. Detect format** | Extension-based: `.yaml`/`.json`/`.md` | No |
| **2. Encoding detection** | Base64 (entropy-gated), unicode escapes, hex, URL-encoded, HTML entities | Yes → BLOCKED |
| **3. Schema validation** | Zod parse (YAML/JSON only) | Yes → BLOCKED |
| **4. L0 — pattern matching** | 36 regex patterns across 4 categories | No |
| **5. L1 — heuristic scorer** | Similarity scoring against a curated attack-phrase corpus | No |
| **6. Combined decision** | BLOCKED from L0 *or* L1 → BLOCKED. Markdown / L1-review → HUMAN_REVIEW. Clean → ALLOWED | — |

**Markdown always gets HUMAN_REVIEW** even when clean — free text is inherently untrustable by regex alone.

### The layered scanner (v0.2.0 — cortex#370)

`@metafactory/content-filter` runs two complementary detection layers. Both
require **zero config, zero API keys, zero network** — a fresh install gets the
full scanner out of the box.

**L0 — fast regex (`config/filter-patterns.yaml`, `src/lib/encoding-detector.ts`).**
The YAML rule set: 36 injection/exfiltration/tool/PII patterns plus 6 encoding
rules. `~1ms`, the fail-fast path for obvious cases.

The base64 encoding rule `EN-001` is **entropy-aware** (cortex#367). The bare
regex `[A-Za-z0-9+/]{21,}={0,2}` matches any 21+ char run of the base64
alphabet, so it false-positived on every GitHub URL, commit SHA and long path —
which silently blocked review pings. `src/lib/entropy.ts` adds three gates that
must all pass for a regex hit to count as base64:

- **SHA gate** — hex-only tokens of git object-name length (7/8/40) are rejected.
- **Path / URL gate** — matches inside a `://` URL or a slash-delimited path of
  lowercase path-words are rejected.
- **Shannon-entropy floor** — slash-free candidates below ~3.0 bits/char
  (repeated-character junk) are rejected.

Real random-bytes base64 (~4.5–6 bits/char, no path structure) still flags.

**L1 — heuristic scorer (`src/lib/heuristic-scorer.ts`).** A dependency-free
port of [Rebuff](https://github.com/protectai/rebuff)'s heuristic-detection
algorithm (MIT — see `THIRD-PARTY-NOTICES.md`). It normalizes the input, slides
same-word-length windows over it, and computes the maximum Sørensen–Dice bigram
similarity against a curated attack-phrase corpus (`config/attack-corpus.json`).
This catches paraphrased injection phrasing that the L0 regexes miss.

L1 is a **heuristic string-similarity scorer, not an ML classifier** — offline,
zero-config, pure CPU. Its score maps to a verdict:

| L1 score | Verdict | Effect |
|----------|---------|--------|
| `≥ 0.95` | `block`  | Near-verbatim known attack → BLOCKED |
| `≥ 0.82` | `review` | Structurally similar → HUMAN_REVIEW (non-blocking) |
| `< 0.82` | `allow`  | — |

Only `block` makes the scanner reject. The `review` band annotates the result
without blocking — bigram similarity cannot perfectly separate a paraphrased
attack from benign text that reuses attack vocabulary, so the mid band is
deliberately non-blocking.

L1 cost is linear in input size (~30ms/KB — heavier than the C-speed L0 regex
layers). To bound worst-case cost over untrusted input, the scorer processes at
most `L1_MAX_INPUT_CHARS` (8 KB) — any legitimate chat prompt fits well inside
that, the L0 regex layer still scans the full content, and a multi-MB artifact
can no longer burn seconds of CPU in L1.

> Rebuff's vector-DB layer and LLM-judge layer are **not** ported (out of scope
> per cortex#370). The published `rebuff` npm package is **not** a dependency.

## Architecture

```
External Sources (repos, PRs, downloads, artifacts)
        │
        ▼
  SANDBOX DIRECTORY (~/work/sandbox/)
  • All external content lands here
  • Anything under this path is untrusted
        │
        ▼
  LAYER 1: Content Filter (F-001)
  • Encoding detection (short-circuit)
  • Schema validation (Zod)
  • Pattern matching (36 patterns, ReDoS-protected)
  • BLOCK / ALLOW / HUMAN_REVIEW
        │
        ▼
  LAYER 2: Quarantined Context (F-004)
  • MCP: Read ONLY (no Bash, Write, WebFetch)
  • Output: TypedReference with provenance (F-003)
        │
        ▼
  PRIVILEGED CONTEXT (agent's own workspace)
  • Consumes typed references, not raw content
  • Full MCP access for own operations
        │
        ▼
  LAYER 3: Audit Trail (F-002)
  • Every decision logged (JSONL)
  • Override requires reason + approver
  • Append-only, rotated at 10MB
```

## Features

| Feature | Name | Status | Tests |
|---------|------|--------|-------|
| F-001 | Content Filter Engine | Complete | 90 |
| F-002 | Audit Trail & Override | Complete | 36 |
| F-003 | Typed References & Provenance | Complete | 33 |
| F-004 | Tool-Restricted Sandboxing | Complete | 24 |
| F-005 | Integration & Canary Suite | Complete | 121 |
| F-006 | Sandbox Enforcer Hook | Complete | 76 |
| L0/L1 | Layered Scanner (cortex#370) | Complete | entropy + heuristic + integration |
| | **Total** | — | **651** |

## Pattern Library

36 detection patterns across 4 categories + 6 encoding rules, defined in `config/filter-patterns.yaml`:

| Category | Patterns | Examples |
|----------|----------|---------|
| Injection (PI) | 11 | System prompt override, role-play, jailbreak, delimiter injection |
| Exfiltration (EX) | 5 | Path traversal, network exfil, clipboard, env leak |
| Tool Invocation (TI) | 6 | Shell commands, code execution, MCP tool invoke |
| PII (PII) | 8 | Credit cards, API keys (Anthropic/OpenAI/GitHub/AWS), PEM keys, emails, paths |
| Encoding (EN) | 6 | Base64, unicode escapes, hex, URL-encoded, HTML entities |

All patterns are regex-based, human-editable, and hot-reloadable (no restart required). ReDoS-protected via line truncation (10KB) and time-bounded regex execution (500ms).

## Agent Installation Guide

Step-by-step setup for Claude Code agents to enable inbound content security.

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- Claude Code with hook support

### Step 1: Clone the repository

```bash
git clone https://github.com/jcfischer/pai-content-filter.git ~/work/pai-content-filter
cd ~/work/pai-content-filter
bun install
```

### Step 2: Create your sandbox directory

```bash
mkdir -p ~/work/sandbox
```

This is where all externally-sourced content will be routed to and scanned.

### Step 3: Configure hooks in `.claude/settings.json`

Add both hooks to your Claude Code settings:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "CONTENT_FILTER_SANDBOX_DIR=$HOME/work/sandbox bun run $HOME/work/pai-content-filter/hooks/SandboxEnforcer.hook.ts"
      },
      {
        "matcher": "Read|Glob|Grep",
        "command": "CONTENT_FILTER_SANDBOX_DIR=$HOME/work/sandbox bun run $HOME/work/pai-content-filter/hooks/ContentFilter.hook.ts"
      }
    ]
  }
}
```

### Step 4: Verify installation

```bash
# Run the test suite to verify everything works
cd ~/work/pai-content-filter && bun test

# Test the sandbox enforcer manually
echo '{"tool_name":"Bash","tool_input":{"command":"git clone https://github.com/example/repo"}}' | \
  CONTENT_FILTER_SANDBOX_DIR=~/work/sandbox bun run hooks/SandboxEnforcer.hook.ts
# Should output JSON with updatedInput pointing to ~/work/sandbox/repo
```

### Optional: Block mode

To deny acquisition commands instead of rewriting them, add `CONTENT_FILTER_ENFORCER_MODE=block` to the SandboxEnforcer hook command:

```json
{
  "matcher": "Bash",
  "command": "CONTENT_FILTER_SANDBOX_DIR=$HOME/work/sandbox CONTENT_FILTER_ENFORCER_MODE=block bun run $HOME/work/pai-content-filter/hooks/SandboxEnforcer.hook.ts"
}
```

### What gets intercepted

| Command | Action |
|---------|--------|
| `git clone <url>` | Rewrite destination → sandbox/repoName |
| `git clone <url> <dir>` | Rewrite dir → sandbox/basename(dir) |
| `gh repo clone <owner/repo>` | Rewrite destination → sandbox/repoName |
| `curl -o <path> <url>` | Rewrite -o path → sandbox/filename |
| `wget -O <path> <url>` | Rewrite -O path → sandbox/filename |
| `wget -P <dir> <url>` | Rewrite -P dir → sandbox/ |
| `git commit`, `git push`, `ls`, etc. | Passthrough (unchanged) |
| `git pull` | Passthrough (not an acquisition command) |

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `CONTENT_FILTER_SANDBOX_DIR` | Directory containing untrusted external content | Yes (for hooks) |
| `CONTENT_FILTER_ENFORCER_MODE` | `rewrite` (default) or `block` — SandboxEnforcer behavior | No |
| `CONTENT_FILTER_SHARED_DIR` | Deprecated alias — fallback if SANDBOX_DIR not set | No |

## Stack

- TypeScript + Bun
- Zod (schema validation)
- No other external dependencies

## Relationship to CaMeL

This project draws architectural inspiration from [CaMeL (arXiv:2503.18813)](https://arxiv.org/abs/2503.18813) but diverges in significant ways. Understanding these differences is important for assessing the security properties:

| CaMeL Property | This Project | Gap |
|----------------|-------------|-----|
| **Taint propagation** — tracks data provenance through execution | Gate (allow/block at entry) | No flow tracking after gate |
| **Dual-LLM split** — control plane never sees untrusted content | Single LLM with restricted tool set | Sandbox LLM has full access to untrusted content |
| **Unforgeable capability tokens** | SHA-256 content hashes (no MAC/signature) | Forgeable across process boundaries |
| **Reasoning-based classification** | Regex pattern matching (deterministic) | Intentional — constitution requires "no LLM classification" |

The content filter provides practical defense-in-depth (pattern matching + tool restriction + audit trail) but does not achieve CaMeL's formal security guarantees, which require taint propagation.

## Related Projects

| Project | Purpose |
|---------|---------|
| [pai-collab](https://github.com/jcfischer/pai-collab) | Cross-project collaboration Blackboard |
| [pai-secret-scanning](https://github.com/jcfischer/pai-secret-scanning) | Outbound security (no secrets in commits) |
| [kai-improvement-roadmap](https://github.com/jcfischer/kai-improvement-roadmap) | Parent roadmap containing F-088 |

Together, `pai-secret-scanning` (outbound) and `pai-content-filter` (inbound) form the complete security gate for external collaboration.

## pai-collab Issues

- [#16](https://github.com/jcfischer/pai-collab/issues/16) — Security architecture
- [#17](https://github.com/jcfischer/pai-collab/issues/17) — Content filter requirements
- [#18](https://github.com/jcfischer/pai-collab/issues/18) — Dual-context sandboxing
- [#24](https://github.com/jcfischer/pai-collab/issues/24) — Canary test suite

## Research References

- [CaMeL: Defeating Prompt Injections by Design](https://arxiv.org/abs/2503.18813) — DeepMind, 2025. Architectural inspiration; this project implements a subset (see "Relationship to CaMeL" above).
- [Simon Willison on CaMeL](https://simonwillison.net/2025/Apr/11/camel/) — "99% is a failing grade" for security.
- [Moltbook](https://www.moltbook.com) — Live case study: 151k+ agents, real-world injection failures at scale (2026-01-29).
- [Simon Willison on Moltbook](https://simonwillison.net/2026/Jan/30/moltbook/) — "Normalization of Deviance" in agent systems.
- [NBC News: Moltbook](https://www.nbcnews.com/tech/tech-news/ai-agents-social-media-platform-moltbook-rcna256738) — 1,800 exposed instances leaking credentials.

## Origin

Decomposed from [F-088 (Inbound Content Security)](https://github.com/jcfischer/kai-improvement-roadmap) based on:
- Jimmy H community feedback on Blackboard security (Discord, 2026-01-31)
- Council recommendation adding inbound security as Phase 1 prerequisite
- Moltbook evidence demonstrating threat vectors at scale
- CaMeL research providing the architectural defense model

## License

MIT

See [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) for attribution of
incorporated open-source algorithms (Rebuff's heuristic detector, Microsoft
Presidio's PII patterns).
