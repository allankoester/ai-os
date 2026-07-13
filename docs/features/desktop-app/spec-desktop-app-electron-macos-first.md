# Desktop App Spec (macOS-first, Electron)

- Status: draft
- Date: 2026-07-13
- Scope: development specification only (no code changes in this document)
- Primary target: macOS `.dmg` pilot (Apple Silicon first)
- Secondary target: Windows installer after macOS pilot gates pass

## 1) Executive recommendation

Use Electron as the first desktop shell for this codebase.

Reason:

- The current app is already a local Node + browser architecture with process spawning, PTY usage, and localhost services.
- Electron can host this model with the lowest refactor risk.
- Tauri is possible, but for this repository it likely requires a Node sidecar for `node-pty` and CLI workflows, which adds coordination and packaging complexity without reducing first-delivery risk.

Terminology:

- macOS installer image is `.dmg` (not `.dng`).

## 2) Current system and dependency map

### Confirmed current architecture

- Two local Node services:
  - interface service on `127.0.0.1:4011` (`interface/server.mjs`)
  - chat service on `127.0.0.1:4012` (`chat/server.mjs`)
- UI is static web assets with iframe coupling between interface and chat (`interface/public/app.js`, `chat/public/app.js`).
- Startup is script-managed multi-process launch (`scripts/start.mjs`, `scripts/stop.mjs`).
- Scheduler is in-process and only active while interface runtime is active (`interface/scheduler.mjs`, `scheduler/README.md`).

### Dependency classes

Bundled runtime dependencies (expected in desktop build):

- `@xterm/addon-fit`, `xterm`, `ws`, `node-pty` (`package.json`)

External prerequisites (must be detected, not assumed):

- Claude/OpenCode CLI binaries used by chat and scheduler runtime paths

Platform-specific dependencies/assumptions to neutralize:

- macOS-only terminal launcher flow in chat runtime
- fixed port assumptions (`4011`, `4012`) and localhost trust logic

High-impact optional features (do not ship by default in standard client mode):

- arbitrary terminal/PTTY input
- custom MCP command execution
- marketplace skill install from remote tarball

## 3) Target architecture proposal

### Proposed layers

1. Electron shell (trusted control plane)
   - window lifecycle
   - update UX
   - runtime supervision
   - narrow preload bridge
2. Node runtime host (reused business/runtime logic)
   - interface/chat APIs
   - scheduler
   - storage adapters
   - CLI process orchestration
3. Web UI (existing static app, adapted to desktop runtime config)

### Boundary rules

- Renderer sandboxed (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` in implementation phase).
- No direct renderer access to generic shell/filesystem/process operations.
- Privileged operations brokered by main process with explicit capability checks.
- Localhost HTTP control surfaces should be minimized over time in favor of validated IPC/main-process mediation.

### State separation

Keep these physically separate:

- immutable app bundle (installed app)
- mutable workspace (user-selected repo/project)
- mutable app-state (chat/scheduler/log/config)
- credentials (OS credential store)

## 4) External storage proposal

### Storage classes and placement

- Workspace source + instructions: user-managed workspace path
- Company knowledge: OneDrive canonical linkage or Graph-backed adapter (existing pattern)
- Personal knowledge: local-only scope, never auto-promoted to shared storage
- Runtime state (chat history, runs, scheduler records, settings): app-data directory per OS
- Secrets: OS keychain/credential manager (not JSON vault files in release builds)

### Proposed local data roots

- macOS: `~/Library/Application Support/Steadymade AI OS/`
- Windows: `%APPDATA%/Steadymade AI OS/` (or `%LOCALAPPDATA%` for cache/log partitions)

### External storage decisions

- Keep OneDrive/Graph as optional shared-knowledge backend.
- Do not replicate shared knowledge into app bundle or installer payloads.
- Do not bundle local personal/runtime state into release artifacts.

## 5) API and integration proposal

### Keep local

- local-first file operations in workspace and app-state roots
- local scheduler and chat history

### Move to controlled backend when trust is required

- durable secret issuance and rotation
- tenant authorization and policy enforcement
- authoritative audit logs
- proprietary logic that must not be exposed client-side

### Integration policy

- treat model/MCP providers as external data egress boundaries
- explicit provider allowlisting in production profile
- no client-wide static API secrets in distributable artifacts

## 6) Terminal, CLI, scheduler, plugin proposal

### Mode matrix

Standard client mode (default):

- terminal/PTTY execution: disabled
- arbitrary MCP command testing: disabled
- marketplace skill install: disabled or restricted to signed catalog
- scheduler: limited safe subset only

Privileged operator mode (internal controlled):

- terminal/PTTY: enabled with explicit session grant + timeout
- scheduler advanced flows: enabled with policy guardrails
- MCP/plugin changes: allowlisted, logged, reviewed

Developer mode:

- full local capabilities for trusted engineering users only

### Required controls where privileged execution exists

- short-lived capability tokens
- strict allowlists
- scrubbed child-process environment
- sender validation for all IPC boundaries
- local action logs treated as non-authoritative (tamperable by endpoint owner)

## 7) Packaging, signing, and updates

## Tooling choice

Recommended baseline:

- Electron Forge for packaging/publish flow
- macOS makers: DMG + ZIP
- Windows maker later: Squirrel/installer path (or NSIS if pipeline choice changes)

Alternative:

- electron-builder is valid if team prefers integrated `electron-updater` and NSIS-first workflow.

Pick one packaging/update stack and keep it consistent.

### macOS release requirements

- Apple Developer account
- Developer ID code signing
- hardened runtime
- notarization + stapling
- signed `.dmg` for install
- signed `.zip` for update payload

### Windows follow-up requirements

- signed installer and executables
- timestamped signatures
- SmartScreen reputation ramp expected for new publisher binaries

### Update channel policy

Phase 1 (pilot):

- manual signed updates

Phase 2:

- consent-based auto-update over private HTTPS storage/CDN
- immutable artifacts
- rollback path
- staged rollout + incident revoke workflow

## 8) Code exposure and confidentiality model

Non-negotiable constraints:

- Electron/ASAR improves packaging and integrity controls, not confidentiality.
- Determined clients can inspect bundled JavaScript and alter local behavior.
- Client-side code must be treated as inspectable.

Therefore:

- never ship long-lived secrets in client bundle or local JSON defaults
- keep sensitive decision logic and authorization on controlled services
- use signing/notarization to prove publisher and integrity, not to hide code

## 9) Risk register and release gates

### Priority risks

Critical:

- plaintext credential handling in local settings (must be rotated and removed from release path)

High:

- privileged execution surfaces (terminal/PTTY, MCP command execution, scheduler side effects)
- renderer-to-runtime trust boundary weakness if localhost APIs are exposed directly
- packaging leakage of local/private runtime files

Medium:

- native module (`node-pty`) ABI/packaging portability
- cross-platform path/process assumptions
- local data retention/privacy handling

### Mandatory release gates (must pass before client distribution)

- secret scan pass on unpacked artifacts
- packaging exclusions enforced for private/runtime state
- OS credential store migration complete
- Electron boundary review passed (main/preload/IPC/navigation/permissions)
- dependency lock, SBOM, vulnerability scan, provenance checks
- signed/notarized artifacts verified on clean machines
- tampered update test and rollback test passed

## 10) Phase plan, dependencies, and acceptance

### Phases

1. architecture proof in desktop shell (no broad feature unlock)
2. state separation + migration path
3. signed/notarized macOS pilot `.dmg`
4. updater hardening and controlled rollout
5. Windows packaging pilot

### Key dependencies

- Apple Developer signing/notarization readiness
- final packaging stack decision (Forge vs builder)
- `node-pty` packaging validation on target architectures
- policy decision for terminal/MCP/scheduler capabilities in production mode
- controlled storage/update hosting decision

### Acceptance examples

- app installs and launches from signed/notarized macOS `.dmg`
- workspace and app-state survive app updates without overwrite
- no private/local secrets shipped in artifact
- update rollback works without data loss
- Windows pilot reaches parity for core launch/workflow paths

## Sources

Internal repository evidence:

- `package.json`
- `interface/server.mjs`
- `chat/server.mjs`
- `scripts/start.mjs`
- `scripts/stop.mjs`
- `interface/scheduler.mjs`
- `scheduler/README.md`
- `interface/storage/config.mjs`
- `interface/storage/graph-storage.mjs`
- `docs/status-and-roadmap.md`

External references (implementation-time validation required):

- Electron docs: security, updates, code signing
- Electron Forge docs: build lifecycle, makers/publishers, auto-update
- Apple docs: notarization and hardened runtime
- Microsoft docs: Artifact Signing / Authenticode guidance

## Approval status

This specification is a draft and requires explicit user approval before it becomes a release/runbook baseline.
