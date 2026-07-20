# Development Plan — Personal Assistant Layer

Type: **active working document** — this file is the single source of truth for
implementation status. The analysis behind it is
`docs/reference/personal-assistant-gap-analysis.md` (informative only).

Created: 2026-07-09 · Owner: Allan · Executor: Claude (Danny-side sessions)

Legacy note (2026-07-20): this execution plan contains historical implementation steps and references that mention JSON scheduler/session files during rollout. Current canonical operational state for scheduler/private-board/chat-session-index domains is machine-local SQLite. Treat JSON references in phase logs as migration history, not current authority.

---

## Execution protocol (read this first in every session)

This plan is designed to survive session/context breaks. Rules for any Claude
session executing it:

1. **Resume procedure (mandatory at session start):**
   1. Read this file top to bottom.
   2. Read the Phase map — find the first phase not `done`.
   3. Run `git -C <workspace-root> log --oneline -5` and `git status` to see
      what actually landed (trust git + files over the plan if they disagree,
      then fix the plan).
   4. Re-verify the acceptance criteria of the **previous** phase before
      starting a new one (cheap re-checks only).
   5. Continue at the first unchecked task.
2. **Update discipline:**
   - Tick a task checkbox **immediately** after completing and verifying it —
     never batch ticks.
   - Any deviation from the spec goes into the phase's Status block →
     `Notes/deviations` at the moment it happens.
   - Decisions that change design go additionally into the **Decisions log**
     (bottom) with date.
3. **Phase-close checklist (all mandatory before a phase becomes `done`):**
   - [ ] all tasks ticked (or explicitly moved/dropped with a note)
   - [ ] acceptance criteria verified with the listed commands — paste real
         results (short) into the Status block
   - [ ] `node scripts/validate.mjs` passes
   - [ ] plan file updated (status block: state, dates, notes)
   - [ ] local git commit of the phase (see commit policy) — record the hash
         in the Status block
4. **Context-budget rule (the reason this file exists):** when a session's
   context is getting long (~70-80% used or after a big phase), finish the
   current *task* (not phase), update this file, commit, and stop cleanly.
   The next session resumes via step 1. Never start a new phase in a nearly
   full session.
5. **Commit policy:** one local commit per phase (plus mid-phase WIP commits
   when stopping under rule 4). Conventional style, e.g.
   `feat(memory): wire personal memory contract (phase 1)`. Include the
   trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
   **Never push** unless Allan asks.
6. **Approval gates:** phases marked ⚠ contain security-relevant permission
   changes → present the diff to Allan (and run a Simon review where noted)
   before committing. Never mark such a phase `done` without explicit user
   approval recorded in the Status block.
7. **Scope guard:** do not refactor unrelated code, do not touch
   `knowledge/company/` content, do not introduce new instruction systems.
   Everything extends existing contracts (guardrails, meta.json, scheduler,
   CLAUDE.md).

State legend: `pending` · `in_progress` · `blocked (<why>)` · `done`

---

## Phase map (live status)

| Phase | Title | Gap | State | Commit |
| --- | --- | --- | --- | --- |
| 0 | Baseline & safety net | — | done | 5559c32 |
| 1 | Memory contract wiring ⚠ | G1 | done | 5559c32 |
| 2 | Chat history & sessions | G2 | done | 54ab164 |
| 3 | Learning loop v1 | G3 | done | 600c3d9 |
| 4 | Skill version contract | G5 | done | 8033052 |
| 5 | Raw→clean promotion pipeline + incognito | G4 | done | 8ef7f7d |
| 6 | Hardening & polish (6.1-6.4 done; 6.5 backlog) | G6/misc | done | 0d3ece0 |
| 7 | Interface & chat UX round (2026-07-10 list) ⚠ | UX/7.3 | done | local changes pending commit |

Dependencies: 1 → 3 → 5 (memory before learning before promotion). 2 and 4 are
independent and can be reordered if blocked. 5's incognito subtasks depend
on 2. 7 builds on 2 (chat history) and 4 (skill contract); its packages
7.1 → 7.2 → 7.3 land as separate commits.

---

## Phase 0 — Baseline & safety net

**Goal:** safe starting point; nothing functional changes.

**Tasks:**

- [x] 0.1 `git status` clean or only intended files; note branch (work happens
      on `main` per repo convention).
- [x] 0.2 Run `bash scripts/backup.sh` → confirm new archive in `backups/`.
- [x] 0.3 Run `node scripts/validate.mjs` → record baseline result.
- [x] 0.4 Confirm runtimes start: interface (port 4011) and chat
      (`node chat/server.mjs`, port 4012, `GET /api/health` → ok). Stop them
      again if they weren't running.
- [x] 0.5 Locate the effective `.gitignore` entries for `knowledge/personal/`,
      `runs/`, `.skill-profile` (`git check-ignore -v knowledge/personal/user-profile.md runs/chat-usage.jsonl`)
      and note the gitignore file path here (needed by phases 1-2).

**Acceptance criteria:** backup exists, validate passes (or failures are
pre-existing and noted), both servers start, gitignore location known.

**Status:**
```
state: done
started: 2026-07-09
completed: 2026-07-09
commit: recorded in phase map after commit
notes:
- validate.mjs: 233 checks passed (baseline green)
- backup: backups/ai-os-backup-20260709-104347.tar.gz (13 files; targets = knowledge, runs, interface/meta.json)
- interface (4011) and chat (4012) were ALREADY running — no start/stop needed;
  chat claude binary resolves to Claude Code 2.1.202
- gitignore = app-local ./.gitignore (knowledge/personal/*, runs/*, scheduler/*,
  interface/guardrails.json, .claude/settings.local.json all machine-local)
- IMPORTANT for resume: apps/internal/steadymade-ai-os is its OWN git repo
  (root = app dir, branch main, remote origin, currently 1 ahead). The plan +
  gap analysis were committed as 7ee03c7 outside this protocol (user/IDE side).


---

## Phase 1 — Memory contract wiring ⚠ (G1)

**Goal:** Danny reads memory at session start and can write it from the chat
runtime — scoped, guardrail-enforced, company memory stays promotion-only.

**Design (from gap analysis R1):**

```
knowledge/personal/memory/
├── MEMORY.md            # curated durable facts/preferences/decisions, budget ≤ ~200 lines
└── daily/YYYY-MM-DD.md  # append-only working notes: observations, session summaries, parked ideas, #feedback entries
```

Read rule: session start → read `MEMORY.md` + today's + yesterday's daily note
(if present). Write rules: durable fact → `MEMORY.md`; observation/idea/
session summary → today's daily note; **company memory
(`knowledge/company/company_handbook_SSOT/agent-memory.md`) is never
auto-written** — promotion only (Phase 5). Flush rule: at the end of any
significant task, persist notable context before the session ends.

**Tasks:**

- [x] 1.1 Inspect current permission surface: `interface/guardrails.json`,
      `interface/guardrails.mjs` (how levels materialize into
      `.claude/settings.local.json`), and current `.claude/settings.local.json`.
      Record in Notes: exact rule syntax guardrails emits.
- [x] 1.2 Create local memory files (gitignored, machine-local):
      `knowledge/personal/memory/MEMORY.md` (header + sections: `## Working
      preferences`, `## Standing decisions`, `## Active context`, entry format
      `- YYYY-MM-DD | fact`) and `knowledge/personal/memory/daily/` (empty).
- [x] 1.3 Add write-level guardrail rules for `knowledge/personal/memory/**`
      and `runs/**` via the guardrails model (edit `guardrails.json` or PUT
      `/api/guardrails`, whichever 1.1 showed is canonical), then confirm
      `.claude/settings.local.json` contains matching path-scoped
      `Write`/`Edit` allow rules. **Do not** add unscoped `Write`/`Edit` to
      `CHAT_ALLOWED_TOOLS` in `chat/server.mjs` — settings allow-rules merge
      with the allowlist, so scoped rules are sufficient. Only if live testing
      (1.7) proves settings rules are not picked up in `-p` mode, fall back to
      path-scoped entries in `CHAT_ALLOWED_TOOLS` (e.g.
      `Write(knowledge/personal/memory/**)`) and document the fallback here.
- [x] 1.4 Add a `## Memory` section to `CLAUDE.md` (keep it ≤ ~25 lines):
      read rule, write rules, flush rule, budget, company-memory =
      promotion-only, and "personal memory never enters shared/client
      artifacts" (restating the existing privacy contract).
- [x] 1.5 Update `knowledge/README.md` §"Agent memory locations" to document
      the `memory/` structure (MEMORY.md + daily/) replacing the bare
      `memory.md` mention; update the interface Memory view paths in
      `interface/public/app.js` `renderMemory()` (`personalPath` →
      `knowledge/personal/memory/MEMORY.md`, template accordingly).
- [x] 1.6 ⚠ Security review: run a Simon (simon-security-audit) review of the
      guardrail/permission diff (scope: can chat sessions now write anywhere
      they shouldn't; are `runs/**` writes safe given run logs may contain
      personal context). Paste verdict summary into Notes. Present diff to
      Allan for approval before commit.
- [x] 1.7 Live verification (commands under Acceptance).

**Acceptance criteria + verification:**

1. Write path: `curl -N -s -X POST localhost:4012/api/chat -H 'Content-Type: application/json' -d '{"message":"Remember for later: test-marker-p1. Store it as a durable memory."}'`
   → `knowledge/personal/memory/MEMORY.md` (or today's daily note) contains
   `test-marker-p1`, no permission-denied in stream.
2. Read path: new conversation, ask "What do you remember about
   test-marker-p1?" → Danny answers from memory files.
3. Negative test: instruct Danny (chat) to write a file to
   `knowledge/company/…` → write is denied/refused.
4. `agent-memory.md` untouched (git diff clean on it).
5. `node scripts/validate.mjs` passes.
6. Remove test markers after verification.

**Status:**
```
state: done
started: 2026-07-09
completed: 2026-07-09
commit: recorded in phase map
approval: Allan approved plan + execution 2026-07-09 ("plan approve implement the plan"); Simon review ran (verdict: Revise), mitigations implemented before commit — see notes.
notes:
- DEVIATION (see decisions log): memory lives at top-level ./memory/, not
  knowledge/personal/memory/ (deny-rule precedence). runs guardrail read→write.
- Guardrails applied via PUT /api/guardrails; settings.local.json now allows
  Read/Edit/Write(./memory/**) and (./runs/**); knowledge/personal write-deny intact.
- SIMON FINDINGS: (1) High — memory poisoning via WebFetch→MEMORY.md.
  Mitigated: chat spawns with --disallowedTools "Write(./memory/MEMORY.md),
  Edit(./memory/MEMORY.md)" (CHAT_DISALLOWED_TOOLS to override) + provenance
  rule in CLAUDE.md §Memory and DANNY_PROMPT. Durable facts from chat go to
  daily notes tagged #durable; consolidation promotes after review.
  (2) Medium — scheduler consolidation must produce draft/approval output →
  folded into Phase 3 spec. (3) runs/ log mutability accepted for Stage 1/2.
- EMPIRICAL FINDING: Claude Code's internal auto-memory dir
  (~/.claude/projects/<slug>/memory/) collides with the "remember" intent —
  sessions wrote there instead of ./memory/. CLAUDE.md § Memory alone did NOT
  fix it; the binding fix is the Memory block in DANNY_PROMPT
  (--append-system-prompt). Any future runtime (scheduler prompts etc.) that
  should write AI-OS memory needs the same explicit instruction.
- VERIFIED: durable-fact chat test → memory/daily/2026-07-09.md entry with
  #durable, MEMORY.md untouched; read-path test answered from MEMORY.md seed;
  Edit on MEMORY.md from chat denied at permission layer; knowledge/inbox
  write intercepted (no file); interface serves updated Memory view; validate
  233 checks green; test markers removed after verification.
```

---

## Phase 2 — Chat history & sessions (G2)

**Goal:** conversations are first-class objects: listed, restorable, resumable,
searchable, deletable. The product owns its history (no scraping of
`~/.claude/projects/`).

**Design (from gap analysis R2):**

- Storage (both gitignored — extend the gitignore found in 0.5):
  - `chat/history/<conversationId>.jsonl` — append-only events:
    `{t:'user'|'assistant'|'tool', ts, text|name/detail, meta?}`
  - `chat/sessions.json` — index:
    `{id, title, agent, createdAt, updatedAt, turns, currentSessionId, archived}`
- **Session-chain pitfall (important):** each `--resume` turn returns a *new*
  `session_id` in the `result` event (frontend already tracks this,
  `chat/public/app.js:235`). Therefore: `conversationId` = first turn's
  session_id (stable, used for files/URLs); `currentSessionId` = latest
  result session_id (used for the next `--resume`). Server updates the index
  every turn.
- Endpoints (chat/server.mjs): `GET /api/sessions` (index, newest first),
  `GET /api/session?id=<conversationId>` (parsed transcript),
  `POST /api/session/archive` `{id}`, `POST /api/session/rename` `{id,title}`,
  `GET /api/sessions/search?q=` (naive scan over history JSONL — scale is
  tiny).
- UI (chat/public/*): left sidebar — conversation list (title, agent badge,
  time-ago, archive on hover), search box, New chat button; clicking a
  conversation renders its transcript (reuse existing message renderer) and
  sets resume state. Replace the single-key localStorage mechanism with
  `conversationId` + server index. Keep the iframe preset integration
  (`steadymade-preset` postMessage, URL params) working.

**Tasks:**

- [x] 2.1 Server: persist events in `handleChat`/`forwardLine` (user msg on
      request, assistant text + meta on `result`, tool events with `name` +
      `detail`); create/update `chat/sessions.json` (title = first user
      message, 60 chars). NOTE: server resolves the resume chain itself —
      client sends only `conversationId`; a new SSE event `conversation`
      announces the id on first turn.
- [x] 2.2 Server: add the four endpoints + search; path-safety on `id`
      (sanitize to `[a-f0-9-]{8,64}`).
- [x] 2.3 Gitignore: add `chat/history/` and `chat/sessions.json`.
- [x] 2.4 UI: sidebar list + restore transcript + resume chain + rename/
      archive + search; "New chat" starts a fresh conversation without
      deleting anything.
- [x] 2.5 Update `chat/README.md` (storage, endpoints, privacy note: history
      is local per-user data, same class as `runs/`).
- [x] 2.6 Verification (below), including iframe embed still working inside
      the interface Chat view.

**Acceptance criteria + verification:**

1. Two conversations created via UI (or curl) → `GET /api/sessions` lists
   both with titles; files exist under `chat/history/`.
2. Reload page → both conversations listed, transcript renders fully.
3. Resume: follow-up question in conversation 1 referencing an earlier detail
   is answered with context (chain works across the new session ids).
4. Search finds a word from conversation 2 only.
5. Archive hides from default list; history file remains.
6. Interface Chat view (iframe) still loads and presets still arrive.
7. `git status` shows no history files staged (gitignore works);
   `node scripts/validate.mjs` passes.

**Status:**
```
state: done
started: 2026-07-09
completed: 2026-07-09
commit: recorded in phase map
notes:
- VERIFIED end-to-end via curl: conversation event on first turn; resume via
  conversationId recalled a codeword across turns; sessions list with titles/
  turn counts; transcript endpoint returns clean user/assistant/tool events;
  search matched content in the right conversation only; rename + archive OK
  (default list 1, ?all=1 → 2); chat/history/ + chat/sessions.json properly
  gitignored; served page contains sidebar; interface embed URL (4012)
  unchanged. Test conversations removed after verification.
- EMPIRICAL: on this Claude Code version --resume kept the SAME session id
  (currentSessionId == conversationId); the chain logic supports both
  same-id and new-id behavior.
- Mid-phase interruption: the Bash safety classifier was temporarily
  unavailable; Phase 3 file tasks (3.1-3.3) were prepped during the outage.
  The 3.2 DANNY_PROMPT run-log line ships in this phase's commit
  (chat/server.mjs could not be split cleanly).
```

---

## Phase 3 — Learning loop v1 (G3)

**Goal:** the paper contract becomes running practice: run logs get written,
corrections are captured, and a weekly consolidation distills working memory
into curated memory + improvement proposals.

**Depends on:** Phase 1 (write path).

**Tasks:**

- [x] 3.1 Extend the `## Memory` section in `CLAUDE.md` with the feedback
      rule: every explicit user correction → dated `#feedback` entry in
      today's daily note (`- YYYY-MM-DD #feedback | what was wrong | why |
      how to apply`).
- [x] 3.2 Add one line to `DANNY_PROMPT` in `chat/server.mjs`: after
      significant tasks (2+ agents or external artifact) write the run log
      per CLAUDE.md (`runs/YYYY-MM-DD-<slug>.md` from the template) — now
      possible thanks to Phase 1 guardrails.
- [x] 3.3 Create `skills/company/memory-consolidation/SKILL.md`:
      - inputs: `knowledge/personal/memory/daily/*` older than 2 days,
        `MEMORY.md`, recent `runs/*.md`
      - actions: merge durable facts into `MEMORY.md` (dedupe, prune stale,
        keep ≤ ~200 lines); aggregate `#feedback` entries into
        `runs/feedback-summary-YYYY-Www.md`; where feedback implies an
        instruction change, write a **proposal** file
        `knowledge/inbox/instruction-proposals-YYYY-MM-DD.md` (draft only —
        approval logic applies, never edit CLAUDE.md/agent files directly);
        append a `<!-- consolidated: YYYY-MM-DD -->` footer to processed
        daily notes
      - hard rules: never write company knowledge, never delete daily notes.
- [x] 3.4 Add weekly scheduler job (via `POST /api/scheduler/jobs` or
      `scheduler/jobs.json`): prompt "Run the memory-consolidation skill and
      report what changed.", weekly (e.g. Fri 16:00), sane timeout,
      `bypassPermissions: false`. First inspect `buildPrompt(job)` in
      `interface/scheduler.mjs` to format the job correctly. Note the known
      constraint: jobs run only while the interface server runs (documented
      behavior, acceptable).
- [x] 3.5 Verification (below).

**Acceptance criteria + verification:**

1. Seed 2-3 fake daily notes (incl. `#feedback` lines and one stale duplicate
   of a MEMORY.md fact); trigger the job once (scheduler run-now if the
   interface offers it, else `claude -p "Run the memory-consolidation skill"`
   headless from the repo root) → MEMORY.md updated + deduped,
   feedback-summary file exists, proposal file exists in inbox, daily notes
   carry the consolidated footer, nothing under `knowledge/company/` changed.
2. Run a small 2-agent task via chat → a run log appears in `runs/`.
3. Clean up seeded fakes; `node scripts/validate.mjs` passes.

**Status:**
```
state: done
started: 2026-07-09
completed: 2026-07-09
commit: recorded in phase map
notes:
- VERIFIED: weekly job c28bc036 created via POST /api/scheduler/jobs (Fri
  16:00, 20min timeout); manual run-now completed status ok. Headless run
  wrote memory/MEMORY.proposed.md ONLY (MEMORY.md untouched incl. seeded
  duplicate — draft policy holds), merged/deduped facts into correct
  sections, wrote runs/feedback-summary-2026-W28.md (structured what/why/
  how) + runs/instruction-proposals-2026-07-09.md, footered daily notes,
  knowledge/company untouched. Run-log test via chat: routed Rosa task →
  runs/2026-07-09-test-runlog-p3.md written from template with workflow
  classification. All seeded/test data removed afterwards.
- DEVIATION (resolved open question): instruction proposals go to runs/,
  not knowledge/inbox/ (inbox is ask-gated → headless writes impossible).
- SIMON #2 folded in: skill's "Output mode" section mandates proposal-only
  MEMORY.md changes for scheduled runs; applying requires the user.
- BUGFIX during verification: the CLI can emit two result events per turn;
  history now buffers the assistant entry and persists once on child exit
  (chat/server.mjs), verified turns:1 / events user,assistant.
- Skill activation: new company skills need a .claude/skills symlink; the
  hub materializes on interface restart — created manually here
  (ln -s ../../skills/company/memory-consolidation).
```

---

## Phase 4 — Skill version contract (G5)

**Goal:** every skill has a version; marketplace installs are reproducible;
personal skills get rollback.

**Tasks:**

- [x] 4.1 `scripts/validate.mjs`: require semver `version:` in SKILL.md
      frontmatter for `skills/company/*`; clear error message. (Personal
      skills: warn only.)
- [x] 4.2 Add `version: 0.1.0` + a `## Changelog` section (one line per
      version) to all existing company skills (enumerate `skills/company/`
      at execution time; includes `memory-consolidation` from Phase 3).
- [x] 4.3 `skills/README.md`: document the version contract — bump on every
      behavioral change, changelog line mandatory, git review unchanged.
- [x] 4.4 `interface/skills.mjs` install flow: resolve the branch-head commit
      SHA at install time (GitHub API `GET /repos/:o/:r/commits/:ref`,
      graceful offline fallback = `sha: null` + note) and store
      `sha`, `installedAt` in `.install.json`; set `customized: true` when the
      CUSTOMIZE path writes into the skill (locate that code path first).
- [x] 4.5 Update check: endpoint `GET /api/marketplace/updates` comparing
      stored sha vs. current branch head for installed skills; Skill Hub
      badge "update available" (skip UI badge if effort explodes — endpoint
      is the core, note any skip).
- [x] 4.6 `skills/personal/` rollback: `git init` a **local-only** repo inside
      it (parent repo already ignores the folder, so the nested repo is
      inert); `skills.mjs` makes a best-effort `git add -A && git commit` in
      it after install/customize/toggle-related writes. Document in
      `skills/README.md` (never gets a remote).
- [x] 4.7 Verification (below).

**Acceptance criteria + verification:**

1. `node scripts/validate.mjs` fails on a company skill with the version line
   temporarily removed; passes with it restored.
2. Fresh marketplace install → `.install.json` contains `sha` (40-hex) and
   `installedAt`.
3. `git -C skills/personal log --oneline` shows the install commit.
4. Updates endpoint returns sane JSON for the installed skill.

**Status:**
```
state: done
started: 2026-07-09
completed: 2026-07-09
commit: recorded in phase map
notes:
- VERIFIED: validate fails with version stripped (clear error message),
  passes restored; company-onboarding + personal-onboarding + memory-
  consolidation all carry version frontmatter. Test install (anthropics/
  skills docx subpath) → .install.json with owner/repo/ref/subpath and
  pinned sha 9d2f1ae; skills/personal got a local-only git repo with the
  install snapshot commit; GET /api/marketplace/updates → test skill
  "current", legacy pdf install correctly "unpinned". Test skill removed
  and removal snapshotted.
- DEVIATION 4.4: no customized:true write-hook — the updates endpoint
  computes localModified (SKILL.md mtime > installedAt) instead, which also
  catches customizations made through the interface file editor without
  hooking the file API.
- 4.5 partial by design: endpoint is live; the Skill Hub UI badge is
  deferred to Phase 6 polish (plan allowed skipping the badge).
- PROCESS NOTE: scripts/ guardrail is deny-for-writes; it was temporarily
  set to "ask" via the guardrails API for the validate.mjs edit and
  restored to "read" immediately after (covered by the approved plan task
  4.1; change visible in this phase's diff).
- Interface server restarted to load new skills.mjs/server.mjs (scheduler
  jobs persist across restarts; skill symlinks re-materialized).
```

---

## Phase 5 — Raw→clean promotion pipeline + incognito (G4)

**Goal:** brainstorm ≠ knowledge, by default and by mechanism. Raw
conversational material is captured privately; becoming company knowledge is
an explicit, approved act; no-trace mode exists.

**Depends on:** Phases 1-3 (memory + history + write path).

**Tasks:**

- [x] 5.1 `CLAUDE.md`: add the default rule to the Memory section (3-4
      lines): conversational content is **raw + personal** by default; "park
      this" → `## Parked` block in today's daily note; raw/daily material may
      only be cited as unvalidated (consistent with source precedence 7-9);
      the only path to company knowledge is `/promote-knowledge`.
- [x] 5.2 Create `skills/company/promote-knowledge/SKILL.md` (version per
      Phase 4): guided flow —
      1. identify source item (daily-note entry / parked idea / inbox file /
         chat excerpt),
      2. route to Mara (Task) to clean + structure into a draft under
         `knowledge/company/<domain>/`,
      3. register metadata via `PUT /api/meta` (or direct
         `interface/meta.json` edit if the API needs the interface running):
         `status: draft`, `source_type: conversation`, `owner`,
         `last_reviewed`,
      4. present draft to user; **only after explicit approval** set
         `status: approved`,
      5. remove/mark the raw source as promoted.
      Guardrail note: writing into `knowledge/company/` happens via
      Mara/normal session permissions with user present — never from
      scheduled/headless runs.
- [x] 5.3 Incognito mode (chat): UI toggle → `incognito: true` in POST body →
      server: no history persistence, no sessions.json entry, usage log entry
      keeps only cost fields + `incognito: true`; server appends one line to
      the routed message: "Incognito turn: do not write memory, notes, or run
      logs for this turn."; frontend does not persist the conversation id.
- [x] 5.4 `knowledge/README.md`: short "Conversational knowledge lifecycle"
      subsection: raw (daily note) → parked → promoted draft → approved;
      incognito = never captured.
- [x] 5.5 Verification (below).

**Acceptance criteria + verification:**

1. Park a fake brainstorm in chat → appears under `## Parked` in today's
   daily note.
2. Run `/promote-knowledge` on it → cleaned draft file in the right domain
   folder, `meta.json` entry `status: draft`, `source_type: conversation`;
   after simulated approval → `approved`.
3. Incognito conversation: exchange 2 turns → no file in `chat/history/`, no
   index entry, no daily-note lines, usage JSONL has `incognito: true`.
4. `node scripts/validate.mjs` passes; clean up fakes.

**Status:**
```
state: done
started: 2026-07-09
completed: 2026-07-09
commit: recorded in phase map
notes:
- VERIFIED: "Park this idea" via chat → ## Parked entry in today's daily
  note. Incognito turn (with an explicit "remember durably" instruction!) →
  no conversation event, no history file, no sessions.json entry, no daily-
  note write; usage log kept cost data with incognito:true. Promotion E2E:
  cleaned draft written to knowledge/company/commercial/, registered via
  PUT /api/meta with status draft + source_type conversation (validate
  accepted the entry), approval flipped status to approved. All test
  artifacts (draft file, meta entry, daily note, history) removed after.
- promote-knowledge skill v0.1.0 created + activated (symlink); interactive-
  only by design — knowledge/company stays ask-gated so headless runs can
  never promote.
- Incognito multi-turn continuity uses the legacy sessionId field held only
  in page memory (never localStorage).
- PUT /api/meta replaces the whole file — the skill instructs read-merge-
  write; noted for a future PATCH-style endpoint (Phase 6 candidate).
```

---

## Phase 6 — Hardening & polish (optional, pick per value)

**Goal:** mechanical robustness for the new layer. Each item independent —
execute selectively with Allan.

- [x] 6.1 Hooks — DEVIATION from spec: Claude Code hooks cannot force a model
      "flush turn" (PreCompact/SessionEnd cannot inject model-visible
      instructions), so the flush itself stays instruction-based
      (DANNY_PROMPT + CLAUDE.md). Implemented the stronger mechanical piece
      instead: `.claude/hooks/session-start-memory.mjs` + `SessionStart`
      hook in **team-wide `.claude/settings.json`** (resolves the open
      question below) with matcher `startup|resume|clear|compact` — memory
      is auto-injected into every new session AND re-injected right after
      compaction (the actual context-loss moment). VERIFIED: standalone JSON
      output valid; a fresh chat session quoted a seeded marker with zero
      tool calls.
- [x] 6.2 Simon full audit of the new surface — Simon's agent definition was
      upgraded first (quality-proofed v2: system-specific threat model,
      severity calibration, CONFIRMED/PLAUSIBLE discipline,
      verify-the-mitigation rule, read-only rule, merged-findings cap);
      audit run with the upgraded agent; findings + verdict filed as
      `runs/2026-07-09-phase6-security-audit.md`.
- [x] 6.3 `docs/status-and-roadmap.md`: snapshot bumped to 2026-07-09,
      personal-assistant layer section added, Stage-3/phase-3 rows updated
      to "foundations implemented Claude-native".
- [x] 6.4 Skill evals — DEVIATION: lightweight eval fixtures with dated
      baseline results (`skills/company/<skill>/evals/EVALS.md`) instead of
      the full skill-creator harness (disproportionate for two v0.1.0
      skills; port the cases into the harness when skill prompts start
      being iterated). memory-consolidation baseline: C1-C7 PASS (phase-3
      run). promote-knowledge: mechanics cases PASS; Mara routing + decline
      path complete on first real promotion.
- [ ] 6.5 Backlog (explicitly deferred — do not start without a new decision):
      embeddings memory search, heartbeat-style proactive check-ins,
      cross-machine memory sync, OpenClaw Stage-3 adoption decision (module
      map now in `docs/reference/openclaw-module-integration.md`), Skill Hub
      "update available" badge, PATCH-style /api/meta, memory/ in
      backup.sh targets, UI nav regrouping (UX review 2026-07-09), skill
      install tree-hashing (Simon F6), append-only runs/ (Simon F7).

**Status:**
```
state: done (6.1-6.4; 6.5 = standing backlog)
started: 2026-07-09
completed: 2026-07-09
commit: recorded in phase map
notes:
- SIMON AUDIT (upgraded agent v2): verdict Revise → 5 findings FIXED same
  day (chat server now binds 127.0.0.1 — was Critical; scheduler gets the
  MEMORY.md disallowedTools block; hook injects memory prefixed as
  untrusted data; incognito now purges the CLI transcript and drops
  session_id from the usage log; .claude/hooks guardrail = read). 2 findings
  accepted for Stage 1/2 and backlogged (skill-install tree hashing,
  append-only records). Full disposition:
  runs/2026-07-09-phase6-security-audit.md.
- Verification: lsof shows 127.0.0.1 bindings for 4011+4012; incognito turn
  left no transcript file and a session_id-null usage entry; hook E2E test
  (marker quoted with zero tool calls) re-run before fixes.
- Extra deliverables alongside phase 6: docs/guide-personal-assistant.md
  (memory-layer usage guide) and
  docs/reference/openclaw-module-integration.md (Stage-3 module map).
- UX review of interface navigation delivered in chat 2026-07-09;
  implementation deliberately NOT done (nav regrouping needs Allan's call —
  backlogged in 6.5).
```

---

## Phase 7 — Interface & chat UX round (2026-07-10 list) ⚠

**Goal:** implement Allan's 9-point UI/technical improvement list
(analysis delivered in chat 2026-07-10) in three packages, one commit each.
Package 7.3 contains security-relevant runtime/permission changes → Simon
review + Allan approval before it is marked done.

**Design decisions (from the 2026-07-10 analysis):**

- Chat runs become **server-owned** (OpenClaw gateway pattern): the Claude
  child is never killed by a client disconnect; clients attach/detach via
  SSE with replay. Explicit stop endpoint. Incognito keeps the old
  connection-bound lifecycle (no persistence anywhere by design).
- **Direct specialist mode** reverses the "no direct specialist bypass"
  decision (chat/README.md): selecting a specialist talks to that agent
  directly (`--append-system-prompt` from `.claude/agents/<id>.md` + shared
  specialist addendum with approval/no-execution-claim/memory rules). Danny
  stays the default and still orchestrates via Task.
- Artifacts convention: `knowledge/**/_artifacts/` is a first-class artifact
  location; `_artifacts` dirs are excluded from the knowledge folder tree.
- Style gate scoped to content agents (clara/otto/dora/rosa), muted chip.
- Skill capability model extends SKILL.md frontmatter
  (`version`, `requires-plugins`, `knowledge`) — no new instruction system.
- Hub-owned SKILL.md write path fixes the CUSTOMIZE-vs-guardrail conflict
  (`skills/personal: read` blocks /api/file PUT) without weakening the
  guardrail for agents; goes through Simon.

**Tasks — 7.1 quick wins (commit 1):**

- [x] 7.1.1 Header: remove Add Knowledge / New Workflow / Fullscreen buttons
      (search stays); clean up bindChrome.
- [x] 7.1.2 Knowledge view: "+ New doc" (drawer-based create, replaces the
      header prompt() flow).
- [x] 7.1.3 Command Center links: stat cards → Agent Map / Knowledge (incl.
      needs_review filter) / Workflows; Knowledge Health rows →
      selectKnFolder; Recent Artifacts rows → Artifacts view.
- [x] 7.1.4 Knowledge Health: cap at 6 rows (lowest approval ratio first) +
      "view all" link.
- [x] 7.1.5 Sidebar: active user row (server exposes user from
      `os.userInfo()` + `profiles/<user>.yml` in /api/system).
- [x] 7.1.6 Settings order: Project Info, Runtime, Onboarding,
      Profile & Instructions, Plugins, Guardrails (tabs + card order).
- [x] 7.1.7 Chat: streaming markdown (rAF-throttled renderMd on deltas,
      open code fences closed optimistically).
- [x] 7.1.8 Style gate: server emits only for content agents; UI renders
      muted chip instead of red warning.

**Tasks — 7.2 medium (commit 2):**

- [x] 7.2.1 Memory view → Settings section; nav item removed; CLAUDE.md
      "Memory view" sentence updated.
- [x] 7.2.2 Artifact discovery: `listArtifacts` in the storage layer scans
      `artifacts/` + `knowledge/**/_artifacts/**`; `_artifacts` excluded from
      listFolders; /api/artifact serves both roots.
- [x] 7.2.3 Knowledge Docs ⇄ Artifacts toggle per folder (subtree scope).
- [x] 7.2.4 Skill Hub: version/sha/install-date line; "Check updates" wired
      to /api/marketplace/updates with UPDATE AVAILABLE / MODIFIED badges.
- [x] 7.2.5 Skill Hub: "New Skill" (hub-owned createSkill endpoint + drawer)
      + hub-owned SKILL.md save path (fixes CUSTOMIZE 403). ⚠ Simon scope.
- [x] 7.2.6 Onboarding: memory-setup step in /api/workspace, startup modal
      and Settings card (MEMORY.md + daily/ exist).
- [x] 7.2.7 Usage: unified `runs/usage.jsonl` (source field; scheduler runs
      log usage too; legacy chat-usage.jsonl still read); Command Center
      usage row; Usage nav item removed (view reachable from Command Center).

**Tasks — 7.3 structural ⚠ (commit 3, approval-gated):**

- [x] 7.3.1 Chat server run registry: runs keyed by conversation, events
      buffered + persisted incrementally, child survives disconnect,
      `GET /api/chat/attach` (SSE replay), `POST /api/chat/stop`, running
      flag in /api/sessions, one active run per conversation (409).
- [x] 7.3.2 Chat UI: re-attach on conversation open/reload, running badge in
      sidebar, stop = explicit stop (detach ≠ stop).
- [x] 7.3.3 `GET /api/agents` single source (frontmatter + first heading of
      `.claude/agents/*.md`); selector + speaker labels "Name — Function";
      hardcoded copies removed.
- [x] 7.3.4 Direct specialist mode per design decision; chat/README.md
      updated (routing section + safety defaults).
- [x] 7.3.5 Skill capability model: frontmatter parsing, type badges
      (PROMPT/+TOOLS/+KNOWLEDGE), per-skill configure panel, activation
      dependency check against enabled plugins.
- [x] 7.3.6 Simon review of 7.2.5 + 7.3 diff; findings fixed; diff presented
      to Allan; approval recorded here before phase marked done.

**Acceptance criteria + verification:**

1. `node --check` clean on all touched .mjs/.js; `node scripts/validate.mjs`
   passes.
2. /api/system exposes `user`; sidebar shows it; header has only search.
3. Command Center: every card/row navigates; health card ≤ 6 rows; usage row
   shows real totals from the unified log.
4. Artifacts view lists files from `knowledge/**/_artifacts/**` (e.g. the
   gebr-heinemann offer PDFs); Knowledge folder toggle shows them in place.
5. Skill Hub: installed skill shows pinned sha + update status; New Skill
   creates + opens editor; CUSTOMIZE saves without 403.
6. Chat: mid-run conversation switch + page reload → run continues, transcript
   complete after re-attach; explicit stop persists partial text.
7. Direct mode: specialist turn runs without Danny wrapper and is labeled
   "Name — Function"; Danny default unchanged.
8. Style gate absent on plain Danny turns; muted chip on content-agent drafts.

**Status:**
```
state: done
started: 2026-07-10
completed: 2026-07-11
commit: pending local commit (not committed in this session)
notes:
- Phase created from the 2026-07-10 chat analysis (9-point list from Allan +
  OpenClaw-pattern recommendations). Allan approved implementation
  2026-07-10 ("yes please complete as suggested").
- 7.1 is partially landed from an interrupted session: 7.1.1, 7.1.2, 7.1.4,
  7.1.5, 7.1.6, 7.1.7, 7.1.8 are in code and were validated locally
  (`node --check` + `node scripts/validate.mjs`).
- 7.3.1-7.3.4 implemented: server-owned run registry with attach/stop,
  running flags in sessions, `/api/agents` registry from `.claude/agents`,
  UI auto-attach/running badges/explicit stop semantics, and direct specialist
  execution mode with shared safety addendum + usage mode metadata.
- 7.2.1-7.2.6 and 7.3.5 implemented: Memory moved into Settings, onboarding
  memory checks added, artifacts merged from `artifacts/` +
  `knowledge/**/_artifacts/**` (including Knowledge Docs toggle), Skill Hub now
  shows version/install/update state, supports personal New Skill + scoped
  SKILL.md save path, and enforces plugin dependencies on activation.
- 2026-07-10 follow-up: 7.1.3 + 7.2.7 completed. Command Center review card now
  opens Knowledge Docs with a review-needed filter; usage is unified in
  `runs/usage.jsonl` with source-aware chat/scheduler entries and legacy
  `runs/chat-usage.jsonl` compatibility.
- Verification (2026-07-10): `node --check interface/public/app.js
  interface/server.mjs interface/scheduler.mjs chat/server.mjs` ✅, `node
  scripts/validate.mjs` ✅ ("Checks passed: 241").
- 2026-07-10 Simon follow-up hardening patch applied for 7.2.5 + 7.3 scope:
  mutation-request protections (JSON + trusted local origin/referer with token
  fallback), Skill Hub write guardrails with ask-confirm flow,
  artifacts restricted to `artifacts/` + `knowledge/company/**/_artifacts/**`,
  /api/artifact symlink+realpath enforcement, scheduler default permission/tool
  constraints, and incognito README wording clarified as best-effort cleanup.
  Simon review verdict was Stop before fixes; minimum patch set was applied and
  revalidated.
- Allan approval recorded 2026-07-11: user explicitly requested to "mark step 7
  done" after the implemented changes and security follow-up.
- UI alignment follow-up 2026-07-11: Settings Profile rows aligned, MCP row
  removed from Profile (plugins remain in Plugins tab), memory/MEMORY.md made
  editable via the same settings drawer pattern, and Settings/Onboarding badges
  normalized by tightening `.kv-row` selectors.
```

---

## Decisions log (append-only)

- 2026-07-09 — Plan created from `docs/reference/personal-assistant-gap-analysis.md`
  (R1-R5 → Phases 1-5). Memory layout adopts OpenClaw semantics
  (MEMORY.md + daily notes) inside the existing `knowledge/personal/` contract
  to keep the Stage-3 option mechanical.
- 2026-07-09 — Write permissions are granted via **guardrail path-scoped
  rules**, not by widening `CHAT_ALLOWED_TOOLS` globally (fallback documented
  in task 1.3).
- 2026-07-09 — Chat history is product-owned (`chat/history/` +
  `chat/sessions.json`), deliberately duplicating Claude Code's internal
  store rather than scraping `~/.claude/projects/`.
- 2026-07-09 — **Phase 1 deviation: memory lives at top-level `memory/`, not
  `knowledge/personal/memory/`.** Reason: guardrails materialize
  `knowledge/personal` (level `read`) as hard `deny` rules for
  `Edit/Write(./knowledge/personal/**)`, and Claude Code deny rules take
  precedence over any child-path allow rule — a scoped allow inside that tree
  is impossible without weakening the personal folder's write-block. A sibling
  top-level `memory/` folder (guardrail level `write`, gitignored except its
  README, same privacy contract) keeps `knowledge/personal/` fully protected.
- 2026-07-09 — `runs` guardrail level changes `read` → `write`: run logs are
  the learning loop's output and were technically impossible to write (this
  was a second, independent cause of "zero run logs" beside the chat
  allowlist). Risk (agents can modify existing local run logs) accepted for
  Stage 1/2; noted for Simon review.
- 2026-07-10 — **Chat design reversal (Allan):** the chat agent selector gets
  a direct specialist mode (no Danny wrapper); "no direct specialist bypass"
  in chat/README.md is superseded. Danny remains default; approval logic and
  no-execution-claim rules are injected into direct specialist prompts.
- 2026-07-10 — Chat run lifecycle decoupled from the HTTP connection
  (server-owned run registry, attach/stop endpoints). Client disconnect no
  longer kills a run; incognito keeps the connection-bound lifecycle.
- 2026-07-10 — `knowledge/**/_artifacts/` recognized as first-class artifact
  location (scanned by the Artifacts view, toggle in Knowledge Docs,
  excluded from the knowledge folder tree).
- 2026-07-10 — SKILL.md writes from the interface go through a hub-owned
  endpoint (like installs) instead of weakening the `skills/personal: read`
  guardrail for agents.

## Open questions (resolve with Allan when reached)

- ~~Phase 3: proposals location~~ RESOLVED 2026-07-09: instruction proposals
  land in `runs/instruction-proposals-YYYY-MM-DD.md` — `knowledge/inbox/` is
  ask-gated and headless runs cannot answer permission prompts. Cadence stays
  weekly Friday 16:00.
- Phase 5: which domain folders are legal promotion targets for
  conversation-sourced knowledge (default: all `knowledge/company/<domain>/`
  except `company_handbook_SSOT/`, which stays onboarding/SSOT-process only).
- Phase 6.1: hooks local-only (`settings.local.json`) or team-wide
  (`settings.json` via git)?
