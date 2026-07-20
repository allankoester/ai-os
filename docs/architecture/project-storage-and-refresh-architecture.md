# Project storage and refresh architecture

This diagram documents the implemented local-core storage model.

## Diagram

```mermaid
flowchart LR
  subgraph LocalMachine[Local machine runtime]
    UI[Interface UI\nKnowledge · Artifacts · Automations · Projects]
    API[interface/server.mjs]
    Board[board/service.mjs + board/storage.mjs]
    Scheduler[scheduler.mjs]
    Chat[chat/server.mjs]
    RuntimeDB[(machine-local SQLite\nboard/scheduler/chat-index/events)]
    Usage[runs/usage.jsonl\ncanonical append stream]
    ChatHistory[chat/history/*.jsonl\ncanonical transcripts]
    WorkspaceFiles[knowledge/**, memory/**, runs/*.md\nworkspace file authority]
  end

  subgraph ExternalAuthorities[External authorities (optional)]
    Graph[OneDrive/Graph\nshared knowledge authority]
    CRM[Twenty CRM\nCRM domain authority]
    TeamSvc[Team board service\nDEFERRED]
  end

  UI --> API
  API --> Board
  API --> Scheduler
  API --> Chat

  Board --> RuntimeDB
  Scheduler --> RuntimeDB
  Chat --> RuntimeDB

  Scheduler --> Usage
  Chat --> Usage
  Chat --> ChatHistory

  API --> WorkspaceFiles
  API --> Graph
  API --> CRM
```

## Storage intent (current)

- Private/local board operational state is SQLite canonical in the machine-local runtime root.
- Scheduler operational state is SQLite canonical; `scheduler/logs/*` remains file logs.
- Chat session metadata/search index is SQLite canonical.
- Chat transcripts remain canonical JSONL in `chat/history/*.jsonl`.
- Usage telemetry stream remains canonical JSONL in `runs/usage.jsonl`; SQLite usage tables are derived projections.
- Team board canonical authority is deferred to a separate team service and is not provided by local shared-drive JSON.

## Refresh behavior

- Knowledge, Artifacts, Automations, and Projects refresh on view open.
- Each view provides a manual `Refresh` action.
- Stale-response guards prevent late responses from overwriting current state.
