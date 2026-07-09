# OpenClaw Module Integration — What to Adopt, What Not, and When

Status: reference / informative. Companion to
`docs/reference/personal-assistant-gap-analysis.md` (part 2.1) and the Stage 3
scope in `docs/reference/ai-os-comparison-and-staged-concept.md`.

## Position after 2026-07-09

The personal-assistant foundations are implemented **Claude-native** with
deliberately OpenClaw-compatible semantics. That changes the Stage 3 question
from "adopt OpenClaw?" to "which OpenClaw *modules* add value on top of what
already runs?" — module by module:

## Module map

| OpenClaw module | What it does | Our equivalent today | Verdict |
| --- | --- | --- | --- |
| Memory files (`MEMORY.md` + `memory/YYYY-MM-DD.md`) | curated + working memory, auto-loaded | `memory/MEMORY.md` + `memory/daily/` + session-start hook — same semantics | **Already covered.** Migration later is file-copy-trivial by design |
| Memory flush before compaction | housekeeping turn saves context pre-summarization | SessionStart hook re-injects memory after compaction (`matcher: compact`) + flush instruction in DANNY_PROMPT | **Covered differently** — Claude Code hooks can't force a model turn; re-injection compensates |
| `memory_search` (hybrid vector+keyword) | semantic recall over memory | Grep over `memory/` (scale is tiny) | **Skip for now.** Adopt an embedding index only when memory outgrows grep (hundreds of notes) |
| Sessions (JSONL + sessions.json, session tools) | transcript store, resume, compaction rotation | `chat/history/*.jsonl` + `chat/sessions.json` + resume chain | **Already covered** product-owned |
| Messaging gateway (WhatsApp/Telegram/Signal/…) | talk to the assistant from any channel | none — chat is browser-only | **The one genuinely missing module.** Highest-value Stage 3 adoption candidate; see below |
| Heartbeat (`HEARTBEAT.md` + periodic wake) | proactive check-ins ("anything I should do?") | cron scheduler exists; no proactive persona loop | **Adopt the pattern, not the runtime**: a scheduled job with a HEARTBEAT-style checklist prompt gives 80% of it today |
| Cron | scheduled jobs | `interface/scheduler.mjs` (draft-only policy on top) | **Keep ours** — governance (drafts, approvals) is stronger |
| Bootstrap files (SOUL.md, USER.md, IDENTITY.md, AGENTS.md) | persona + user context injection | CLAUDE.md / CLAUDE.local.md / user-profile.md / agent files | **Keep ours** — richer and governed; don't duplicate persona systems |
| Skills + ClawHub | SKILL.md format + registry | same SKILL.md format; Skill Hub + pinned marketplace installs | **Keep ours**; ClawHub becomes just another install source if ever needed |
| Multi-agent routing | route across agents | Danny + 14 specialists + guardrails | **Keep ours** — far more governed |

## The gateway question (the real Stage 3 decision)

What OpenClaw would actually add: **reaching Danny from WhatsApp/Telegram/
Signal on the go**, with per-contact session routing. Options, in order of
increasing commitment:

1. **Defer** (default): browser chat + VS Code cover desk work; mobile need
   unproven. Cost: nothing.
2. **Thin bridge**: a small adapter (e.g. Telegram bot) that forwards
   messages to `POST /api/chat` and streams answers back. Keeps all
   governance (Danny prompt, guardrails, history, incognito) — ~a day of
   work, no new trust surface beyond the bot token. Recommended first step
   if mobile access is wanted.
3. **OpenClaw as gateway only**: run OpenClaw for its channels, pointed at
   this workspace's files. Warning: OpenClaw would run with its own agent
   loop and permission model **outside our guardrails** — its security
   posture (broad tool access, exposed gateway risks) was a known concern in
   the research. Requires a Simon audit + strict sandboxing before any
   adoption; the Stage 2→3 quality gate ("personal/company boundary leaks
   tested and blocked") applies.

## Ground rules for any OpenClaw adoption

- Memory files stay canonical **here** (`memory/`); OpenClaw may read/write
  them only under the same provenance + privacy rules (CLAUDE.md § Memory).
- No second persona/instruction system: SOUL/USER/AGENTS.md must not fork
  from CLAUDE.md — generate them from our files if needed.
- Company knowledge access from a gateway follows the same source precedence
  and never bypasses the promotion pipeline.
- Every adoption step goes through Simon (permission/guardrail review) —
  gateway processes are internet-facing by nature.
- Re-evaluate against HybridClaw for anything team-/client-facing (approvals,
  audit trails, EU hosting are its strengths — gap analysis part 2.2).
