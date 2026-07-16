# Project storage and refresh architecture

This diagram documents the current Stage 1/2 file-based architecture after enabling shared team Project Board storage under OneDrive.

## Effective shared team board root

`/Users/allan/Library/CloudStorage/OneDrive-SharedLibraries-SMAPAS/SteadyMade.ai - General/AI_OS/apps/steadymade-ai-os/project-board/team`

## Diagram

```mermaid
flowchart LR
  subgraph LocalMachine[Local machine runtime]
    UI[Interface UI\nKnowledge · Artifacts · Automations · Projects]
    API[interface/server.mjs]
    Board[board/service.mjs + board/storage.mjs]
    Scheduler[scheduler.mjs\nlocal jobs/runs/logs]
    PrivateBoard[~/.steadymade-ai-os/board-private\nprojects tasks activity audit]
    PrivateArtifacts[repo artifacts/project-board/private]
    KnowledgeLocal[knowledge/ + knowledge/personal]
  end

  subgraph SharedOneDrive[Shared OneDrive AI_OS]
    TeamBoard[/AI_OS/apps/steadymade-ai-os/project-board/team\nprojects tasks activity audit]
    TeamArtifacts[/AI_OS/apps/steadymade-ai-os/project-board/team/artifacts/project-board/team]
    SharedKnowledge[/AI_OS/knowledge/company + inbox + team]
  end

  UI --> API
  API --> Board
  API --> Scheduler
  API --> KnowledgeLocal
  API --> SharedKnowledge

  Board --> PrivateBoard
  Board --> TeamBoard

  Board --> PrivateArtifacts
  Board --> TeamArtifacts

  Scheduler --> PrivateArtifacts
  Scheduler --> TeamArtifacts
```

## Storage intent

- Projects/tasks with `visibility=private` stay on local machine roots.
- Projects/tasks with `visibility=team` persist in the shared OneDrive team root.
- Private task artifacts remain local under `artifacts/project-board/private/...`.
- Team task artifacts persist under the shared team root artifact branch.
- Scheduler state remains local (`scheduler/jobs.json`, `scheduler/runs.json`, `scheduler/logs/*`) to avoid duplicate distributed execution.

## UI refresh behavior

- Knowledge, Artifacts, Automations, and Projects all refresh once when their view opens.
- Each of those views exposes a manual `Refresh` button in the header area.
- Refresh paths include stale-response guards so late responses do not overwrite current view state.
- Knowledge `.md` files now default to Preview mode for normal open; new docs can still open in Edit.
