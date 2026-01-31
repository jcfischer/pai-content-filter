# F-004: Dual-Context Sandboxing

## Overview

CaMeL-inspired dual-context separation for cross-project content consumption. A quarantined agent processes untrusted content in isolation (no personal tools, no personal context), producing TypedReferences that the privileged agent (Kai) can safely consume.

**Status:** Stub — to be fully specified when implementation reaches this feature.

## Source Requirements

From F-088:
- **R-004: Dual-Context Architecture** — Quarantined context (content reader) + Privileged context (decision maker) with one-way data flow

## Key Capabilities

### Quarantined Context
- Isolated agent context for reading untrusted content
- NO access to: USER/ directory, email, calendar, Tana MCP tools, Bash, Write, Edit
- ONLY access to: Read (shared repo files), Glob, Grep, structured output generation
- Enforced at MCP configuration level via dedicated `cross-project` MCP profile (not prompt instructions)
- Attempts to access sandboxed resources logged as security events
- Produces TypedReferences as output

### Privileged Context
- Full MCP access for Kai's operations
- Consumes ONLY structured TypedReferences, never raw shared content
- References carry provenance metadata
- Treats all cross-project references as untrusted data, not instructions

### Quarantine Runner
- Spawns `k cross-project` as separate process (true context isolation)
- Passes file list to quarantined session
- Collects TypedReference JSON from stdout
- Validates provenance before passing to privileged context
- Handles: timeout (30s default), non-zero exit, malformed output

### MCP Profile
- Profile name: `cross-project` in `~/.config/k/profiles.json`
- Allowed tools: Read, Glob, Grep, WebFetch (read-only)
- Denied tools: Bash, Write, Edit, NotebookEdit + all MCP tools
- Denied paths: `~/.claude/skills/CORE/USER/`

### Data Flow
```
Quarantined → TypedReferences → Privileged
                  NEVER the reverse
```

## Dependencies

- **F-001** (Content Filter Engine) — filter runs before quarantine
- **F-003** (Typed References) — quarantine runner produces TypedReferences

## File Structure

```
src/lib/
└── quarantine-runner.ts  # Spawn quarantined k session, collect references
config/
└── cross-project-profile.json  # MCP profile definition
```

## F-088 Task Mapping

| F-088 Task | Description |
|------------|-------------|
| T-4.2 | Cross-project MCP profile |
| T-4.3 | Quarantine runner |

## Research Reference

Google DeepMind's CaMeL framework (arXiv:2503.18813):
- **P-LLM** (Privileged) → maps to our Privileged Context
- **Q-LLM** (Quarantined) → maps to our Quarantined Context
- **Capability-based security** → maps to our provenance metadata

---
*Decomposed from F-088, 2026-01-31*
*Source requirements: R-004*
