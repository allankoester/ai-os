# ADR 2026-07-20 — Phase 0 runtime/storage baseline decisions

Status: accepted  
Date: 2026-07-20  
Scope: browser runtime (`interface/` + `chat/`) Phase 0 contracts only

## Decision summary

1. **Mode/capability model is mandatory**
   - Runtime tracks requested mode and effective mode.
   - Team behavior is capability-gated; unavailable capability fails closed.

2. **Initial release is local-only**
   - Local core is the only guaranteed operational baseline.
   - Team-layer writes are not part of this release lane.

3. **Node baseline is Node 22+**
   - Storage/runtime contracts standardize on Node 22+.
   - SQLite implementation direction is Node built-in `node:sqlite`.

4. **Interface/chat DB topology is separate**
   - `interface` runtime and `chat` runtime use separate operational DB files.
   - No shared mutable DB file across both runtimes in Phase 0 contracts.

5. **Operational DB placement is machine-local only**
   - Runtime DB files must live in a machine-local runtime directory.
   - Synced/network roots are non-compliant for canonical runtime DB authority.

6. **Authority marker + rollback rule**
   - Cutover requires an explicit authority marker per migrated domain.
   - Rollback restores the last full pre-cutover snapshot; no dual-canonical writes.

7. **Profile switching is restart-only**
   - Profile/mode switches are applied on restart.
   - No hot-switch migration in this lane.

8. **Team service remains deferred**
   - Central team service is not introduced here.
   - Team writes remain deferred and capability-unavailable by default.

## Consequences

- Phase 0 established contracts and migration evidence definitions used for local-core rollout.
- Local-core runtime now uses SQLite canonical stores for scheduler/private-board/chat-session-index domains under these decisions.
- Team-board canonical authority remains deferred pending a separately approved team service.

## Enforcement boundary note

- There is no unified agent gateway in this ADR scope.
- Enforcement remains runtime-specific (Claude runtime rules, interface API checks, scheduler restrictions, MCP-local controls).
