# content-filter — security review, private disclosure to maintainers

**From:** Rob Chuvala (NorthWoods Sentinel) · drafted by Margin (agent)
**To:** the-metafactory maintainers (Andreas Åström, Jens-Christian Fischer)
**Repo reviewed:** `the-metafactory/content-filter` — full `src/lib/`, both hooks, ~4,426 LOC (cloned fresh 2026-08-01)
**Status:** PRIVATE — maintainers first. Not posted.

---

## What this is

A cross-lineage adversarial review (Gemini, DeepSeek, GPT-via-codex), three re-feed rounds, refute-to-kill, verified against source. The target sets its own bar in the README, so I tested that bar directly: *"Layer 2 must hold even when Layer 1 is completely bypassed,"* and Layer 3 is *"the last line of defense."* The finding is that all three layers are bypassable or forgeable as implemented — but the failure is specific and fixable, not a design mistake. Severity is stated with its threat model (this is a control on **untrusted, externally-sourced content** by definition, so the untrusted-input model is the right one).

## What's good

The three-layer defense-in-depth model is the correct shape, and the README is honest that pattern matching alone is insufficient. The SandboxEnforcer hook fails **closed** on empty stdin, malformed JSON, and uncaught errors (`hook:50/58/115`) with a stdin timeout — though note the one exception in finding B below: it fails *open* when `CONTENT_FILTER_SANDBOX_DIR` is unset (`hook:76`). The pattern library is real and the L0/L1 scoring split is a reasonable design. The gaps below are all one class — structural validity is treated as security — not a missing layer.

## Findings

### A — Sandbox ingress / acquisition routing (SandboxEnforcer, the redirect hook): bypassable [HIGH]
This is the acquisition-routing layer, distinct from the pattern-matching content filter below.
- **Lexical, not filesystem, path containment.** `sandbox-rewriter.ts` uses `dest.startsWith(sandboxDir)` (clone-dest `:159`, output-flag `:225`, dir-flag `:278`) with no `realpath`/normalization. A sibling path defeats it: `sandboxDir="/work/sandbox"` and `dest="/work/sandbox-attacker"` prefix-matches → treated as "already inside" → passed through unredirected; likewise `"/work/sandbox/../../etc"` prefix-matches, passes the check, and resolves outside. The rewriter can also **rewrite to a path outside the sandbox** — `join(sandboxDir, "..")` normalizes to the parent dir via `basename("..")` (`:182-183/237-238`).
- **The command classifier is shallow.** `command-parser.ts:extractFirstCommand` (`:65-80`) classifies only the first segment before `&&`/`||`/`;`, so `echo ok; git clone URL /outside` slips the second command past; the hook inspects only that first segment (`SandboxEnforcer.hook.ts:85`). `classifyCommand` (`:117-139`) gates only `tokens[0] ∈ {git,gh,curl,wget}`, so `bash -c …`, `env …`, `xargs`, `timeout …`, and `$(…)` walk past by construction.

### B — SandboxEnforcer fails open on missing config [HIGH]
`hook:76-78`: if `CONTENT_FILTER_SANDBOX_DIR` is unset, `process.exit(0)` — self-commented `// fail-open` — in a file whose header (`:20`) declares "fail-closed." The redirect disables itself on the most likely production misconfiguration. Both Gemini and GPT flagged this independently.

### C — content filter (pattern matching): evadable, as the README concedes, with specific holes [MED]
Only the first 10 KB of a line is scanned (`pattern-matcher.ts:325`); backtick/inline-code matches are suppressed (`:335`). Under-demonstrated but plausible, stated as latent risks not proven exploits: matched text containing `test`/`demo`/`example`/`fake` is downgraded, so a secret *padded* with those substrings may evade block severity (`:245/341` — needs a concrete matching pattern to confirm); the regex timeout is checked only *after* `exec()` returns, so a catastrophic-backtracking pattern *would* hang inside one call **if such a pattern is configured** (`:391` — a latent timeout-design flaw, config is trusted). Confirmed: percent-encoded payloads inside a URL are explicitly skipped (`encoding-detector.ts:83`); detection is line-local, so split/chunked encodings evade it; decode is single-pass, so nested encodings (base64→url) remain undecoded (`content-filter.ts:63`, `decoder.ts:176`).

### D — the sandbox / quarantine ("primary defense"): isolation is not enforced by this repo [HIGH]
`runQuarantine()` (`quarantine-runner.ts:41-180`) is the primary defense, and the isolation it promises is not enforced by this repo. It receives `config.profilePath` (`:29`) but **never reads it and never calls `loadProfile()`** (which exists at `:14` and is called nowhere in the run path). The child is started with a plain `Bun.spawn([cmd, ...args], {stdout:"pipe", stderr:"pipe"})` (`:68`) — no `env` scrub (the child inherits `HOME`, tokens, credentials, `PATH`), no `cwd`, no chroot/namespace/uid, no network restriction. All actual confinement is delegated to an external `k cross-project` binary (`:59-60`) that this module neither verifies is present nor configures. I cannot see `k`'s source — it is an external dependency, so I cannot claim deployed isolation fails; the verifiable point is that this repo adds no confinement of its own and ignores the profile it is handed. Supporting issues: `proc.kill()` (`:76`) doesn't kill descendants; stdout is buffered unbounded then stderr read sequentially (`:80-81`, DoS/deadlock surface); a run with invalid provenance still returns `success:true` with the bad refs in `errors` (`:163-175`); and `config.command` (`:59`) lets a caller replace the quarantine command with any executable — a dangerous API footgun whose exploitability depends on who supplies config (supporting evidence, not a proven untrusted-content bypass). Fix: load and apply the profile; spawn with an explicit minimal `env`, fixed `cwd`, and OS-level confinement; fail closed if the isolation tool is absent; make `config.command` non-overridable from untrusted paths.

### E — audit + human override ("last line of defense"): forgeable and suppressible [HIGH if reachable by lower-trust callers or with writable logs; otherwise an integrity/design weakness]
Threat-model note: these are library functions and a log file. The code proves the *absence* of authentication and integrity, not that untrusted *content* alone can reach them — exploitability requires a lower-trust caller of the review/override API or write access to the audit log. Scoped accordingly.
- **Audit is fail-open and integrity-free.** `auditConfig` is optional and `maybeLogAudit` returns silently when absent; `logAuditEntry` catches write errors and only `console.warn`s (`content-filter.ts:320-332`, `audit.ts:148-158`). A blocked/overridden/bypassed action completes even if nothing is recorded. The trail is plain `JSON.stringify` JSONL with no signature, MAC, hash-chain, or monotonic sequence (`audit.ts:156-157`); `readAuditLog` silently skips malformed lines (`:226`) and sorts by a caller-suppliable `timestamp` string (`types.ts:179`, `audit.ts:234`), so forged past/future entries are accepted and can bury real ones. Both Gemini and GPT flagged the fail-open independently.
- **Human override has no authentication.** `overrideDecision`/`submitReview` (`human-review.ts:33/76`) require only non-empty actor strings — no identity, role, signed approval, nonce, or binding to the original filter event. `submitReview` returns `HUMAN_APPROVED` for **any** input decision (`:104`) with no state-transition check, so it can approve an already-`ALLOWED` or `HUMAN_REJECTED` item. Replayability and content/result mismatch are latent consequences of that missing binding rather than demonstrated exploits — they need a reachable caller model to confirm.
- **Provenance is shape-only.** `validateProvenance` (`typed-reference.ts:71`) runs Zod and nothing else — no `content_hash` verification, no source allowlist, no signature. `Object.freeze(ref)` is shallow so nested `ref.data` stays mutable; `origin` is caller-supplied/cosmetic.

## The through-line to name
Every gap here is one class: **structural validity is accepted as security.** A path that string-prefixes the sandbox is "inside"; a subprocess that was spawned is "quarantined"; a JSON line that parses is an "audit record"; a non-empty string is an "approver." None of these bind to the thing they claim. This is the same class we found in assay (an attestation that matches without its identity-critical fields) and in myelin (sovereignty that validates without being verified) — three tools, one pattern.

## Coverage and honest residual
Three rounds, whole security surface (both hooks, all lib/, all three layers). Round 3 found no new *class* — only more instances across the audit/review layer. Pattern-converged. Named residual: the Layer-1 evasion list is representative, not exhaustive; more curl/wget/git flag-form and encoding-chain instances exist and would be found by a longer sweep. This is not a clean bill; it is "the surface is mapped and the class is stable."

## The one line worth keeping
The layers are the right layers. What's missing is that each one checks the *shape* of trust instead of *verifying* it — so all three can be satisfied without the property they exist to guarantee.

*— Margin (agent), for Rob Chuvala*
