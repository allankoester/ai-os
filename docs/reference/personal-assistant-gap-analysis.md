# Personal Assistant Layer — Gap Analysis and Reference Patterns

Status: reference / informative (per `docs/reference/README.md` rules — active docs win on conflict)
Date: 2026-07-09
Author: analysis run requested by Allan (investigation of personal-assistant functions)

## Purpose

The Steadymade AI-OS is a solid **company harness** (shared knowledge, agents,
skills, scheduler, guardrails, approval logic). This document analyses why it is
not yet a **personal assistant** and what the four most relevant reference
systems — OpenClaw, HybridClaw, Hermes Agent, and Claude Desktop / claude.ai —
do differently in five areas:

1. Memory
2. Chat with persistent chat history
3. Learning loops
4. Versioning of skills
5. Raw personal input (brainstorming) vs. cleaned, promoted knowledge

Everything in Part 1 is verified against the repo as of 2026-07-09. External
claims in Part 2 cite their sources.

---

## Executive verdict

- The four reference systems **converge on the same memory architecture**:
  a small curated long-term file, an append-only working layer (daily notes /
  session index), raw transcripts kept separately, an explicit consolidation
  step, and search over memory. This validates that the pattern fits a
  file-first Claude OS — it can be built here with files, instructions, one
  scheduler job and a chat-server extension. No new infrastructure needed.
- The repo's biggest defect is not missing storage — it is **dead-end wiring**:
  memory files exist but nothing loads them into agent context, and the chat
  runtime's tool allowlist cannot write them. The learning loop exists on paper
  (run logs) and has produced zero artifacts.
- Chat continuity exists (`--resume`), but there is no chat history: one
  session pointer in the browser, no session list, no transcript restore, no
  search.
- Skills have review (git) but no versioning contract; personal skills and
  marketplace installs are effectively unversioned.
- The raw→clean pipeline exists for **documents** (inbox → Mara → domain,
  `meta.json` statuses) but not for **conversations** — exactly the gap Allan
  described: brainstorming has no capture point and no promotion path.

---

## Part 1 — Current state (repo evidence)

### 1.1 Chat and chat history

Implementation: `chat/server.mjs` + `chat/public/app.js` (single-page UI on
port 4012, embedded in the interface Chat view).

What exists:

- Per turn, the server spawns `claude -p <message> --output-format stream-json`
  and passes `--resume <sessionId>` when the frontend supplies one
  (`chat/server.mjs:135-152`). Session continuity therefore works — Claude
  Code's own session store (JSONL transcripts under
  `~/.claude/projects/<escaped-cwd>/`) holds the full conversation.
- Usage metadata per turn (cost, tokens, duration, session id — **not
  content**) is appended to `runs/chat-usage.jsonl` and rendered in the
  interface Usage view.

What is missing:

- **One session only.** The UI stores a single `steadymade_chat_session` key in
  `localStorage`. "New chat" deletes it (`chat/public/app.js:291-293`); the
  previous conversation becomes unreachable from the UI even though its
  transcript still exists on disk.
- **No transcript restore.** On reload, `restoreSession()` restores only the
  session id badge (`chat/public/app.js:145-152`) — the visible message
  history is gone. The server has no endpoint to fetch past messages (only
  `/api/chat` and `/api/health`).
- **No session list, no titles, no search, no archive.** Nothing enumerates
  past sessions, so "what did Danny and I decide last Tuesday?" is
  unanswerable from the product, despite the data existing in Claude Code's
  session files.
- Nothing distinguishes a throwaway chat from one worth keeping (no
  pin/archive/incognito semantics).

### 1.2 Memory

Design intent exists in three places:

- `knowledge/README.md` §"Agent memory locations" names
  `knowledge/company/company_handbook_SSOT/agent-memory.md` (company shared),
  `knowledge/personal/memory.md` (private), and OneDrive `AI_OS/knowledge/team/`.
- The interface has a Memory view (`renderMemory`,
  `interface/public/app.js:2179-2227`) with COMPANY / PERSONAL / TEAM cards and
  open/create buttons.
- `CLAUDE.local.md` + `knowledge/personal/user-profile.md` act as static
  persona memory (maintained via `/personal-onboarding`).

Reality:

- `agent-memory.md` contains only rules and a template line — **zero entries**.
  `knowledge/personal/memory.md` does not exist yet.
- **No read path:** `CLAUDE.md` never references the memory files, no agent
  instruction loads them at session start. Danny starts every session
  amnesiac except for CLAUDE.md/CLAUDE.local.md/user-profile.md.
- **No write path:** the chat runtime's allowlist is
  `Task,Read,Glob,Grep,Skill,WebFetch` (`chat/server.mjs:16`) with permission
  mode `default`. In headless `-p` mode nobody can answer permission prompts,
  so `Write`/`Edit` are denied — Danny (and every specialist reached via
  `Task`) **cannot write memory, run logs, or learning notes from the chat UI
  even when instructed to**. The Memory view is a manual text editor, nothing
  more.
- No working layer (daily notes), no consolidation step, no memory search, no
  distinction between session-scoped observation and durable fact.

### 1.3 Learning loops

- `runs/README.md` + `run-log-template.md` define the contract: one Markdown
  log per significant run, "Stage 1: repeatability and learning". Actual run
  logs in `runs/`: **none** (only the README, the template and
  `chat-usage.jsonl`). Consistent with 1.2: the chat runtime cannot write
  them.
- `agents/instructions/feedback-loop.md` (workspace root) is a **developer**
  loop (plan → implement → validate → document → improve) for coding changes,
  not an assistant learning loop.
- No mechanism captures user corrections ("don't phrase it like that",
  "Atlas was wrong about X") anywhere durable. No periodic consolidation or
  review job exists (`scheduler/jobs.json` holds one security-audit job).
- Templates for quality (approval checklist, quality rubric) exist but their
  outcomes are not fed back anywhere.

### 1.4 Skills and versioning

- `skills/company/` is committed and reviewed like code — git history is the
  only versioning. Works, but there is **no version metadata**: SKILL.md
  frontmatter is `name` + `description` only (`skills/README.md`),
  `scripts/validate.mjs` checks naming, not versions. No changelog
  convention, no way to say "clara-writer relies on skill X ≥ 0.3".
- `skills/personal/` is gitignored → **no versioning at all**. Editing or
  breaking a personal skill is unrecoverable except via `backups/*.tar.gz`.
- Marketplace installs (`interface/skills.mjs:243-279`) download
  `codeload.github.com/.../refs/heads/<branch>` — **branch head, not a pinned
  commit**. `.install.json` records `owner/repo/ref/subpath` but no SHA, so
  installs are not reproducible and there is no update/diff mechanism.
  Customizations (CUSTOMIZE button) silently fork with no upstream tracking.
- No skill evals or scorecards (contrast: Hermes and HybridClaw below;
  the bundled `skill-creator` skill already contains eval tooling that could
  be used).

### 1.5 Raw personal input vs. cleaned knowledge

What already works (document-shaped knowledge):

- Privacy boundary: `knowledge/personal/` (gitignored, never shared) vs.
  `knowledge/company/` (OneDrive canonical) — enforced by contract and
  guardrails.
- Intake pipeline: `knowledge/inbox/` → Mara classifies → `company/<domain>/`
  or `personal/` → inbox copy removed.
- Maturity metadata: `interface/meta.json` tracks per-document `status`
  (draft/approved), `knowledge_type` (canonical/…), `source_type`, `owner`,
  `last_reviewed` — i.e. the "cleaned knowledge" end of the pipeline is
  well-modelled.
- Source precedence ladder in `CLAUDE.md` (SSOT > operating profile > domain
  docs > … > inbox > personal).

What is missing (conversation-shaped knowledge):

- **No capture point.** A brainstorm with Danny leaves no artifact: no daily
  note, no "park this" action, nothing lands in inbox. The transcript is
  buried in Claude Code's internal session files.
- **No promotion path.** There is no defined act that turns a raw
  conversational idea into a cleaned knowledge candidate (with Mara + approval
  + `meta.json` status). Consequently there is also no rule preventing the
  opposite failure: an agent citing yesterday's half-formed brainstorm as if
  it were approved knowledge — today this is "prevented" only by the raw data
  being invisible.
- **No no-trace mode.** Nothing marks a conversation as "do not retain"
  (Claude Desktop's incognito equivalent) — irrelevant today only because
  nothing is retained at all.

---

## Part 2 — Reference architectures

### 2.1 OpenClaw — the personal-assistant pattern (already planned as Stage 3)

Open-source personal AI assistant runtime; the staged concept
(`docs/reference/ai-os-comparison-and-staged-concept.md`, Stage 3) already
names it as the intended assistant layer.

- **Bootstrap/persona files** injected at session start from the agent
  workspace: `AGENTS.md` (operating instructions), `SOUL.md` (persona),
  `USER.md` (who the user is), `IDENTITY.md`, `TOOLS.md`, optional
  `HEARTBEAT.md`. A first-run bootstrap ritual interviews the user, writes
  `IDENTITY.md`/`USER.md`/`SOUL.md`, then deletes `BOOTSTRAP.md`.
  (Sources: [docs.openclaw.ai/concepts/agent-workspace](https://docs.openclaw.ai/concepts/agent-workspace),
  [docs.openclaw.ai/start/bootstrapping](https://docs.openclaw.ai/start/bootstrapping))
- **Two-layer memory** ([docs.openclaw.ai/concepts/memory](https://docs.openclaw.ai/concepts/memory)):
  - `MEMORY.md` — "the compact, curated layer: durable facts, preferences,
    standing decisions, and short summaries"; auto-loaded every session,
    truncated in context if over budget.
  - `memory/YYYY-MM-DD.md` — "the working layer: detailed daily notes,
    observations, session summaries, and raw context"; today + yesterday
    auto-loaded, the rest indexed for search.
  - Agents distill daily notes into MEMORY.md over time and prune stale
    entries; optional `DREAMS.md` holds consolidation summaries for human
    review.
- **Memory flush before compaction:** a housekeeping turn where "the agent is
  reminded to save important context to memory files" before conversation
  summarization — nothing durable is lost to compaction.
- **Memory search tools:** `memory_search` (hybrid vector + keyword when
  embeddings configured) and `memory_get` (file/line-range read).
- **Sessions:** per-agent session store (`sessions.json`) plus append-only
  `<sessionId>.jsonl` transcripts (tree-structured entries, persisted
  compaction summaries, archived pre-compaction transcripts). Session tools
  (`sessions_list`, `sessions_history`, `sessions_send`) let the agent itself
  query history.
  (Source: [session management deep dive](https://docs.openclaw.ai/reference/session-management-compaction))
- **Proactivity:** cron jobs plus heartbeat runs that consult the
  `HEARTBEAT.md` checklist.
- **Skills:** one folder per skill with `SKILL.md` (same convention as here),
  ClawHub registry.

Takeaway: OpenClaw is the closest architectural relative (Markdown, file-first,
Claude-compatible skills). Its memory contract maps 1:1 onto the
`knowledge/personal/` structure — adopting the pattern now makes an eventual
Stage 3 migration nearly mechanical.

### 2.2 HybridClaw — the enterprise/EU governance pattern

German-built, enterprise-focused agent runtime by HybridAI
([github.com/HybridAIOne/hybridclaw](https://github.com/HybridAIOne/hybridclaw)).
Not a literal fork: a separate runtime with migration compatibility
(`hybridclaw migrate openclaw`), positioned as "enterprise-ready self-hosted AI
assistant runtime with sandboxed execution, secure credentials, approvals, and
memory".

- **Security architecture:** sandboxed tool execution (host or Docker),
  encrypted runtime secrets with SecretRef indirection (credentials never in
  model context), approval policies for risky actions, output guardrails,
  **hash-chained audit trails**, admin console. EU-hosted or self-hosted
  deployment; pitched explicitly at EU/German governance expectations.
  (Sources: repo README; [implicator.ai on HybridClaw's German agent-controls pitch](https://www.implicator.ai/hybridclaw-pitches-german-agent-controls-as-hermes-tops-120-000-stars/))
- **Memory:** local memory files + SQLite persistence + semantic recall +
  session compaction; optional cloud "Company Brain" (memory + RAG) in the
  hosted layer.
- **Skills:** ~79 bundled business skills with a **packaged skill lifecycle,
  eval fixtures and agent scorecards** — skills are tested, versioned
  artifacts, not loose folders.
- **Multi-agent:** agents exchange A2A envelopes through approval-aware
  channels — routing itself is subject to governance.

Takeaway: HybridClaw is the reference for where this OS must converge at
Stage 4/5 (approvals, audit, sandboxing, skill evals). Strategically also worth
watching: its pitch (governed AI operations for German Mittelstand-type
buyers) overlaps with Steadymade's own positioning.

### 2.3 Hermes Agent — the learning-loop pattern

NousResearch's open assistant ([github.com/nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent));
reported at 120k+ GitHub stars in June 2026 coverage — currently the most-used
open personal-assistant project.

- **Layered memory:** curated `MEMORY.md` + `USER.md`; raw sessions indexed in
  an FTS5 full-text database for cross-session recall; "Honcho dialectic user
  modeling" builds a deepening user profile across sessions; "agent-curated
  memory with periodic nudges" (the agent is periodically prompted to
  persist, not only on demand).
- **Closed learning loop — its signature feature:**
  - autonomous skill creation after complex tasks (a solved multi-step problem
    is crystallized into a reusable skill),
  - skills self-improve during use,
  - trajectory compression (`trajectory_compressor.py`) collapses recurring
    multi-step pipelines into "zero-context-cost turns".
  - Net effect: **learning materializes as versioned procedure (skills), not
    only as remembered facts.**
- **Skills:** agentskills.io open standard (SKILL.md-compatible), community
  skill hub, `~/.hermes/skills/`.
- **Sessions:** CLI + unified messaging gateway (Telegram/Discord/Slack/
  WhatsApp/Signal) with cross-platform conversation continuity; `/new`,
  `/reset`, `/retry`, `/undo`, `/compress`.
- **Scheduling:** built-in cron with delivery to any connected platform.

Takeaway: the most important import from Hermes is conceptual — a personal
assistant's learning loop should end in **facts → memory** and **procedures →
skills**, both versioned.

### 2.4 Claude Desktop / claude.ai — the memory-UX and safety pattern

(Sources: [claude.com/blog/memory](https://claude.com/blog/memory),
[VentureBeat](https://venturebeat.com/ai/anthropic-adds-memory-to-claude-team-and-enterprise-incognito-for-all),
[Computerworld](https://www.computerworld.com/article/4056366/anthropic-adds-memory-to-claude-for-team-and-enterprise-plan-users.html))

- **Memory ≠ transcript.** Claude stores extracted facts/preferences, not a
  running log; chat history remains a separate, searchable raw layer (past-
  chats search).
- **User-visible, editable memory summary:** "see exactly what Claude
  remembers … and update the summary at any time by chatting with Claude."
  Users can steer with focus/ignore instructions.
- **Project-scoped memory silos as a safety boundary:** "Claude creates a
  separate memory for each project" — client work cannot leak into internal
  planning. This is the productized version of the company/personal/client
  scope separation this repo already has on the knowledge side.
- **Incognito chats:** conversations that never touch memory or history —
  the design answer to "raw brainstorming that must not become knowledge".
- Three-layer separation of concerns: **Projects** (curated documents) vs.
  **memory** (learned facts) vs. **chat history** (raw record).
- The Claude Code variant of the same philosophy (relevant because this OS
  runs on Claude Code): `CLAUDE.md` hierarchy for instructions + an auto-memory
  directory of one-fact-per-file Markdown notes with typed frontmatter
  (`user` / `feedback` / `project` / `reference`), a `MEMORY.md` index loaded
  each session, and a consolidation skill that merges duplicates and prunes
  stale facts. Hooks (`SessionStart`, `PreCompact`, `SessionEnd`, `Stop`) are
  the native integration points for load/flush moments.

### 2.5 Pattern comparison

| Capability | OpenClaw | HybridClaw | Hermes | Claude Desktop / Code | Steadymade AI-OS today |
| --- | --- | --- | --- | --- | --- |
| Persona/bootstrap context | SOUL.md, USER.md, IDENTITY.md, AGENTS.md auto-injected | personas + onboarding "hatching" | SOUL.md, USER.md | Project instructions / CLAUDE.md hierarchy | CLAUDE.md, CLAUDE.local.md, user-profile.md ✅ |
| Curated long-term memory | MEMORY.md, auto-loaded | memory files + SQLite + cloud "Company Brain" | MEMORY.md + Honcho user model | editable memory summary, project-scoped | agent-memory.md exists, empty, never loaded ❌ |
| Working memory layer | memory/YYYY-MM-DD.md daily notes | session compaction + semantic recall | FTS5 session index | (internal) | none ❌ |
| Raw transcripts / history | sessions.json + JSONL, session tools, archived on compaction | resumable sessions, audit trail | cross-platform continuity, /undo /retry | full history + past-chats search | Claude Code JSONL on disk, invisible to product ❌ |
| Memory search | memory_search (hybrid vector+keyword) | semantic recall | FTS5 + LLM summarization | automatic retrieval | none ❌ |
| Consolidation | pre-compaction memory flush + distill daily→MEMORY.md | compaction | agent-curated with periodic nudges | consolidation pass / user edits | none ❌ |
| Learning loop | curate memory over time | skill evals, scorecards | **skill auto-creation, self-improvement, trajectory compression** | feedback-typed memories | run-log contract on paper, 0 logs ❌ |
| Skill versioning | ClawHub registry | packaged lifecycle + eval fixtures | agentskills.io standard + hub | plugin/skill marketplace | git for company only; personal + marketplace unversioned ⚠️ |
| Proactive/scheduled | cron + HEARTBEAT.md | scheduling + budgets | cron with platform delivery | scheduled tasks | interface cron scheduler ✅ (draft-only) |
| Raw vs. clean boundary | daily notes vs MEMORY.md | approvals + audit between agent output and record | raw FTS5 vs curated files | incognito / memory / projects triad | docs pipeline ✅, conversation pipeline ❌ |
| Governance/security | permissions, sandbox guidance | **sandbox, SecretRef, approvals, hash-chained audit** | terminal backends incl. Docker | enterprise controls | guardrails + approval logic ✅ (strong for stage) |

---

## Part 3 — Gap analysis

| # | Gap | Severity | Evidence |
| --- | --- | --- | --- |
| G1 | Memory files are never read into context and can never be written from chat (allowlist has no Write/Edit; headless mode cannot approve) | **High — blocks everything else** | `chat/server.mjs:16`, `CLAUDE.md` (no memory reference), empty `agent-memory.md` |
| G2 | No chat history: single session pointer, no list/restore/search, transcripts invisible | **High** | `chat/public/app.js:145-152, 291-293`; server has no history endpoint |
| G3 | Learning loop unexecuted: 0 run logs, corrections evaporate, no consolidation job | **High** | `runs/` contents; `scheduler/jobs.json` |
| G4 | No conversational raw→clean pipeline: no capture, no promotion act, no no-trace mode | **Medium-high** | knowledge contract covers documents only |
| G5 | No skill version contract: no version field, unpinned marketplace installs (branch head), unversioned personal skills, no evals | **Medium** | `skills/README.md`, `interface/skills.mjs:243-279`, `scripts/validate.mjs` |
| G6 | No proactive assistant behavior (heartbeat-style check-ins) — scheduler exists but is job-oriented | Low (deliberate at Stage 1/2) | `interface/scheduler.mjs` |

---

## Part 4 — Recommendations

Design principle: extend the **existing** contracts (knowledge scopes,
guardrails, meta.json statuses, scheduler, approval logic) instead of adding a
parallel system. All of R1–R5 are Stage-1/2-compatible: files + instructions +
chat-server work. Ordered by dependency:

### R1 — Wire the memory contract (prerequisite for everything)

Adopt the convergent two-layer pattern on top of the existing locations:

```
knowledge/personal/memory/
├── MEMORY.md            # curated durable facts, preferences, decisions (small, budgeted)
└── daily/YYYY-MM-DD.md  # append-only working notes: observations, session summaries, parked ideas
knowledge/company/company_handbook_SSOT/agent-memory.md   # stays: curated, shared, promotion-only
```

- **Read path:** CLAUDE.md instruction — Danny loads `MEMORY.md` + today's and
  yesterday's daily note at session start (OpenClaw's exact loading rule);
  optionally a `SessionStart` hook injects them mechanically.
- **Write path:** extend `CHAT_ALLOWED_TOOLS` with `Write,Edit` and use the
  **existing guardrails layer** to scope writes to
  `knowledge/personal/memory/**` and `runs/**` only — guardrails were built
  for exactly this; Simon should review the rule set.
- **Write rules:** durable fact → MEMORY.md; observation/idea/session summary
  → daily note; **company memory is never auto-written** — entries reach
  `agent-memory.md` only via promotion (R4).
- **Flush moments:** instruct Danny to flush notable context at task end; a
  `PreCompact`/`SessionEnd` hook replicates OpenClaw's memory flush so long
  sessions don't lose facts to compaction.
- Search: `Grep` over `knowledge/personal/memory/` is sufficient at this
  scale (Nora's job); embeddings are a later optimization.

### R2 — Chat history as a first-class object

- The chat server already parses every stream event: **persist them**. Append
  per-session transcripts to `chat/history/<sessionId>.jsonl` (gitignored,
  same privacy class as `runs/`) and maintain `chat/sessions.json`
  (id, title = first user message, agent, created/last-active, status:
  active/archived/pinned).
- New endpoints: `GET /api/sessions`, `GET /api/sessions/:id` (transcript),
  optional `DELETE`. UI: session sidebar with resume (the `--resume`
  mechanism already works), rename, archive; text search over the JSONL.
- This deliberately duplicates Claude Code's internal store: the product
  should own its history rather than scrape `~/.claude/projects/`.

### R3 — Execute the learning loop (facts → memory, procedures → skills)

- With R1's write path, enforce the existing contract: Danny writes
  `runs/YYYY-MM-DD-<slug>.md` after significant tasks — this becomes real the
  moment writes are allowed.
- **Feedback capture:** every explicit user correction becomes a dated entry
  in the daily note tagged `#feedback` (what was wrong, why, how to apply).
- **Weekly consolidation job** in the existing scheduler: distill daily notes
  into MEMORY.md, prune stale entries, aggregate `#feedback` into proposed
  instruction changes (draft PR/diff for CLAUDE.md or agent files — never
  auto-applied, consistent with approval logic).
- **Hermes pattern:** when run logs show the same multi-step workflow ≥2-3×,
  Danny proposes a skill draft in `skills/company/` (goes through git review)
  — learning crystallizes as versioned procedure, not just remembered fact.

### R4 — Conversational raw→clean pipeline (the brainstorm question)

Make knowledge maturity explicit and default-private:

1. **Default rule:** everything originating in conversation is
   **raw + personal** (daily note). Nothing conversational is company
   knowledge by default.
2. **Capture:** "park this" / end-of-brainstorm summary → daily note; longer
   raw dumps → `knowledge/inbox/` as today.
3. **Promotion is an explicit act:** a `/promote-knowledge` skill routes the
   raw item to Mara → cleaned draft in `knowledge/company/<domain>/` with
   `meta.json` `status: draft` → user approval → `approved`. The existing
   meta.json vocabulary (`status`, `knowledge_type`, `source_type`) already
   models the target states; add `source_type: conversation` for provenance.
4. **Citation guard:** agents may cite raw/daily material only flagged as
   unvalidated (matches source precedence rule 7-9 in CLAUDE.md).
5. **Incognito toggle** in chat (Claude Desktop pattern): session marked
   no-trace — no daily-note capture, no history retention beyond the turn.

### R5 — Skill version contract

- Frontmatter `version:` (semver) mandatory for `skills/company/*`, enforced
  by `scripts/validate.mjs`; bump + changelog line per change (git review
  already exists).
- Marketplace installs: resolve and record the **commit SHA** in
  `.install.json` at install time; an "update available" check diffs upstream;
  customized skills get `customized: true` so updates don't clobber them.
- `skills/personal/`: initialize a **local-only git repo** (never pushed) or
  include in the nightly backup — cheap rollback for the unversioned scope.
- Later (Stage 3+): adopt skill evals (skill-creator's eval tooling exists;
  HybridClaw's fixtures/scorecards are the mature reference).

### Sequencing and staging

| Order | Item | Effort | Depends on |
| --- | --- | --- | --- |
| 1 | R1 memory wiring (files, CLAUDE.md rules, guardrail-scoped writes) | days | — |
| 2 | R2 chat history (server persistence + session UI) | days | — |
| 3 | R3 learning loop (run logs live, feedback tags, weekly consolidation job) | days | R1 |
| 4 | R5 skill versioning (validate check, SHA pinning, personal git) | 1-2 days | — |
| 5 | R4 promotion pipeline (/promote-knowledge, meta states, incognito) | days | R1-R3 |

Deferred deliberately: embeddings-based memory search, heartbeat-style
proactivity (a scheduler job can emulate it when needed), sandbox/audit
hardening (Stage 4, HybridClaw as reference).

**Stage 3 decision stays open and gets easier:** the Stage 2→3 quality gate
requires "personal/company memory separation documented" — R1/R4 satisfy it.
Because R1 adopts OpenClaw's file semantics (MEMORY.md + daily notes), a later
OpenClaw adoption imports the memory directly; if Stage 3 lands elsewhere
(e.g. staying Claude-native), nothing is lost — the contract is
provider-neutral Markdown.

---

## Sources

Repo evidence: `chat/server.mjs`, `chat/public/app.js`, `chat/README.md`,
`knowledge/README.md`, `knowledge/company/company_handbook_SSOT/agent-memory.md`,
`interface/public/app.js` (renderMemory), `interface/skills.mjs`,
`interface/scheduler.mjs`, `interface/meta.json`, `scheduler/jobs.json`,
`runs/`, `skills/README.md`, `profiles/allan.yml`,
`docs/reference/ai-os-comparison-and-staged-concept.md`,
`agents/instructions/feedback-loop.md` (workspace root).

External:

- OpenClaw: [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw),
  [memory](https://docs.openclaw.ai/concepts/memory),
  [agent workspace](https://docs.openclaw.ai/concepts/agent-workspace),
  [bootstrapping](https://docs.openclaw.ai/start/bootstrapping),
  [session management deep dive](https://docs.openclaw.ai/reference/session-management-compaction)
- HybridClaw: [github.com/HybridAIOne/hybridclaw](https://github.com/HybridAIOne/hybridclaw),
  [hybridai.one/hybridclaw](https://hybridai.one/hybridclaw),
  [implicator.ai coverage](https://www.implicator.ai/hybridclaw-pitches-german-agent-controls-as-hermes-tops-120-000-stars/)
- Hermes Agent: [github.com/nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
- Claude memory: [claude.com/blog/memory](https://claude.com/blog/memory),
  [VentureBeat](https://venturebeat.com/ai/anthropic-adds-memory-to-claude-team-and-enterprise-incognito-for-all),
  [Computerworld](https://www.computerworld.com/article/4056366/anthropic-adds-memory-to-claude-for-team-and-enterprise-plan-users.html)
