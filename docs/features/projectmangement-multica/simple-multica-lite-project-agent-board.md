Development Specification: Simple Multica-Lite Project & Agent Board
1. Goal
Build a lightweight project-management and human-agent coordination app for a small team of 2 people.
The app should use Multica as a reference concept, but stay much simpler:
- Manage multiple projects.
- Show project tasks in a Kanban board.
- Assign tasks to humans or AI agents.
- Track task status, blockers, notes, files, and agent run history.
- Store project data as simple files on a shared drive instead of requiring a full database.
- Keep the system easy to inspect, backup, and manually edit if needed.
This is not intended to replace a full workflow runtime like Trigger.dev or a full CRM. It is a lightweight planning and coordination layer.
2. Reference: What to borrow from Multica
Use Multica as inspiration for:
- Human-agent task planning.
- Assigning work to humans or agents.
- Showing active tasks, blockers, and progress.
- Linking tasks to files, prompts, project notes, and outputs.
- Keeping humans in control of approval/review steps.
- Making agent work visible instead of hidden.
Do not copy full Multica complexity in the first version.
Avoid:
- Complex multi-tenant setup.
- Heavy database dependency.
- Advanced permission system.
- Full agent runtime orchestration.
- Public hosting by default.
- Complex integrations before basic project/task flow works.
3. Target Users
Initial users:
- Founder/operator
- One teammate or assistant
Optional task assignees:
- Human user
- Research agent
- Writing agent
- Coding agent
- Admin/operations agent
- Generic custom agent
4. Core Product Concept
The app is a small local or private web app.
Example usage:
Open app
  -> choose project
  -> view Kanban board
  -> create task
  -> assign to human or agent
  -> attach/link project files
  -> agent produces output
  -> human reviews and moves task forward
The main value is visibility:
- What projects exist?
- What tasks are open?
- Who or which agent owns each task?
- What is blocked?
- What was produced?
- What needs review?
5. Storage Model
Recommended storage:
SharedDrive/
  MiniAgencyBoard/
    data/
      projects/
        project-client-a.json
        project-internal-ops.json

      tasks/
        task-001.json
        task-002.json
        task-003.json

      agents/
        agent-research.json
        agent-writing.json
        agent-coding.json

      runs/
        run-001.json
        run-002.json

      audit/
        2026-07-13.jsonl

    files/
      client-a/
        brief.md
        proposal.pdf
        research-notes.md

    templates/
      task-template.md
      proposal-template.md
Use:
- JSON for app state.
- Markdown for long notes, briefs, project docs, and templates.
- JSONL for append-only audit/activity logs.
- Shared drive for files and simple sync.
- Avoid a shared-drive SQLite database for concurrent multi-user writes.
6. Recommended Architecture
MVP architecture
Browser UI
  -> Local/private app server
  -> Reads/writes JSON/Markdown files
  -> Shared drive stores data and files
Preferred:
User A browser ┐
               ├── MiniAgencyBoard app running on one machine
User B browser ┘
                    -> writes files safely
                    -> watches/reloads data folder
This is safer than both users running separate apps that write to the same files.
Alternative simple mode:
User A local app -> shared drive JSON files
User B local app -> shared drive JSON files
This can work, but requires stronger conflict detection.
7. Main UI Elements
7.1 Projects Dashboard
Purpose: show all active projects.
Fields shown:
- Project name
- Client/internal label
- Status
- Owner
- Number of open tasks
- Number of blocked tasks
- Last activity
- Assigned agents
- Linked folder
Example statuses:
active
paused
completed
archived
Actions:
- Create project
- Open project
- Archive project
- Open project folder
- View project activity
7.2 Project Detail Page
Purpose: one place for all project work.
Sections:
- Project summary
- Linked files
- Task board
- Assigned humans
- Assigned agents
- Recent activity
- Notes
- Outputs
Tabs:
Overview | Board | Files | Agents | Activity | Settings
7.3 Kanban Board
Core UI.
Columns:
Backlog
To Do
In Progress
Needs Review
Blocked
Done
Optional later columns:
Waiting for Client
Approved
Cancelled
Each task card should show:
- Title
- Status
- Priority
- Owner or assigned agent
- Due date
- Blocker flag
- Latest activity
- File/output indicator
- Review required flag
Example card:
Prepare client proposal
Priority: High
Assigned: Writing Agent
Status: Needs Review
Due: Jul 15
Output: proposal-draft.md
Actions:
- Drag task between columns
- Open task detail
- Assign user/agent
- Mark blocked
- Add comment/note
- Link file
- Start agent run
- Mark done
7.4 Task Detail Drawer/Page
Purpose: inspect and update one task.
Fields:
- Task title
- Description
- Project
- Status
- Priority
- Owner
- Assigned agent
- Due date
- Tags
- Checklist
- Linked files
- Agent instructions
- Agent output
- Comments/notes
- Activity history
Important buttons:
Assign to me
Assign to agent
Start agent
Mark needs review
Approve output
Reject output
Mark blocked
Mark done
7.5 Agent Assignment Panel
Purpose: choose which agent should work on a task.
Agent examples:
Research Agent
Writing Agent
Coding Agent
Admin Agent
Review Agent
Each agent profile should show:
- Name
- Role
- Description
- Allowed task types
- Input requirements
- Output format
- Status: available / running / disabled
- Default prompt/instructions file
- Last run
Example:
{
  "id": "agent-writing",
  "name": "Writing Agent",
  "role": "Drafts client-facing documents",
  "allowedTaskTypes": ["proposal", "email", "summary", "brief"],
  "status": "available",
  "instructionsFile": "../../templates/agents/writing-agent.md"
}
7.6 Agent Run Log
Purpose: show what agents did.
Each run should track:
- Run ID
- Task ID
- Agent ID
- Started at
- Finished at
- Status
- Input
- Output files
- Error message if failed
- Human review result
Run statuses:
queued
running
completed
failed
cancelled
needs_review
approved
rejected
Example:
{
  "id": "run-001",
  "taskId": "task-001",
  "agentId": "agent-writing",
  "status": "completed",
  "startedAt": "2026-07-13T10:00:00Z",
  "finishedAt": "2026-07-13T10:04:00Z",
  "outputFiles": [
    "../../files/client-a/proposal-draft.md"
  ],
  "reviewStatus": "needs_review"
}
7.7 Review / Approval Queue
Purpose: show all tasks where an agent has produced something that needs human review.
Fields:
- Task
- Project
- Agent
- Output file
- Created time
- Reviewer
- Review status
Actions:
Open output
Approve
Reject
Request changes
Add feedback
This keeps the human in control.
7.8 Files Panel
Purpose: show project-related files.
Files are stored normally on the shared drive.
The app should not need to ingest everything into a database.
File panel shows:
- Project folder
- Linked files
- Generated outputs
- Briefs
- Notes
- Templates
- Attachments
Example:
/files/client-a/
  brief.md
  discovery-notes.md
  proposal-draft.md
  final-proposal.pdf
7.9 Activity / Audit Log
Purpose: basic traceability.
Track important events:
- Project created
- Task created
- Task moved
- Owner changed
- Agent assigned
- Agent run started
- Agent output produced
- Output approved/rejected
- Task completed
- File linked
Use JSONL:
{"time":"2026-07-13T10:00:00Z","actor":"allan","action":"task.created","taskId":"task-001"}
{"time":"2026-07-13T10:02:00Z","actor":"allan","action":"task.assigned_agent","taskId":"task-001","agentId":"agent-writing"}
{"time":"2026-07-13T10:04:00Z","actor":"agent-writing","action":"run.completed","runId":"run-001","taskId":"task-001"}
8. Example Data Models
Project JSON
{
  "id": "project-client-a",
  "name": "Client A Automation Setup",
  "type": "client",
  "status": "active",
  "owner": "allan",
  "description": "Initial automation and AI workflow setup for Client A.",
  "folderPath": "../../files/client-a",
  "assignedAgents": ["agent-research", "agent-writing"],
  "createdAt": "2026-07-13T09:00:00Z",
  "updatedAt": "2026-07-13T09:00:00Z"
}
Task JSON
{
  "id": "task-001",
  "projectId": "project-client-a",
  "title": "Prepare client proposal",
  "description": "Draft a short proposal based on the discovery notes.",
  "status": "needs_review",
  "priority": "high",
  "owner": "allan",
  "assignedAgent": "agent-writing",
  "dueDate": "2026-07-15",
  "tags": ["proposal", "client-facing"],
  "checklist": [
    {
      "text": "Review discovery notes",
      "done": true
    },
    {
      "text": "Draft proposal",
      "done": true
    },
    {
      "text": "Human review",
      "done": false
    }
  ],
  "linkedFiles": [
    "../../files/client-a/discovery-notes.md",
    "../../files/client-a/proposal-draft.md"
  ],
  "latestRunId": "run-001",
  "version": 3,
  "createdAt": "2026-07-13T09:10:00Z",
  "updatedAt": "2026-07-13T10:04:00Z"
}
9. File Safety Requirements
Because the app uses files instead of a DB, it should write safely.
Required:
- Use one file per task/project/agent/run.
- Avoid one giant tasks.json.
- Write through temporary files.
- Rename temporary file into place.
- Validate JSON before saving.
- Keep version and updatedAt fields.
- Detect if a file changed since user opened it.
- Show conflict warning instead of silently overwriting.
Safe write pattern:
task-001.json.tmp
validate
rename to task-001.json
Conflict behavior:
This task was changed by someone else.
Options:
- Reload latest
- Save as copy
- Overwrite
10. MVP Scope
Version 1 should include:
- Project list
- Project detail page
- Kanban board
- Create/edit tasks
- Assign task to human
- Assign task to agent
- Simple agent registry
- Manual “start agent” placeholder
- Task notes
- Linked files
- Activity log
- JSON file storage
- Folder watching/reload
- Conflict detection
Do not include yet:
- Full authentication
- Complex roles/permissions
- Multi-company support
- SQLite shared-drive database
- External CRM integration
- Full autonomous agent runtime
- Public hosting
- Billing
- Advanced analytics
11. Suggested MVP Technology
Simple option:
Next.js or lightweight React app
Node.js backend
JSON files on disk
Markdown files for notes
JSONL audit log
Alternative even simpler:
Local Electron/Tauri app
Reads/writes shared folder directly
But for two users, the safer option is:
One small web app running on one machine
Both users access it in browser
Only the server writes files
12. Success Criteria
The MVP is successful if:
- Two users can see the same projects and tasks.
- Tasks can be moved through Kanban columns.
- Tasks can be assigned to humans or agents.
- Agent output can be linked to a task.
- Human review is visible.
- Project files remain on the shared drive.
- Data is understandable as JSON/Markdown files.
- No full database is required.
- No SQLite file is written by multiple machines over a shared drive.
13. Short Product Summary
Build a Multica-inspired lightweight project and agent board for a 2-person team. It should manage projects, Kanban tasks, human/agent assignments, files, outputs, and review status. Store state as small JSON files and Markdown documents on a shared drive, with an append-only JSONL activity log. Prefer one small local web server that owns all writes, while users access it through the browser.