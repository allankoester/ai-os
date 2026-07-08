# Environment Parity Checklist

Run per user machine. All boxes must be checked on **every** team machine
before moving execution to a VM (Stage 4).

Machine: ____________  User: ____________  Date: __________

## Software

- [ ] Node.js 18+ (`node --version`)
- [ ] git installed and authenticated for the repo
- [ ] Claude Code installed and signed in
- [ ] Repo cloned at a known path; `git pull` clean (no local divergence)

## Project state

- [ ] `node scripts/validate.mjs` passes
- [ ] Interface starts: `node interface/server.mjs` → http://localhost:4011
- [ ] `/api/system` lists all agents and knowledge folders
- [ ] Skills profile exists: `profiles/<user>.yml` (validated)

## Knowledge

- [ ] `knowledge/company/` resolves to canonical OneDrive source (`AI_OS/knowledge/company`) via local symlink
- [ ] `knowledge/personal/` is untracked (`git status` shows nothing from it)
- [ ] Same `STEADYMADE_KNOWLEDGE_BACKEND` / FS root convention as documented

## Operations

- [ ] Backup created within the last 7 days (`scripts/backup.sh list`)
- [ ] Restore tested at least once on this machine
- [ ] User has read `docs/runbook-team-operations.md`
