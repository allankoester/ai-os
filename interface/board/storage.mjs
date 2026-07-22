import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import {
  createDatabaseSnapshot,
  databaseQuickCheck,
  initializeStorageKernel,
} from '../storage/runtime/storage-kernel.mjs';

import { boardError } from './errors.mjs';

const SCOPES = ['private', 'team'];
const BOARD_AUTHORITY_MARKER = 'board.sqlite.authority.v1';
const BOARD_DB_COMPONENT = 'interface-board-private';

const BOARD_MIGRATIONS = [
  {
    version: 4101,
    name: 'board_private_authority_v1',
    sql: `
      CREATE TABLE IF NOT EXISTS board_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        authority_mode TEXT NOT NULL DEFAULT 'legacy_pending',
        authority_marker TEXT,
        authority_activated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS board_import_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_name TEXT NOT NULL,
        status TEXT NOT NULL,
        source_count INTEGER NOT NULL DEFAULT 0,
        source_hash TEXT,
        imported_count INTEGER NOT NULL DEFAULT 0,
        imported_hash TEXT,
        reconciled INTEGER NOT NULL DEFAULT 0,
        diagnostic TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS board_projects (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        schema_version TEXT,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        visibility TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        description TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        review_json TEXT NOT NULL,
        blocked_json TEXT NOT NULL,
        scope_migration_json TEXT,
        linked_paths_json TEXT NOT NULL,
        linked_runs_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (scope, id)
      );

      CREATE INDEX IF NOT EXISTS idx_board_projects_scope_updated ON board_projects(scope, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_projects_scope_status ON board_projects(scope, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_projects_scope_visibility ON board_projects(scope, visibility, updated_at DESC);

      CREATE TABLE IF NOT EXISTS board_activities (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        schema_version TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        visibility TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        custom_fields_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (scope, id)
      );

      CREATE INDEX IF NOT EXISTS idx_board_activities_scope_updated ON board_activities(scope, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_activities_scope_status ON board_activities(scope, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_activities_scope_visibility ON board_activities(scope, visibility, updated_at DESC);

      CREATE TABLE IF NOT EXISTS board_tasks (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        schema_version TEXT,
        project_id TEXT,
        activity_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        work_type TEXT NOT NULL DEFAULT 'feature',
        assignee_type TEXT NOT NULL,
        assignee_id TEXT,
        human_assignee_label TEXT,
        task_list_id TEXT,
        workflow_id TEXT,
        subtasks_json TEXT NOT NULL,
        component_tags_json TEXT NOT NULL DEFAULT '[]',
        sprint TEXT,
        story_points INTEGER,
        completion_percent INTEGER NOT NULL DEFAULT 0,
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        external_links_json TEXT NOT NULL DEFAULT '[]',
        custom_fields_json TEXT NOT NULL DEFAULT '{}',
        due_at TEXT,
        review_json TEXT NOT NULL,
        blocked_json TEXT NOT NULL,
        visibility TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (scope, id),
        FOREIGN KEY (scope, project_id) REFERENCES board_projects(scope, id) ON DELETE CASCADE,
        FOREIGN KEY (scope, activity_id) REFERENCES board_activities(scope, id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_updated ON board_tasks(scope, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_project ON board_tasks(scope, project_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_activity ON board_tasks(scope, activity_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_status ON board_tasks(scope, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_assignee ON board_tasks(scope, assignee_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS board_task_lists (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        owner_id TEXT NOT NULL,
        ordering INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (scope, id)
      );

      CREATE INDEX IF NOT EXISTS idx_board_task_lists_scope_owner ON board_task_lists(scope, owner_id, ordering ASC, updated_at DESC);

      CREATE TABLE IF NOT EXISTS board_task_relevant_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        task_id TEXT NOT NULL,
        link_type TEXT NOT NULL,
        path TEXT,
        kind TEXT,
        source TEXT,
        run_id TEXT,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (scope, task_id) REFERENCES board_tasks(scope, id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_board_task_links_scope_task ON board_task_relevant_links(scope, task_id, position);

      CREATE TABLE IF NOT EXISTS board_task_execution_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        task_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        state TEXT NOT NULL,
        trigger_type TEXT,
        idempotency_key TEXT,
        requested_at TEXT,
        requested_by TEXT,
        runtime_mode TEXT,
        agent_id TEXT,
        workflow_id TEXT,
        scheduler_job_id TEXT,
        scheduler_run_id TEXT,
        output_root TEXT,
        instruction_snapshot TEXT,
        started_at TEXT,
        completed_at TEXT,
        result_summary TEXT,
        failure_summary TEXT,
        task_version INTEGER,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (scope, task_id) REFERENCES board_tasks(scope, id) ON DELETE CASCADE,
        UNIQUE (scope, task_id, attempt_id),
        UNIQUE (scope, task_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_board_attempts_scope_task ON board_task_execution_attempts(scope, task_id, position);
      CREATE INDEX IF NOT EXISTS idx_board_attempts_scope_task_state ON board_task_execution_attempts(scope, task_id, state);
      CREATE INDEX IF NOT EXISTS idx_board_attempts_scope_scheduler_run ON board_task_execution_attempts(scope, scheduler_run_id);

      CREATE TABLE IF NOT EXISTS board_task_execution_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        task_id TEXT NOT NULL,
        attempt_id TEXT,
        state TEXT NOT NULL,
        summary TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (scope, task_id) REFERENCES board_tasks(scope, id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_board_exec_updates_scope_task ON board_task_execution_updates(scope, task_id, position);

      CREATE TABLE IF NOT EXISTS board_task_execution_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        project_id TEXT,
        task_id TEXT NOT NULL,
        attempt_id TEXT,
        artifact_id TEXT,
        path TEXT NOT NULL,
        storage_ref TEXT,
        content_type TEXT,
        size_bytes INTEGER,
        hash_sha256 TEXT,
        retention_class TEXT NOT NULL DEFAULT 'task_attempt',
        created_by TEXT,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by TEXT,
        deleted_reason TEXT,
        delete_audit_event_id TEXT,
        FOREIGN KEY (scope, task_id) REFERENCES board_tasks(scope, id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_board_exec_artifacts_scope_task ON board_task_execution_artifacts(scope, task_id, position);

      CREATE TABLE IF NOT EXISTS board_artifact_access_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        scope TEXT,
        project_id TEXT,
        task_id TEXT,
        attempt_id TEXT,
        artifact_id TEXT,
        artifact_reference TEXT,
        result TEXT NOT NULL,
        reason_code TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_board_artifact_access_audit_time ON board_artifact_access_audit(timestamp DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_board_artifact_access_audit_artifact ON board_artifact_access_audit(artifact_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS board_lifecycle_events (
        event_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        project_id TEXT,
        action TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        old_version INTEGER,
        new_version INTEGER,
        result TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_board_events_scope_project_time ON board_lifecycle_events(scope, project_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_board_events_scope_entity_time ON board_lifecycle_events(scope, entity_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS board_activity_projection (
        event_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        project_id TEXT,
        entity_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        result TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES board_lifecycle_events(event_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_board_activity_scope_project_time ON board_activity_projection(scope, project_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS board_audit_projection (
        event_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        project_id TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        old_version INTEGER,
        new_version INTEGER,
        result TEXT NOT NULL,
        details_json TEXT,
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES board_lifecycle_events(event_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_board_audit_scope_project_time ON board_audit_projection(scope, project_id, timestamp DESC);
    `,
  },
  {
    version: 4102,
    name: 'board_compat_columns_v1',
    apply(db) {
      ensureTableColumns(db, 'board_task_execution_artifacts', {
        project_id: 'TEXT',
        artifact_id: 'TEXT',
        storage_ref: 'TEXT',
        content_type: 'TEXT',
        size_bytes: 'INTEGER',
        hash_sha256: 'TEXT',
        retention_class: "TEXT NOT NULL DEFAULT 'task_attempt'",
        created_by: 'TEXT',
        deleted_at: 'TEXT',
        deleted_by: 'TEXT',
        deleted_reason: 'TEXT',
        delete_audit_event_id: 'TEXT',
      });
      ensureTableColumns(db, 'board_tasks', {
        work_type: "TEXT NOT NULL DEFAULT 'feature'",
        component_tags_json: "TEXT NOT NULL DEFAULT '[]'",
        sprint: 'TEXT',
        story_points: 'INTEGER',
        completion_percent: 'INTEGER NOT NULL DEFAULT 0',
        dependencies_json: "TEXT NOT NULL DEFAULT '[]'",
        external_links_json: "TEXT NOT NULL DEFAULT '[]'",
        custom_fields_json: "TEXT NOT NULL DEFAULT '{}'",
      });
    },
  },
  {
    version: 4103,
    name: 'board_artifact_indexes_v1',
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_board_exec_artifacts_artifact_id ON board_task_execution_artifacts(artifact_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_board_exec_artifacts_ref ON board_task_execution_artifacts(scope, task_id, attempt_id, path);
      CREATE INDEX IF NOT EXISTS idx_board_exec_artifacts_scope_attempt ON board_task_execution_artifacts(scope, task_id, attempt_id, position);
    `,
  },
  {
    version: 4104,
    name: 'board_activities_phase1',
    sql: `
      CREATE TABLE IF NOT EXISTS board_activities (
        scope TEXT NOT NULL,
        id TEXT NOT NULL,
        schema_version TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        visibility TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        custom_fields_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (scope, id)
      );
      CREATE INDEX IF NOT EXISTS idx_board_activities_scope_updated ON board_activities(scope, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_activities_scope_status ON board_activities(scope, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_board_activities_scope_visibility ON board_activities(scope, visibility, updated_at DESC);
    `,
    apply(db) {
      ensureBoardActivitiesTable(db);
      ensureBoardTasksNullableProjectAndActivity(db);
      ensureTableColumns(db, 'board_tasks', {
        activity_id: 'TEXT',
      });
      ensureBoardTasksActivityIndex(db);
    },
  },
  {
    version: 4105,
    name: 'board_task_lists_private_v1',
    apply(db) {
      ensureTableColumns(db, 'board_tasks', {
        task_list_id: 'TEXT',
      });
      db.exec(`
        CREATE TABLE IF NOT EXISTS board_task_lists (
          scope TEXT NOT NULL,
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          owner_id TEXT NOT NULL,
          ordering INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          created_by TEXT,
          updated_at TEXT NOT NULL,
          updated_by TEXT,
          PRIMARY KEY (scope, id)
        );
        CREATE INDEX IF NOT EXISTS idx_board_task_lists_scope_owner ON board_task_lists(scope, owner_id, ordering ASC, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_task_list ON board_tasks(scope, task_list_id, updated_at DESC);
      `);
    },
  },
];

function nowIso() {
  return new Date().toISOString();
}

function isPathWithin(parentAbs, targetAbs) {
  const rel = path.relative(parentAbs, targetAbs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function looksLikeConflictCopy(fileName, id) {
  if (!fileName.endsWith('.json')) return false;
  if (fileName === `${id}.json`) return false;
  if (!fileName.startsWith(id)) return false;
  const lower = fileName.toLowerCase();
  return lower.includes('conflict')
    || lower.includes('copy')
    || lower.includes('dupe')
    || lower.includes('variant')
    || lower.includes('kopia')
    || lower.includes('kopie')
    || lower.includes('copia')
    || lower.includes('clone')
    || lower.includes('(');
}

function hasAmbiguousNameHints(fileName) {
  const lower = String(fileName || '').toLowerCase();
  return lower.includes('conflict')
    || lower.includes('copy')
    || lower.includes('dupe')
    || lower.includes('variant')
    || lower.includes('kopia')
    || lower.includes('kopie')
    || lower.includes('copia')
    || lower.includes('konflikt')
    || lower.includes('複製')
    || lower.includes('копия')
    || lower.includes('(');
}

function normalizeRoot(absPath) {
  if (!absPath) return null;
  return path.resolve(String(absPath));
}

function normalizeIsoDateOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseJsonSafe(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function defaultRuntimeRootFallback() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'steadymade-ai-os');
  }
  if (process.platform === 'win32') {
    const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(appData, 'steadymade-ai-os');
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'steadymade-ai-os');
}

function stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function semanticHash(items) {
  const hash = createHash('sha256');
  for (const item of [...items].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))) {
    hash.update(stableStringify(item));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function sortByUpdatedDesc(items) {
  return [...items].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

function toJson(value) {
  return JSON.stringify(value ?? null);
}

function fromJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  return parseJsonSafe(value, fallback);
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
  }
}

function ensureTableColumns(db, tableName, columnSqlMap) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  if (!tableExists?.name) return;
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const existing = new Set(rows.map((row) => String(row.name || '')));
  for (const [column, sql] of Object.entries(columnSqlMap || {})) {
    if (existing.has(column)) continue;
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column} ${sql}`);
  }
}

function ensureBoardActivitiesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_activities (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      schema_version TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      visibility TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      custom_fields_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (scope, id)
    );
    CREATE INDEX IF NOT EXISTS idx_board_activities_scope_updated ON board_activities(scope, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_board_activities_scope_status ON board_activities(scope, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_board_activities_scope_visibility ON board_activities(scope, visibility, updated_at DESC);
  `);
}

function ensureBoardTasksActivityIndex(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get('board_tasks');
  if (!tableExists?.name) return;
  const cols = db.prepare('PRAGMA table_info(board_tasks)').all();
  const hasActivityId = cols.some((col) => String(col.name) === 'activity_id');
  if (!hasActivityId) return;
  db.exec('CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_activity ON board_tasks(scope, activity_id, updated_at DESC);');
}

function ensureBoardTasksNullableProjectAndActivity(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get('board_tasks');
  if (!tableExists?.name) return;
  const cols = db.prepare('PRAGMA table_info(board_tasks)').all();
  const projectCol = cols.find((col) => String(col.name) === 'project_id');
  const hasActivityId = cols.some((col) => String(col.name) === 'activity_id');
  const needsRebuild = Number(projectCol?.notnull || 0) === 1 || !hasActivityId;
  if (!needsRebuild) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS board_tasks_v2 (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      schema_version TEXT,
      project_id TEXT,
      activity_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      work_type TEXT NOT NULL DEFAULT 'feature',
      assignee_type TEXT NOT NULL,
      assignee_id TEXT,
      human_assignee_label TEXT,
      task_list_id TEXT,
      workflow_id TEXT,
      subtasks_json TEXT NOT NULL,
      component_tags_json TEXT NOT NULL DEFAULT '[]',
      sprint TEXT,
      story_points INTEGER,
      completion_percent INTEGER NOT NULL DEFAULT 0,
      dependencies_json TEXT NOT NULL DEFAULT '[]',
      external_links_json TEXT NOT NULL DEFAULT '[]',
      custom_fields_json TEXT NOT NULL DEFAULT '{}',
      due_at TEXT,
      review_json TEXT NOT NULL,
      blocked_json TEXT NOT NULL,
      visibility TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (scope, id),
      FOREIGN KEY (scope, project_id) REFERENCES board_projects(scope, id) ON DELETE CASCADE,
      FOREIGN KEY (scope, activity_id) REFERENCES board_activities(scope, id) ON DELETE CASCADE
    );
  `);

  const selectCols = cols.map((col) => String(col.name));
  const hasCol = (name) => selectCols.includes(name);
  const activityExpr = hasCol('activity_id') ? 'activity_id' : 'NULL AS activity_id';
  const taskListExpr = hasCol('task_list_id') ? 'task_list_id' : 'NULL AS task_list_id';
  db.exec(`
    INSERT INTO board_tasks_v2 (
      scope, id, schema_version, project_id, activity_id, title, description, status, priority,
      work_type, assignee_type, assignee_id, human_assignee_label, task_list_id, workflow_id, subtasks_json,
      component_tags_json, sprint, story_points, completion_percent, dependencies_json, external_links_json, custom_fields_json, due_at,
      review_json, blocked_json, visibility, version, created_at, created_by, updated_at, updated_by
    )
    SELECT
      scope,
      id,
      schema_version,
      project_id,
      ${activityExpr},
      title,
      description,
      status,
      priority,
      work_type,
      assignee_type,
      assignee_id,
      human_assignee_label,
      ${taskListExpr},
      workflow_id,
      subtasks_json,
      component_tags_json,
      sprint,
      story_points,
      completion_percent,
      dependencies_json,
      external_links_json,
      custom_fields_json,
      due_at,
      review_json,
      blocked_json,
      visibility,
      version,
      created_at,
      created_by,
      updated_at,
      updated_by
    FROM board_tasks;
  `);
  db.exec('DROP TABLE board_tasks;');
  db.exec('ALTER TABLE board_tasks_v2 RENAME TO board_tasks;');
  db.exec('CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_updated ON board_tasks(scope, updated_at DESC);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_project ON board_tasks(scope, project_id, updated_at DESC);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_activity ON board_tasks(scope, activity_id, updated_at DESC);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_status ON board_tasks(scope, status, updated_at DESC);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_assignee ON board_tasks(scope, assignee_id, updated_at DESC);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_board_tasks_scope_task_list ON board_tasks(scope, task_list_id, updated_at DESC);');
}

function applyBoardMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS board_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    db.prepare('SELECT version FROM board_schema_migrations ORDER BY version ASC').all().map((row) => Number(row.version)),
  );
  for (const migration of [...BOARD_MIGRATIONS].sort((a, b) => Number(a.version) - Number(b.version))) {
    if (applied.has(Number(migration.version))) continue;
    if (typeof migration.apply === 'function') migration.apply(db);
    if (migration.sql && String(migration.sql).trim()) db.exec(migration.sql);
    db.prepare('INSERT INTO board_schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(Number(migration.version), String(migration.name || `migration_${migration.version}`), nowIso());
  }
}

function normalizeTaskForPersistence(task) {
  const execution = task?.execution && typeof task.execution === 'object' ? task.execution : {};
  return {
    ...task,
    work_type: task?.work_type ? String(task.work_type) : 'feature',
    linked_paths: Array.isArray(task?.linked_paths) ? task.linked_paths : [],
    linked_runs: Array.isArray(task?.linked_runs) ? task.linked_runs : [],
    subtasks: Array.isArray(task?.subtasks) ? task.subtasks : [],
    component_tags: Array.isArray(task?.component_tags) ? task.component_tags : [],
    sprint: task?.sprint === null || task?.sprint === undefined || task?.sprint === '' ? null : String(task.sprint),
    story_points: Number.isInteger(task?.story_points) ? task.story_points : null,
    completion_percent: Number.isInteger(task?.completion_percent) ? task.completion_percent : 0,
    dependencies: Array.isArray(task?.dependencies) ? task.dependencies : [],
    external_links: Array.isArray(task?.external_links) ? task.external_links : [],
    custom_fields: task?.custom_fields && typeof task.custom_fields === 'object' && !Array.isArray(task.custom_fields)
      ? task.custom_fields
      : {},
    task_list_id: task?.task_list_id === null || task?.task_list_id === undefined || task?.task_list_id === ''
      ? null
      : String(task.task_list_id),
    execution: {
      ...execution,
      attempts: Array.isArray(execution.attempts) ? execution.attempts : [],
      execution_updates: Array.isArray(execution.execution_updates) ? execution.execution_updates : [],
      artifact_paths: Array.isArray(execution.artifact_paths) ? execution.artifact_paths : [],
    },
  };
}

function normalizeActivityForPersistence(activity) {
  return {
    ...activity,
    tags: Array.isArray(activity?.tags) ? activity.tags : [],
    custom_fields: activity?.custom_fields && typeof activity.custom_fields === 'object' && !Array.isArray(activity.custom_fields)
      ? activity.custom_fields
      : {},
  };
}

function asEventRow(scope, event) {
  const timestamp = normalizeIsoDateOrNull(event?.timestamp) || nowIso();
  const details = event?.details === undefined ? null : event.details;
  return {
    event_id: String(event?.event_id || randomUUID()),
    scope,
    timestamp,
    entity_type: String(event?.entity_type || 'unknown'),
    entity_id: String(event?.entity_id || ''),
    project_id: event?.project_id ? String(event.project_id) : null,
    action: String(event?.action || 'unknown'),
    actor_id: String(event?.actor_id || 'unknown'),
    old_version: Number.isInteger(event?.old_version) ? event.old_version : null,
    new_version: Number.isInteger(event?.new_version) ? event.new_version : null,
    result: String(event?.result || 'ok'),
    details_json: details === null ? null : toJson(details),
    created_at: nowIso(),
  };
}

function rowToEvent(row) {
  if (!row) return null;
  const details = fromJson(row.details_json, null);
  return {
    event_id: row.event_id,
    timestamp: row.timestamp,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    project_id: row.project_id,
    action: row.action,
    actor_id: row.actor_id,
    old_version: row.old_version === null || row.old_version === undefined ? null : Number(row.old_version),
    new_version: row.new_version === null || row.new_version === undefined ? null : Number(row.new_version),
    result: row.result,
    ...(details !== null ? { details } : {}),
  };
}

function projectRowToEntity(row) {
  if (!row) return null;
  return {
    id: row.id,
    schema_version: row.schema_version || '1.0',
    name: row.name,
    status: row.status,
    visibility: row.visibility,
    owner_id: row.owner_id,
    description: row.description,
    tags: fromJson(row.tags_json, []) || [],
    review: fromJson(row.review_json, {
      state: 'none',
      required: false,
      reviewers: [],
      decision: null,
      decided_at: null,
      decided_by: null,
    }),
    blocked: fromJson(row.blocked_json, { is_blocked: false, reason: '', since: null }),
    linked_paths: fromJson(row.linked_paths_json, []) || [],
    linked_runs: fromJson(row.linked_runs_json, []) || [],
    scope_migration: fromJson(row.scope_migration_json, null),
    version: Number(row.version) || 1,
    created_at: row.created_at,
    created_by: row.created_by || null,
    updated_at: row.updated_at,
    updated_by: row.updated_by || null,
  };
}

function activityRowToEntity(row) {
  if (!row) return null;
  return {
    id: row.id,
    schema_version: row.schema_version || '1.0',
    name: row.name,
    description: row.description,
    status: row.status,
    owner_id: row.owner_id,
    visibility: row.visibility,
    tags: fromJson(row.tags_json, []) || [],
    custom_fields: fromJson(row.custom_fields_json, {}) || {},
    version: Number(row.version) || 1,
    created_at: row.created_at,
    created_by: row.created_by || null,
    updated_at: row.updated_at,
    updated_by: row.updated_by || null,
  };
}

function taskListRowToEntity(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    owner_id: row.owner_id,
    ordering: Number.isFinite(Number(row.ordering)) ? Number(row.ordering) : 0,
    version: Number(row.version) || 1,
    created_at: row.created_at,
    created_by: row.created_by || null,
    updated_at: row.updated_at,
    updated_by: row.updated_by || null,
  };
}

function taskRowToEntity(row, related) {
  if (!row) return null;
  const activeArtifacts = (related?.artifacts || []).filter((a) => !a.deleted_at);
  const attempts = (related?.attempts || []).map((a) => {
    const attemptArtifacts = activeArtifacts
      .filter((p) => p.attempt_id === a.attempt_id)
      .sort((x, y) => Number(x.position || 0) - Number(y.position || 0));
    return {
    attempt_id: a.attempt_id,
    state: a.state,
    trigger: a.trigger_type,
    idempotency_key: a.idempotency_key,
    requested_at: a.requested_at,
    requested_by: a.requested_by,
    runtime_mode: a.runtime_mode,
    agent_id: a.agent_id,
    workflow_id: a.workflow_id,
    scheduler_job_id: a.scheduler_job_id,
    scheduler_run_id: a.scheduler_run_id,
    output_root: a.output_root,
    instruction_snapshot: a.instruction_snapshot,
    started_at: a.started_at,
    completed_at: a.completed_at,
    result_summary: a.result_summary,
    failure_summary: a.failure_summary,
    artifact_paths: attemptArtifacts.map((p) => p.path),
    artifacts: attemptArtifacts.map((p) => ({
      artifact_id: p.artifact_id || null,
      path: p.path,
      storage_ref: p.storage_ref || p.path,
      content_type: p.content_type || null,
      size_bytes: p.size_bytes === null || p.size_bytes === undefined ? null : Number(p.size_bytes),
      hash_sha256: p.hash_sha256 || null,
      retention_class: p.retention_class || 'task_attempt',
      created_at: p.created_at,
      deleted_at: p.deleted_at || null,
    })),
    task_version: a.task_version === null || a.task_version === undefined ? null : Number(a.task_version),
    };
  });
  const latestAttempt = attempts.length ? attempts[attempts.length - 1] : null;
  const updates = (related?.updates || []).map((u) => ({
    timestamp: u.timestamp,
    attempt_id: u.attempt_id,
    state: u.state,
    summary: u.summary,
    source: u.source,
  }));
  const currentArtifacts = latestAttempt
    ? activeArtifacts.filter((a) => a.attempt_id === latestAttempt.attempt_id)
    : [];
  const currentArtifactPaths = latestAttempt
    ? currentArtifacts.map((a) => a.path)
    : [];

  return {
    id: row.id,
    schema_version: row.schema_version || '1.0',
    project_id: row.project_id,
    activity_id: row.activity_id || null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    work_type: row.work_type || 'feature',
    assignee_type: row.assignee_type,
    assignee_id: row.assignee_id,
    human_assignee_label: row.human_assignee_label,
    task_list_id: row.task_list_id || null,
    workflow_id: row.workflow_id,
    subtasks: fromJson(row.subtasks_json, []) || [],
    component_tags: fromJson(row.component_tags_json, []) || [],
    sprint: row.sprint || null,
    story_points: row.story_points === null || row.story_points === undefined ? null : Number(row.story_points),
    completion_percent: row.completion_percent === null || row.completion_percent === undefined ? 0 : Number(row.completion_percent),
    dependencies: fromJson(row.dependencies_json, []) || [],
    external_links: fromJson(row.external_links_json, []) || [],
    custom_fields: fromJson(row.custom_fields_json, {}) || {},
    due_at: row.due_at,
    review: fromJson(row.review_json, {
      state: 'none',
      required: false,
      reviewers: [],
      decision: null,
      decided_at: null,
      decided_by: null,
    }),
    blocked: fromJson(row.blocked_json, { is_blocked: false, reason: '', since: null }),
    visibility: row.visibility,
    linked_paths: (related?.links || []).filter((l) => l.link_type === 'path').map((l) => ({ path: l.path, kind: l.kind || 'file' })),
    linked_runs: (related?.links || []).filter((l) => l.link_type === 'run').map((l) => ({ source: l.source, id: l.run_id })),
    execution: {
      attempt_id: latestAttempt?.attempt_id || null,
      state: latestAttempt?.state || 'none',
      trigger: latestAttempt?.trigger || null,
      idempotency_key: latestAttempt?.idempotency_key || null,
      requested_at: latestAttempt?.requested_at || null,
      requested_by: latestAttempt?.requested_by || null,
      runtime_mode: latestAttempt?.runtime_mode || null,
      agent_id: latestAttempt?.agent_id || null,
      workflow_id: latestAttempt?.workflow_id || null,
      scheduler_job_id: latestAttempt?.scheduler_job_id || null,
      scheduler_run_id: latestAttempt?.scheduler_run_id || null,
      output_root: latestAttempt?.output_root || null,
      instruction_snapshot: latestAttempt?.instruction_snapshot || null,
      started_at: latestAttempt?.started_at || null,
      completed_at: latestAttempt?.completed_at || null,
      result_summary: latestAttempt?.result_summary || null,
      failure_summary: latestAttempt?.failure_summary || null,
      artifact_paths: currentArtifactPaths,
      artifacts: currentArtifacts.map((a) => ({
        artifact_id: a.artifact_id || null,
        path: a.path,
        storage_ref: a.storage_ref || a.path,
        content_type: a.content_type || null,
        size_bytes: a.size_bytes === null || a.size_bytes === undefined ? null : Number(a.size_bytes),
        hash_sha256: a.hash_sha256 || null,
        retention_class: a.retention_class || 'task_attempt',
        created_at: a.created_at,
        deleted_at: a.deleted_at || null,
      })),
      execution_updates: updates,
      attempts,
    },
    version: Number(row.version) || 1,
    created_at: row.created_at,
    created_by: row.created_by || null,
    updated_at: row.updated_at,
    updated_by: row.updated_by || null,
  };
}

function assertLegacyEntityShape(entity, expectedType, filePath) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
    const err = new Error(`legacy board import failed: invalid ${expectedType} entity shape in ${filePath}`);
    err.code = 'board_legacy_malformed';
    err.diagnostic = { filePath, expectedType, reason: 'invalid_shape' };
    throw err;
  }
  const id = String(entity.id || '').trim();
  if (!id || !/^[a-z0-9_]{3,80}$/.test(id)) {
    const err = new Error(`legacy board import failed: invalid ${expectedType}.id in ${filePath}`);
    err.code = 'board_legacy_malformed';
    err.diagnostic = { filePath, expectedType, reason: 'invalid_id' };
    throw err;
  }
  if (expectedType === 'task') {
    const projectId = entity.project_id === null || entity.project_id === undefined ? '' : String(entity.project_id).trim();
    const activityId = entity.activity_id === null || entity.activity_id === undefined ? '' : String(entity.activity_id).trim();
    if (projectId && !/^[a-z0-9_]{3,80}$/.test(projectId)) {
      const err = new Error(`legacy board import failed: invalid task.project_id in ${filePath}`);
      err.code = 'board_legacy_malformed';
      err.diagnostic = { filePath, expectedType, reason: 'invalid_project_id' };
      throw err;
    }
    if (activityId && !/^[a-z0-9_]{3,80}$/.test(activityId)) {
      const err = new Error(`legacy board import failed: invalid task.activity_id in ${filePath}`);
      err.code = 'board_legacy_malformed';
      err.diagnostic = { filePath, expectedType, reason: 'invalid_activity_id' };
      throw err;
    }
  }
}

function readLegacyJsonEntityStrict(filePath, expectedType) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const e = new Error(`legacy board import failed: cannot read ${filePath}: ${err?.message || err}`);
    e.code = 'board_legacy_malformed';
    e.diagnostic = { filePath, expectedType, reason: 'read_failed' };
    throw e;
  }
  let entity;
  try {
    entity = JSON.parse(raw);
  } catch (err) {
    const e = new Error(`legacy board import failed: malformed JSON in ${filePath}: ${err?.message || err}`);
    e.code = 'board_legacy_malformed';
    e.diagnostic = { filePath, expectedType, reason: 'malformed_json' };
    throw e;
  }
  assertLegacyEntityShape(entity, expectedType, filePath);
  return entity;
}

async function atomicWriteJson(file, value) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  const data = JSON.stringify(value, null, 2);
  const fh = await fsp.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

function atomicWriteJsonSync(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  const data = JSON.stringify(value, null, 2);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, data, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

async function writeJsonlAtomic(file, rows) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  const fh = await fsp.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(text ? `${text}\n` : '', 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

export function createBoardStorage({ rootDir, resolveRoots = null, runtimeRootOverride = null }) {
  const defaultPrivateRoot = path.join(rootDir, 'project-board');
  const legacyRoot = defaultPrivateRoot;
  const locks = new Map();
  const teamDivergence = { detected: false, reason: '', files: [] };
  let privateCompatInitialized = false;

  function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queue = prev.finally(() => current);
    locks.set(key, queue);
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release();
        if (locks.get(key) === queue) locks.delete(key);
      }
    });
  }

  function currentRoots() {
    const resolved = typeof resolveRoots === 'function'
      ? resolveRoots()
      : {
        privateRoot: defaultPrivateRoot,
        teamRoot: null,
        sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
        personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
      };
    return {
      privateRoot: normalizeRoot(resolved?.privateRoot || defaultPrivateRoot),
      teamRoot: normalizeRoot(resolved?.teamRoot || null),
      sharedKnowledgeRoot: normalizeRoot(resolved?.sharedKnowledgeRoot || null),
      personalKnowledgeRoot: normalizeRoot(resolved?.personalKnowledgeRoot || null),
    };
  }

  function assertRootSafety(roots) {
    const privateRoot = roots.privateRoot;
    const teamRoot = roots.teamRoot;
    if (!privateRoot) {
      throw boardError(503, 'board_root_unavailable', 'private board root is not configured');
    }
    const all = [
      ['private', privateRoot],
      ['team', teamRoot],
      ['sharedKnowledge', roots.sharedKnowledgeRoot],
      ['personalKnowledge', roots.personalKnowledgeRoot],
    ].filter(([, p]) => p);

    for (const [label, abs] of all) {
      if (label === 'private' && abs && !fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true });
      const lst = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (!lst) {
        if (label === 'team' || label === 'sharedKnowledge' || label === 'personalKnowledge') continue;
        throw boardError(503, 'board_root_unavailable', `${label} root is unavailable`, { path: abs });
      }
      if (lst.isSymbolicLink()) {
        throw boardError(422, 'board_root_unsafe', `${label} root must not be a symlink`, { path: abs });
      }
      if (!lst.isDirectory()) {
        throw boardError(422, 'board_root_unsafe', `${label} root is not a directory`, { path: abs });
      }
    }

    const overlapPairs = [
      ['private', privateRoot, 'team', teamRoot],
      ['private', privateRoot, 'sharedKnowledge', roots.sharedKnowledgeRoot],
      ['private', privateRoot, 'personalKnowledge', roots.personalKnowledgeRoot],
      ['team', teamRoot, 'sharedKnowledge', roots.sharedKnowledgeRoot],
      ['team', teamRoot, 'personalKnowledge', roots.personalKnowledgeRoot],
    ].filter(([, a, , b]) => a && b);

    for (const [aLabel, a, bLabel, b] of overlapPairs) {
      if (isPathWithin(a, b) || isPathWithin(b, a)) {
        throw boardError(422, 'board_root_unsafe', `${aLabel} root overlaps with ${bLabel} root`, { left: a, right: b });
      }
    }
  }

  function scopeRoot(scope) {
    const roots = currentRoots();
    assertRootSafety(roots);
    if (!SCOPES.includes(scope)) throw boardError(422, 'validation_error', `unknown scope: ${scope}`);
    if (scope === 'team') {
      if (!roots.teamRoot) throw boardError(503, 'team_root_unconfigured', 'team board root is not configured');
      const exists = fs.existsSync(roots.teamRoot);
      if (!exists) throw boardError(503, 'team_root_unavailable', 'team board root is unavailable', { path: roots.teamRoot });
      return roots.teamRoot;
    }
    if (!fs.existsSync(roots.privateRoot)) fs.mkdirSync(roots.privateRoot, { recursive: true });
    return roots.privateRoot;
  }

  function scopeDirs(scope) {
    if (scope === 'team') {
      const dirs = {
        boardRoot: resolveTeamRelativePathSafe('', { ensureDir: true }),
        projectsDir: resolveTeamRelativePathSafe('projects', { ensureDir: true }),
        activitiesDir: resolveTeamRelativePathSafe('activities', { ensureDir: true }),
        tasksDir: resolveTeamRelativePathSafe('tasks', { ensureDir: true }),
        activityDir: resolveTeamRelativePathSafe('activity', { ensureDir: true }),
        auditDir: resolveTeamRelativePathSafe('audit', { ensureDir: true }),
        compatDir: resolveTeamRelativePathSafe('sqlite-compat', { ensureDir: true }),
      };
      return dirs;
    }
    const boardRoot = scopeRoot(scope);
    const dirs = {
      boardRoot,
      projectsDir: path.join(boardRoot, 'projects'),
      activitiesDir: path.join(boardRoot, 'activities'),
      tasksDir: path.join(boardRoot, 'tasks'),
      activityDir: path.join(boardRoot, 'activity'),
      auditDir: path.join(boardRoot, 'audit'),
      compatDir: path.join(boardRoot, 'sqlite-compat'),
    };
    fs.mkdirSync(dirs.projectsDir, { recursive: true });
    fs.mkdirSync(dirs.activitiesDir, { recursive: true });
    fs.mkdirSync(dirs.tasksDir, { recursive: true });
    fs.mkdirSync(dirs.activityDir, { recursive: true });
    fs.mkdirSync(dirs.auditDir, { recursive: true });
    fs.mkdirSync(dirs.compatDir, { recursive: true });
    return dirs;
  }

  function throwTeamDivergence(reason, files = [], extra = {}) {
    teamDivergence.detected = true;
    teamDivergence.reason = String(reason || 'detected_divergence');
    teamDivergence.files = [...new Set((files || []).map((f) => String(f || '')))].filter(Boolean);
    throw boardError(503, 'team_scope_read_only', 'team scope is read-only due to detected storage divergence', {
      reason: teamDivergence.reason,
      files: teamDivergence.files,
      ...extra,
    });
  }

  function assertNoKnownTeamDivergence() {
    if (teamDivergence.detected) {
      throw boardError(503, 'team_scope_read_only', 'team scope is read-only due to detected storage divergence', {
        reason: teamDivergence.reason,
        files: teamDivergence.files,
      });
    }
  }

  function detectTeamDivergenceSync(dir, id) {
    assertNoKnownTeamDivergence();
    const names = fs.readdirSync(dir, { withFileTypes: false });
    const conflicts = names.filter((name) => looksLikeConflictCopy(name, id));
    if (conflicts.length) {
      throwTeamDivergence('conflict_variant_files_detected', conflicts);
    }

    const idToFiles = new Map();
    for (const name of names) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      if (hasAmbiguousNameHints(name)) {
        throwTeamDivergence('conflict_variant_files_detected', [name]);
      }
      const abs = path.join(dir, name);
      const lst = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (!lst) continue;
      if (lst.isSymbolicLink()) {
        throwTeamDivergence('unsafe_symlink_segment_detected', [name], { path: abs });
      }
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
      } catch {
        throwTeamDivergence('malformed_json_detected', [name]);
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throwTeamDivergence('invalid_entity_shape_detected', [name]);
      }
      const entityId = String(parsed.id || '').trim();
      if (!entityId) throwTeamDivergence('invalid_entity_id_detected', [name]);
      const expectedName = `${entityId}.json`;
      if (name !== expectedName) {
        throwTeamDivergence('unexpected_entity_ambiguity', [name], { expected: expectedName, entity_id: entityId });
      }
      const filesForId = idToFiles.get(entityId) || [];
      filesForId.push(name);
      idToFiles.set(entityId, filesForId);
      if (filesForId.length > 1) {
        throwTeamDivergence('duplicate_entity_id_detected', filesForId, { entity_id: entityId });
      }
    }
  }

  function detectTeamDivergenceForReadsSync(dir) {
    assertNoKnownTeamDivergence();
    const names = fs.readdirSync(dir, { withFileTypes: false });
    const idToFiles = new Map();
    for (const name of names) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      if (hasAmbiguousNameHints(name)) throwTeamDivergence('conflict_variant_files_detected', [name]);
      const abs = path.join(dir, name);
      const lst = fs.lstatSync(abs, { throwIfNoEntry: false });
      if (!lst) continue;
      if (lst.isSymbolicLink()) {
        throwTeamDivergence('unsafe_symlink_segment_detected', [name], { path: abs });
      }
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
      } catch {
        throwTeamDivergence('malformed_json_detected', [name]);
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throwTeamDivergence('invalid_entity_shape_detected', [name]);
      }
      const entityId = String(parsed.id || '').trim();
      if (!entityId) throwTeamDivergence('invalid_entity_id_detected', [name]);
      const expectedName = `${entityId}.json`;
      if (name !== expectedName) {
        throwTeamDivergence('unexpected_entity_ambiguity', [name], { expected: expectedName, entity_id: entityId });
      }
      const filesForId = idToFiles.get(entityId) || [];
      filesForId.push(name);
      idToFiles.set(entityId, filesForId);
      if (filesForId.length > 1) {
        throwTeamDivergence('duplicate_entity_id_detected', filesForId, { entity_id: entityId });
      }
    }
  }

  function resolveTeamRelativePathSafe(relativePath, { ensureDir = false } = {}) {
    assertNoKnownTeamDivergence();
    const teamRoot = scopeRoot('team');
    const rawRelative = String(relativePath || '').trim();
    const normalized = rawRelative
      ? path.normalize(rawRelative)
      : '';
    if (normalized && path.isAbsolute(normalized)) {
      throwTeamDivergence('unsafe_team_path_absolute', [normalized]);
    }

    let realTeamRoot;
    try {
      realTeamRoot = fs.realpathSync(teamRoot);
    } catch {
      throwTeamDivergence('unsafe_team_path_root_unresolved', [teamRoot]);
    }

    if (!normalized || normalized === '.') {
      return realTeamRoot;
    }

    const segments = normalized.split(path.sep).filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throwTeamDivergence('unsafe_team_path_traversal', [normalized]);
    }

    let cursor = realTeamRoot;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const candidate = path.join(cursor, segment);
      const lst = fs.lstatSync(candidate, { throwIfNoEntry: false });

      if (lst?.isSymbolicLink()) {
        throwTeamDivergence('unsafe_symlink_segment_detected', [normalized], { path: candidate });
      }

      if (lst) {
        if ((!isLast || ensureDir) && !lst.isDirectory()) {
          throwTeamDivergence('unsafe_team_path_not_directory', [normalized], { path: candidate });
        }
        const resolved = fs.realpathSync(candidate);
        if (!isPathWithin(realTeamRoot, resolved)) {
          throwTeamDivergence('unsafe_team_path_escaped_root', [normalized], {
            path: candidate,
            real_team_root: realTeamRoot,
            resolved,
          });
        }
        cursor = resolved;
        continue;
      }

      if (!isLast || ensureDir) {
        try {
          fs.mkdirSync(candidate, { recursive: false, mode: 0o700 });
        } catch (err) {
          if (err?.code !== 'EEXIST') {
            throwTeamDivergence('unsafe_team_path_create_failed', [normalized], {
              path: candidate,
              message: String(err?.message || err),
            });
          }
        }
        const created = fs.lstatSync(candidate, { throwIfNoEntry: false });
        if (!created || created.isSymbolicLink() || !created.isDirectory()) {
          throwTeamDivergence('unsafe_team_path_create_invalid', [normalized], { path: candidate });
        }
        const resolved = fs.realpathSync(candidate);
        if (!isPathWithin(realTeamRoot, resolved)) {
          throwTeamDivergence('unsafe_team_path_escaped_root', [normalized], {
            path: candidate,
            real_team_root: realTeamRoot,
            resolved,
          });
        }
        cursor = resolved;
        continue;
      }

      const unresolvedTarget = path.resolve(cursor, segment);
      if (!isPathWithin(realTeamRoot, unresolvedTarget)) {
        throwTeamDivergence('unsafe_team_path_escaped_root', [normalized], {
          path: unresolvedTarget,
          real_team_root: realTeamRoot,
        });
      }
      cursor = unresolvedTarget;
    }

    return cursor;
  }

  function privateCompatDirs() {
    const compatRoot = scopeDirs('private').compatDir;
    return {
      compatRoot,
      projectsDir: path.join(compatRoot, 'projects'),
      activitiesDir: path.join(compatRoot, 'activities'),
      tasksDir: path.join(compatRoot, 'tasks'),
      activityDir: path.join(compatRoot, 'activity'),
      auditDir: path.join(compatRoot, 'audit'),
    };
  }

  async function ensurePrivateCompatibilityInitialized() {
    if (privateCompatInitialized) return;
    await exportPrivateCompatibility();
    privateCompatInitialized = true;
  }

  async function appendJsonlRows(file, rows) {
    const payloadRows = Array.isArray(rows)
      ? rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
      : [];
    if (!payloadRows.length) return;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const text = payloadRows.map((row) => JSON.stringify(row)).join('\n');
    await fsp.appendFile(file, `${text}\n`, 'utf8');
  }

  async function applyPrivateCompatibilityDelta(delta = {}) {
    const dirs = privateCompatDirs();
    const writes = [];

    if (delta.project && delta.project.id) {
      writes.push(atomicWriteJson(path.join(dirs.projectsDir, `${delta.project.id}.json`), delta.project));
    }
    if (delta.activity && delta.activity.id) {
      writes.push(atomicWriteJson(path.join(dirs.activitiesDir, `${delta.activity.id}.json`), delta.activity));
    }
    if (delta.task && delta.task.id) {
      writes.push(atomicWriteJson(path.join(dirs.tasksDir, `${delta.task.id}.json`), delta.task));
    }
    if (delta.deleteProjectId) {
      writes.push(fsp.unlink(path.join(dirs.projectsDir, `${delta.deleteProjectId}.json`)).catch(() => {}));
    }
    if (delta.deleteActivityId) {
      writes.push(fsp.unlink(path.join(dirs.activitiesDir, `${delta.deleteActivityId}.json`)).catch(() => {}));
    }
    if (delta.deleteTaskId) {
      writes.push(fsp.unlink(path.join(dirs.tasksDir, `${delta.deleteTaskId}.json`)).catch(() => {}));
    }

    const day = new Date().toISOString().slice(0, 10);
    const activityEvents = Array.isArray(delta.activityEvents) ? delta.activityEvents : [];
    const auditEvents = Array.isArray(delta.auditEvents) ? delta.auditEvents : [];
    if (activityEvents.length) {
      writes.push(appendJsonlRows(path.join(dirs.activityDir, `${day}.jsonl`), activityEvents));
    }
    if (auditEvents.length) {
      writes.push(appendJsonlRows(path.join(dirs.auditDir, `${day}.jsonl`), auditEvents));
    }

    await Promise.all(writes);
  }

  function resolveScopeLogFile(scope, kind, dayStamp) {
    if (scope === 'team') {
      return resolveTeamRelativePathSafe(path.join(kind, `${dayStamp}.jsonl`));
    }
    return path.join(scopeDirs(scope)[`${kind}Dir`], `${dayStamp}.jsonl`);
  }

  function projectFile(scope, id) {
    if (scope === 'team') {
      return resolveTeamRelativePathSafe(path.join('projects', `${id}.json`));
    }
    return path.join(scopeDirs(scope).projectsDir, `${id}.json`);
  }

  function activityFile(scope, id) {
    if (scope === 'team') {
      return resolveTeamRelativePathSafe(path.join('activities', `${id}.json`));
    }
    return path.join(scopeDirs(scope).activitiesDir, `${id}.json`);
  }

  function taskFile(scope, id) {
    if (scope === 'team') {
      return resolveTeamRelativePathSafe(path.join('tasks', `${id}.json`));
    }
    return path.join(scopeDirs(scope).tasksDir, `${id}.json`);
  }

  function readEntitySync(file) {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  }

  function listEntitiesSync(dir) {
    const names = fs.readdirSync(dir, { withFileTypes: false });
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      out.push(readEntitySync(path.join(dir, name)));
    }
    return out;
  }

  const privateRoot = scopeRoot('private');
  let kernel;
  try {
    kernel = initializeStorageKernel({
      workspaceRoot: rootDir,
      component: BOARD_DB_COMPONENT,
      testRootOverride: runtimeRootOverride,
    });
  } catch (err) {
    if (runtimeRootOverride || err?.code !== 'unsafe_runtime_root') throw err;
    kernel = initializeStorageKernel({
      workspaceRoot: rootDir,
      component: BOARD_DB_COMPONENT,
      testRootOverride: defaultRuntimeRootFallback(),
    });
  }
  const privateDbPath = kernel.dbPath;
  const privateDbSnapshotPath = path.join(kernel.runtimeRoot, 'snapshots', `${BOARD_DB_COMPONENT}.snapshot.sqlite`);
  const db = kernel.db;

  db.exec('BEGIN EXCLUSIVE;');
  try {
    applyBoardMigrations(db);
    db.exec('COMMIT;');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
  }

  const quickCheck = databaseQuickCheck(db);
  if (!quickCheck.ok) {
    const err = new Error('private board sqlite quick_check failed');
    err.code = 'board_sqlite_integrity_failed';
    err.diagnostic = { details: quickCheck.details };
    throw err;
  }

  db.prepare(`
    INSERT INTO board_state (id, authority_mode, authority_marker, authority_activated_at, created_at, updated_at)
    VALUES (1, 'legacy_pending', NULL, NULL, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(nowIso(), nowIso());

  function appendImportLedger({ sourceName, status, sourceCount = 0, sourceHash = null, importedCount = 0, importedHash = null, reconciled = false, diagnostic = null }) {
    db.prepare(`
      INSERT INTO board_import_ledger (
        source_name, status, source_count, source_hash, imported_count, imported_hash, reconciled, diagnostic, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sourceName,
      status,
      Number(sourceCount) || 0,
      sourceHash,
      Number(importedCount) || 0,
      importedHash,
      reconciled ? 1 : 0,
      diagnostic ? JSON.stringify(diagnostic) : null,
      nowIso(),
    );
  }

  function insertEventTx(scope, event) {
    const row = asEventRow(scope, event);
    db.prepare(`
      INSERT INTO board_lifecycle_events (
        event_id, scope, timestamp, entity_type, entity_id, project_id, action, actor_id,
        old_version, new_version, result, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.event_id,
      row.scope,
      row.timestamp,
      row.entity_type,
      row.entity_id,
      row.project_id,
      row.action,
      row.actor_id,
      row.old_version,
      row.new_version,
      row.result,
      row.details_json,
      row.created_at,
    );
    db.prepare(`
      INSERT INTO board_activity_projection (
        event_id, scope, project_id, entity_id, timestamp, action, actor_id, result, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.event_id,
      row.scope,
      row.project_id,
      row.entity_id,
      row.timestamp,
      row.action,
      row.actor_id,
      row.result,
      row.details_json,
      row.created_at,
    );
    db.prepare(`
      INSERT INTO board_audit_projection (
        event_id, scope, project_id, entity_type, entity_id, action, actor_id,
        old_version, new_version, result, details_json, timestamp, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.event_id,
      row.scope,
      row.project_id,
      row.entity_type,
      row.entity_id,
      row.action,
      row.actor_id,
      row.old_version,
      row.new_version,
      row.result,
      row.details_json,
      row.timestamp,
      row.created_at,
    );
  }

  function persistProjectTx(scope, id, project, expectedVersion) {
    const existing = db.prepare('SELECT version FROM board_projects WHERE scope = ? AND id = ?').get(scope, id);
    if (Number.isInteger(expectedVersion)) {
      const current = existing ? Number(existing.version) : null;
      if (current === null || current !== expectedVersion) {
        throw boardError(409, 'conflict', 'Version mismatch', { expected: current, got: expectedVersion });
      }
    }
    db.prepare(`
      INSERT INTO board_projects (
        scope, id, schema_version, name, status, visibility, owner_id, description, tags_json,
        review_json, blocked_json, scope_migration_json, linked_paths_json, linked_runs_json,
        version, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, id) DO UPDATE SET
        schema_version = excluded.schema_version,
        name = excluded.name,
        status = excluded.status,
        visibility = excluded.visibility,
        owner_id = excluded.owner_id,
        description = excluded.description,
        tags_json = excluded.tags_json,
        review_json = excluded.review_json,
        blocked_json = excluded.blocked_json,
        scope_migration_json = excluded.scope_migration_json,
        linked_paths_json = excluded.linked_paths_json,
        linked_runs_json = excluded.linked_runs_json,
        version = excluded.version,
        created_at = excluded.created_at,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      scope,
      id,
      project.schema_version || '1.0',
      String(project.name || ''),
      String(project.status || 'active'),
      String(project.visibility || 'private'),
      String(project.owner_id || 'unknown'),
      String(project.description || ''),
      toJson(Array.isArray(project.tags) ? project.tags : []),
      toJson(project.review || {}),
      toJson(project.blocked || {}),
      toJson(project.scope_migration ?? null),
      toJson(Array.isArray(project.linked_paths) ? project.linked_paths : []),
      toJson(Array.isArray(project.linked_runs) ? project.linked_runs : []),
      Number(project.version) || 1,
      normalizeIsoDateOrNull(project.created_at) || nowIso(),
      project.created_by ? String(project.created_by) : null,
      normalizeIsoDateOrNull(project.updated_at) || nowIso(),
      project.updated_by ? String(project.updated_by) : null,
    );
  }

  function persistActivityTx(scope, id, activity, expectedVersion) {
    const normalized = normalizeActivityForPersistence(activity);
    const existing = db.prepare('SELECT version FROM board_activities WHERE scope = ? AND id = ?').get(scope, id);
    if (Number.isInteger(expectedVersion)) {
      const current = existing ? Number(existing.version) : null;
      if (current === null || current !== expectedVersion) {
        throw boardError(409, 'conflict', 'Version mismatch', { expected: current, got: expectedVersion });
      }
    }
    db.prepare(`
      INSERT INTO board_activities (
        scope, id, schema_version, name, description, status, owner_id, visibility,
        tags_json, custom_fields_json, version, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, id) DO UPDATE SET
        schema_version = excluded.schema_version,
        name = excluded.name,
        description = excluded.description,
        status = excluded.status,
        owner_id = excluded.owner_id,
        visibility = excluded.visibility,
        tags_json = excluded.tags_json,
        custom_fields_json = excluded.custom_fields_json,
        version = excluded.version,
        created_at = excluded.created_at,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      scope,
      id,
      normalized.schema_version || '1.0',
      String(normalized.name || ''),
      String(normalized.description || ''),
      String(normalized.status || 'active'),
      String(normalized.owner_id || 'unknown'),
      String(normalized.visibility || 'private'),
      toJson(normalized.tags || []),
      toJson(normalized.custom_fields || {}),
      Number(normalized.version) || 1,
      normalizeIsoDateOrNull(normalized.created_at) || nowIso(),
      normalized.created_by ? String(normalized.created_by) : null,
      normalizeIsoDateOrNull(normalized.updated_at) || nowIso(),
      normalized.updated_by ? String(normalized.updated_by) : null,
    );
  }

  function persistTaskTx(scope, id, task, expectedVersion) {
    const normalized = normalizeTaskForPersistence(task);
    const existing = db.prepare('SELECT version FROM board_tasks WHERE scope = ? AND id = ?').get(scope, id);
    if (Number.isInteger(expectedVersion)) {
      const current = existing ? Number(existing.version) : null;
      if (current === null || current !== expectedVersion) {
        throw boardError(409, 'conflict', 'Version mismatch', { expected: current, got: expectedVersion });
      }
    }

    db.prepare(`
      INSERT INTO board_tasks (
        scope, id, schema_version, project_id, activity_id, title, description, status, priority,
        work_type, assignee_type, assignee_id, human_assignee_label, task_list_id, workflow_id, subtasks_json,
        component_tags_json, sprint, story_points, completion_percent, dependencies_json, external_links_json, custom_fields_json, due_at,
        review_json, blocked_json, visibility, version, created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, id) DO UPDATE SET
        schema_version = excluded.schema_version,
        project_id = excluded.project_id,
        activity_id = excluded.activity_id,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        work_type = excluded.work_type,
        assignee_type = excluded.assignee_type,
        assignee_id = excluded.assignee_id,
        human_assignee_label = excluded.human_assignee_label,
        task_list_id = excluded.task_list_id,
        workflow_id = excluded.workflow_id,
        subtasks_json = excluded.subtasks_json,
        component_tags_json = excluded.component_tags_json,
        sprint = excluded.sprint,
        story_points = excluded.story_points,
        completion_percent = excluded.completion_percent,
        dependencies_json = excluded.dependencies_json,
        external_links_json = excluded.external_links_json,
        custom_fields_json = excluded.custom_fields_json,
        due_at = excluded.due_at,
        review_json = excluded.review_json,
        blocked_json = excluded.blocked_json,
        visibility = excluded.visibility,
        version = excluded.version,
        created_at = excluded.created_at,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      scope,
      id,
      normalized.schema_version || '1.0',
      normalized.project_id ? String(normalized.project_id) : null,
      normalized.activity_id ? String(normalized.activity_id) : null,
      String(normalized.title || ''),
      String(normalized.description || ''),
      String(normalized.status || 'backlog'),
      String(normalized.priority || 'medium'),
      String(normalized.work_type || 'feature'),
      String(normalized.assignee_type || 'unassigned'),
      normalized.assignee_id ? String(normalized.assignee_id) : null,
      normalized.human_assignee_label ? String(normalized.human_assignee_label) : null,
      normalized.task_list_id ? String(normalized.task_list_id) : null,
      normalized.workflow_id ? String(normalized.workflow_id) : null,
      toJson(normalized.subtasks || []),
      toJson(normalized.component_tags || []),
      normalized.sprint ? String(normalized.sprint) : null,
      Number.isInteger(normalized.story_points) ? normalized.story_points : null,
      Number.isInteger(normalized.completion_percent) ? normalized.completion_percent : 0,
      toJson(normalized.dependencies || []),
      toJson(normalized.external_links || []),
      toJson(normalized.custom_fields || {}),
      normalizeIsoDateOrNull(normalized.due_at),
      toJson(normalized.review || {}),
      toJson(normalized.blocked || {}),
      String(normalized.visibility || 'private'),
      Number(normalized.version) || 1,
      normalizeIsoDateOrNull(normalized.created_at) || nowIso(),
      normalized.created_by ? String(normalized.created_by) : null,
      normalizeIsoDateOrNull(normalized.updated_at) || nowIso(),
      normalized.updated_by ? String(normalized.updated_by) : null,
    );

    db.prepare('DELETE FROM board_task_relevant_links WHERE scope = ? AND task_id = ?').run(scope, id);
    db.prepare('DELETE FROM board_task_execution_attempts WHERE scope = ? AND task_id = ?').run(scope, id);
    db.prepare('DELETE FROM board_task_execution_updates WHERE scope = ? AND task_id = ?').run(scope, id);

    const insertLink = db.prepare(`
      INSERT INTO board_task_relevant_links (scope, task_id, link_type, path, kind, source, run_id, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    (normalized.linked_paths || []).forEach((item, index) => {
      insertLink.run(scope, id, 'path', String(item.path || ''), item.kind ? String(item.kind) : null, null, null, index, nowIso());
    });
    (normalized.linked_runs || []).forEach((item, index) => {
      insertLink.run(scope, id, 'run', null, null, item.source ? String(item.source) : null, item.id ? String(item.id) : null, index, nowIso());
    });

    const insertAttempt = db.prepare(`
      INSERT INTO board_task_execution_attempts (
        scope, task_id, attempt_id, state, trigger_type, idempotency_key, requested_at, requested_by,
        runtime_mode, agent_id, workflow_id, scheduler_job_id, scheduler_run_id, output_root,
        instruction_snapshot, started_at, completed_at, result_summary, failure_summary, task_version,
        position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertArtifact = db.prepare(`
      INSERT INTO board_task_execution_artifacts (
        scope, project_id, task_id, attempt_id, artifact_id, path, storage_ref,
        retention_class, position, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, task_id, attempt_id, path) DO NOTHING
    `);
    (normalized.execution?.attempts || []).forEach((attempt, index) => {
      insertAttempt.run(
        scope,
        id,
        String(attempt.attempt_id || ''),
        String(attempt.state || 'none'),
        attempt.trigger ? String(attempt.trigger) : null,
        attempt.idempotency_key ? String(attempt.idempotency_key) : null,
        normalizeIsoDateOrNull(attempt.requested_at),
        attempt.requested_by ? String(attempt.requested_by) : null,
        attempt.runtime_mode ? String(attempt.runtime_mode) : null,
        attempt.agent_id ? String(attempt.agent_id) : null,
        attempt.workflow_id ? String(attempt.workflow_id) : null,
        attempt.scheduler_job_id ? String(attempt.scheduler_job_id) : null,
        attempt.scheduler_run_id ? String(attempt.scheduler_run_id) : null,
        attempt.output_root ? String(attempt.output_root) : null,
        attempt.instruction_snapshot ? String(attempt.instruction_snapshot) : null,
        normalizeIsoDateOrNull(attempt.started_at),
        normalizeIsoDateOrNull(attempt.completed_at),
        attempt.result_summary ? String(attempt.result_summary) : null,
        attempt.failure_summary ? String(attempt.failure_summary) : null,
        Number.isInteger(attempt.task_version) ? attempt.task_version : null,
        index,
        nowIso(),
        nowIso(),
      );
      (Array.isArray(attempt.artifact_paths) ? attempt.artifact_paths : []).forEach((p, pIndex) => {
        const artifactPath = String(p || '');
        if (!artifactPath) return;
        insertArtifact.run(
          scope,
          normalized.project_id ? String(normalized.project_id) : null,
          id,
          String(attempt.attempt_id || ''),
          `art_${randomUUID().replace(/-/g, '')}`,
          artifactPath,
          artifactPath,
          'task_attempt',
          pIndex,
          nowIso(),
        );
      });
    });

    const insertUpdate = db.prepare(`
      INSERT INTO board_task_execution_updates (scope, task_id, attempt_id, state, summary, source, timestamp, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    (normalized.execution?.execution_updates || []).forEach((update, index) => {
      insertUpdate.run(
        scope,
        id,
        update.attempt_id ? String(update.attempt_id) : null,
        String(update.state || 'none'),
        String(update.summary || ''),
        String(update.source || 'scheduler'),
        normalizeIsoDateOrNull(update.timestamp) || nowIso(),
        index,
        nowIso(),
      );
    });
  }

  function privateReadProject(id) {
    const row = db.prepare('SELECT * FROM board_projects WHERE scope = ? AND id = ?').get('private', id);
    return projectRowToEntity(row);
  }

  function privateReadActivity(id) {
    const row = db.prepare('SELECT * FROM board_activities WHERE scope = ? AND id = ?').get('private', id);
    return activityRowToEntity(row);
  }

  function privateReadTask(id) {
    const row = db.prepare('SELECT * FROM board_tasks WHERE scope = ? AND id = ?').get('private', id);
    if (!row) return null;
    const related = {
      links: db.prepare('SELECT * FROM board_task_relevant_links WHERE scope = ? AND task_id = ? ORDER BY position ASC, id ASC').all('private', id),
      attempts: db.prepare('SELECT * FROM board_task_execution_attempts WHERE scope = ? AND task_id = ? ORDER BY position ASC, id ASC').all('private', id),
      updates: db.prepare('SELECT * FROM board_task_execution_updates WHERE scope = ? AND task_id = ? ORDER BY position ASC, id ASC').all('private', id),
      artifacts: db.prepare('SELECT * FROM board_task_execution_artifacts WHERE scope = ? AND task_id = ? ORDER BY position ASC, id ASC').all('private', id),
    };
    return taskRowToEntity(row, related);
  }

  function privateListProjects() {
    const rows = db.prepare('SELECT * FROM board_projects WHERE scope = ? ORDER BY updated_at DESC').all('private');
    return rows.map((row) => projectRowToEntity(row));
  }

  function privateListActivities() {
    const rows = db.prepare('SELECT * FROM board_activities WHERE scope = ? ORDER BY updated_at DESC').all('private');
    return rows.map((row) => activityRowToEntity(row));
  }

  function privateListTasks({ projectId = null } = {}) {
    const rows = projectId
      ? db.prepare('SELECT * FROM board_tasks WHERE scope = ? AND project_id = ? ORDER BY updated_at DESC').all('private', projectId)
      : db.prepare('SELECT * FROM board_tasks WHERE scope = ? ORDER BY updated_at DESC').all('private');
    return rows.map((row) => {
      const related = {
        links: db.prepare('SELECT * FROM board_task_relevant_links WHERE scope = ? AND task_id = ? ORDER BY position ASC, id ASC').all('private', row.id),
        attempts: db.prepare('SELECT * FROM board_task_execution_attempts WHERE scope = ? AND task_id = ? ORDER BY position ASC, id ASC').all('private', row.id),
        updates: db.prepare('SELECT * FROM board_task_execution_updates WHERE scope = ? AND task_id = ? ORDER BY position ASC, id ASC').all('private', row.id),
        artifacts: db.prepare('SELECT * FROM board_task_execution_artifacts WHERE scope = ? AND task_id = ? ORDER BY position ASC, id ASC').all('private', row.id),
      };
      return taskRowToEntity(row, related);
    });
  }

  function privateReadTaskList(id) {
    const row = db.prepare('SELECT * FROM board_task_lists WHERE scope = ? AND id = ?').get('private', id);
    return taskListRowToEntity(row);
  }

  function privateListTaskLists(ownerId) {
    const rows = db.prepare(
      'SELECT * FROM board_task_lists WHERE scope = ? AND owner_id = ? ORDER BY ordering ASC, updated_at DESC, id ASC',
    ).all('private', ownerId);
    return rows.map((row) => taskListRowToEntity(row));
  }

  function persistTaskListTx(scope, id, list, expectedVersion) {
    const existing = db.prepare('SELECT version FROM board_task_lists WHERE scope = ? AND id = ?').get(scope, id);
    if (Number.isInteger(expectedVersion)) {
      const current = existing ? Number(existing.version) : null;
      if (current === null || current !== expectedVersion) {
        throw boardError(409, 'conflict', 'Version mismatch', { expected: current, got: expectedVersion });
      }
    }
    db.prepare(`
      INSERT INTO board_task_lists (
        scope, id, name, description, owner_id, ordering, version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        owner_id = excluded.owner_id,
        ordering = excluded.ordering,
        version = excluded.version,
        created_at = excluded.created_at,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      scope,
      id,
      String(list.name || ''),
      list.description ? String(list.description) : null,
      String(list.owner_id || 'unknown'),
      Number.isInteger(list.ordering) ? list.ordering : 0,
      Number(list.version) || 1,
      normalizeIsoDateOrNull(list.created_at) || nowIso(),
      list.created_by ? String(list.created_by) : null,
      normalizeIsoDateOrNull(list.updated_at) || nowIso(),
      list.updated_by ? String(list.updated_by) : null,
    );
  }

  function deleteTaskListTx(scope, id) {
    const cleared = db.prepare('UPDATE board_tasks SET task_list_id = NULL WHERE scope = ? AND task_list_id = ?').run(scope, id);
    const deleted = db.prepare('DELETE FROM board_task_lists WHERE scope = ? AND id = ?').run(scope, id);
    return {
      deleted: Number(deleted.changes || 0),
      clearedTaskCount: Number(cleared.changes || 0),
    };
  }

  function listCatalogArtifacts({ scope, taskId, attemptId = null, includeDeleted = false }) {
    assertPrivateAuthorityActive();
    let sql = 'SELECT * FROM board_task_execution_artifacts WHERE scope = ? AND task_id = ?';
    const params = [scope, taskId];
    if (attemptId !== null && attemptId !== undefined) {
      sql += ' AND attempt_id = ?';
      params.push(attemptId);
    }
    if (!includeDeleted) sql += ' AND deleted_at IS NULL';
    sql += ' ORDER BY position ASC, id ASC';
    return db.prepare(sql).all(...params);
  }

  function listCatalogArtifactsByAttemptPathVariants({ scope, taskId, attemptId, candidatePaths = [] }) {
    assertPrivateAuthorityActive();
    if (!candidatePaths.length) return [];
    const placeholders = candidatePaths.map(() => '?').join(', ');
    const sql = `
      SELECT *
      FROM board_task_execution_artifacts
      WHERE scope = ?
        AND task_id = ?
        AND attempt_id = ?
        AND path IN (${placeholders})
        AND deleted_at IS NULL
      ORDER BY position ASC, id ASC
    `;
    return db.prepare(sql).all(scope, taskId, attemptId, ...candidatePaths);
  }

  function readCatalogArtifactById(artifactId) {
    assertPrivateAuthorityActive();
    return db.prepare('SELECT * FROM board_task_execution_artifacts WHERE artifact_id = ?').get(artifactId) || null;
  }

  function upsertCatalogArtifacts({ scope, projectId, taskId, attemptId, actorId = null, retentionClass = 'task_attempt', artifacts = [] }) {
    assertPrivateAuthorityActive();
    if (!Array.isArray(artifacts)) return [];

    if (scope === 'team') {
      const hasTask = db.prepare('SELECT id FROM board_tasks WHERE scope = ? AND id = ?').get(scope, taskId);
      if (!hasTask?.id) {
        const task = readEntitySync(taskFile('team', taskId));
        const linkedProjectId = projectId || task?.project_id || null;
        const project = linkedProjectId ? readEntitySync(projectFile('team', linkedProjectId)) : null;
        if (project?.id) persistProjectTx('team', project.id, project, null);
        if (task?.id) persistTaskTx('team', task.id, task, null);
      }
    }

    const insertArtifact = db.prepare(`
      INSERT INTO board_task_execution_artifacts (
        scope, project_id, task_id, attempt_id, artifact_id, path, storage_ref,
        content_type, size_bytes, hash_sha256, retention_class, created_by, position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, task_id, attempt_id, path) DO UPDATE SET
        project_id = excluded.project_id,
        storage_ref = excluded.storage_ref,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        hash_sha256 = excluded.hash_sha256,
        retention_class = excluded.retention_class,
        position = excluded.position,
        deleted_at = NULL,
        deleted_by = NULL,
        deleted_reason = NULL,
        delete_audit_event_id = NULL
    `);
    for (let idx = 0; idx < artifacts.length; idx += 1) {
      const artifact = artifacts[idx] || {};
      const artifactId = String(artifact.artifact_id || `art_${randomUUID().replace(/-/g, '')}`);
      insertArtifact.run(
        scope,
        projectId || null,
        taskId,
        attemptId || null,
        artifactId,
        String(artifact.path || ''),
        String(artifact.storage_ref || artifact.path || ''),
        artifact.content_type ? String(artifact.content_type) : null,
        Number.isFinite(Number(artifact.size_bytes)) ? Number(artifact.size_bytes) : null,
        artifact.hash_sha256 ? String(artifact.hash_sha256) : null,
        String(artifact.retention_class || retentionClass || 'task_attempt'),
        actorId || null,
        idx,
        artifact.created_at ? normalizeIsoDateOrNull(artifact.created_at) || nowIso() : nowIso(),
      );
    }
    return listCatalogArtifacts({ scope, taskId, attemptId, includeDeleted: false });
  }

  function markCatalogArtifactDeleted({ artifactId, actorId = null, reason = null, eventId = null }) {
    assertPrivateAuthorityActive();
    db.prepare(`
      UPDATE board_task_execution_artifacts
      SET deleted_at = ?,
          deleted_by = ?,
          deleted_reason = ?,
          delete_audit_event_id = ?
      WHERE artifact_id = ?
        AND deleted_at IS NULL
    `).run(nowIso(), actorId || null, reason || null, eventId || null, artifactId);
    return readCatalogArtifactById(artifactId);
  }

  function appendArtifactAccessAuditRow({
    actorId,
    operation,
    scope = null,
    projectId = null,
    taskId = null,
    attemptId = null,
    artifactId = null,
    artifactReference = null,
    result,
    reasonCode = null,
    details = null,
  }) {
    assertPrivateAuthorityActive();
    db.prepare(`
      INSERT INTO board_artifact_access_audit (
        timestamp, actor_id, operation, scope, project_id, task_id, attempt_id,
        artifact_id, artifact_reference, result, reason_code, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nowIso(),
      String(actorId || 'unknown'),
      String(operation || 'unknown'),
      scope,
      projectId,
      taskId,
      attemptId,
      artifactId,
      artifactReference,
      String(result || 'unknown'),
      reasonCode,
      details ? toJson(details) : null,
      nowIso(),
    );
  }

  async function exportPrivateCompatibility() {
    const dirs = scopeDirs('private');
    const compatRoot = dirs.compatDir;
    const projectsDir = path.join(compatRoot, 'projects');
    const activitiesDir = path.join(compatRoot, 'activities');
    const tasksDir = path.join(compatRoot, 'tasks');
    const activityDir = path.join(compatRoot, 'activity');
    const auditDir = path.join(compatRoot, 'audit');
    await fsp.mkdir(projectsDir, { recursive: true });
    await fsp.mkdir(activitiesDir, { recursive: true });
    await fsp.mkdir(tasksDir, { recursive: true });
    await fsp.mkdir(activityDir, { recursive: true });
    await fsp.mkdir(auditDir, { recursive: true });

    const projects = privateListProjects();
    const activities = privateListActivities();
    const tasks = privateListTasks();
    await Promise.all(projects.map((project) => atomicWriteJson(path.join(projectsDir, `${project.id}.json`), project)));
    await Promise.all(activities.map((activity) => atomicWriteJson(path.join(activitiesDir, `${activity.id}.json`), activity)));
    await Promise.all(tasks.map((task) => atomicWriteJson(path.join(tasksDir, `${task.id}.json`), task)));

    const activityRows = db.prepare('SELECT * FROM board_activity_projection WHERE scope = ? ORDER BY timestamp ASC, event_id ASC').all('private').map((row) => rowToEvent({
      ...row,
      entity_type: 'projection',
      old_version: null,
      new_version: null,
      result: row.result,
    })).map((row) => ({
      event_id: row.event_id,
      timestamp: row.timestamp,
      entity_id: row.entity_id,
      project_id: row.project_id,
      action: row.action,
      actor_id: row.actor_id,
      result: row.result,
      ...(row.details ? { details: row.details } : {}),
    }));
    const auditRows = db.prepare('SELECT * FROM board_audit_projection WHERE scope = ? ORDER BY timestamp ASC, event_id ASC').all('private').map((row) => ({
      event_id: row.event_id,
      timestamp: row.timestamp,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      project_id: row.project_id,
      action: row.action,
      actor_id: row.actor_id,
      old_version: row.old_version,
      new_version: row.new_version,
      result: row.result,
      ...(fromJson(row.details_json, null) ? { details: fromJson(row.details_json, null) } : {}),
    }));
    const day = new Date().toISOString().slice(0, 10);
    await writeJsonlAtomic(path.join(activityDir, `${day}.jsonl`), activityRows);
    await writeJsonlAtomic(path.join(auditDir, `${day}.jsonl`), auditRows);
  }

  function readLegacyJsonl(root, kind) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir)) return [];
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort();
    const out = [];
    for (const name of names) {
      const abs = path.join(dir, name);
      const text = fs.readFileSync(abs, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (row && typeof row === 'object' && !Array.isArray(row)) out.push(row);
        } catch {
          // ignore malformed legacy log rows
        }
      }
    }
    return out;
  }

  function collectLegacyEntitiesFromRoot(root, kind) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    for (const name of names) {
      const abs = path.join(dir, name);
      const expectedType = kind === 'projects' ? 'project' : kind === 'activities' ? 'activity' : 'task';
      out.push(readLegacyJsonEntityStrict(abs, expectedType));
    }
    return out;
  }

  function enforcePrivateAuthorityCutover() {
    const state = db.prepare('SELECT authority_mode, authority_marker FROM board_state WHERE id = 1').get();
    if (state?.authority_mode === 'sqlite_active' && state?.authority_marker === BOARD_AUTHORITY_MARKER) return;

    const privateBoardRoot = scopeRoot('private');
    const sources = [];
    const sourceRoots = [legacyRoot, privateBoardRoot]
      .map((p) => path.resolve(String(p || '')))
      .filter((p, idx, arr) => arr.indexOf(p) === idx);

    try {
      for (const sourceRoot of sourceRoots) {
        sources.push({
          sourceRoot,
          projects: collectLegacyEntitiesFromRoot(sourceRoot, 'projects'),
          activities: collectLegacyEntitiesFromRoot(sourceRoot, 'activities'),
          tasks: collectLegacyEntitiesFromRoot(sourceRoot, 'tasks'),
          activity: readLegacyJsonl(sourceRoot, 'activity'),
          audit: readLegacyJsonl(sourceRoot, 'audit'),
        });
      }
    } catch (err) {
      appendImportLedger({
        sourceName: 'private/entities',
        status: 'failed',
        sourceCount: 0,
        sourceHash: null,
        importedCount: 0,
        importedHash: null,
        reconciled: false,
        diagnostic: err?.diagnostic || { reason: 'unknown' },
      });
      throw err;
    }

    const byProjectId = new Map();
    const byActivityId = new Map();
    const byTaskId = new Map();
    for (const source of sources) {
      for (const project of source.projects) byProjectId.set(project.id, project);
      for (const activity of (source.activities || [])) byActivityId.set(activity.id, activity);
      for (const task of source.tasks) byTaskId.set(task.id, task);
    }
    const mergedProjects = [...byProjectId.values()];
    const mergedActivities = [...byActivityId.values()];
    const mergedTasks = [...byTaskId.values()];
    const mergedEvents = [];
    for (const source of sources) {
      for (const row of [...source.activity, ...source.audit]) {
        if (!row?.event_id) row.event_id = randomUUID();
        mergedEvents.push(row);
      }
    }

    const sourceEntitiesCount = mergedProjects.length + mergedActivities.length + mergedTasks.length;
    const sourceEntitiesHash = semanticHash([
      ...mergedProjects.map((p) => ({ id: `project:${p.id}`, value: p })),
      ...mergedActivities.map((a) => ({ id: `activity:${a.id}`, value: a })),
      ...mergedTasks.map((t) => ({ id: `task:${t.id}`, value: t })),
    ]);
    const sourceEventsHash = semanticHash(mergedEvents.map((e, i) => ({ id: `${e.event_id || i}`, ...e })));

    transaction(db, () => {
      db.prepare('DELETE FROM board_task_execution_artifacts WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_task_execution_updates WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_task_execution_attempts WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_task_relevant_links WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_tasks WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_activities WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_projects WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_activity_projection WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_audit_projection WHERE scope = ?').run('private');
      db.prepare('DELETE FROM board_lifecycle_events WHERE scope = ?').run('private');

      for (const project of mergedProjects) {
        persistProjectTx('private', project.id, project, null);
      }
      for (const activity of mergedActivities) {
        persistActivityTx('private', activity.id, activity, null);
      }
      for (const task of mergedTasks) {
        persistTaskTx('private', task.id, task, null);
      }
      for (const rawEvent of mergedEvents) {
        insertEventTx('private', rawEvent);
      }

      const importedProjects = privateListProjects();
      const importedActivities = privateListActivities();
      const importedTasks = privateListTasks();
      const importedEntitiesCount = importedProjects.length + importedActivities.length + importedTasks.length;
      const importedEntitiesHash = semanticHash([
        ...importedProjects.map((p) => ({ id: `project:${p.id}`, value: p })),
        ...importedActivities.map((a) => ({ id: `activity:${a.id}`, value: a })),
        ...importedTasks.map((t) => ({ id: `task:${t.id}`, value: t })),
      ]);

      const importedEventRows = db.prepare('SELECT event_id, timestamp, entity_type, entity_id, project_id, action, actor_id, old_version, new_version, result, details_json FROM board_lifecycle_events WHERE scope = ? ORDER BY timestamp ASC, event_id ASC').all('private');
      const importedEventsHash = semanticHash(importedEventRows.map((row) => ({
        ...row,
        details: fromJson(row.details_json, null),
      })));

      const entitiesReconciled = sourceEntitiesCount === importedEntitiesCount;
      const eventsReconciled = mergedEvents.length === importedEventRows.length;
      if (!entitiesReconciled || !eventsReconciled) {
        appendImportLedger({
          sourceName: 'private/entities',
          status: 'failed',
          sourceCount: sourceEntitiesCount,
          sourceHash: sourceEntitiesHash,
          importedCount: importedEntitiesCount,
          importedHash: importedEntitiesHash,
          reconciled: false,
          diagnostic: {
            reason: 'reconciliation_failed',
            entitiesReconciled,
            eventsReconciled,
            sourceEventsHash,
            importedEventsHash,
          },
        });
        const err = new Error('board import reconciliation failed');
        err.code = 'board_import_reconciliation_failed';
        err.diagnostic = {
          entitiesReconciled,
          eventsReconciled,
        };
        throw err;
      }

      appendImportLedger({
        sourceName: 'private/entities',
        status: 'imported',
        sourceCount: sourceEntitiesCount,
        sourceHash: sourceEntitiesHash || importedEntitiesHash,
        importedCount: importedEntitiesCount,
        importedHash: importedEntitiesHash,
        reconciled: true,
      });
      appendImportLedger({
        sourceName: 'private/events',
        status: 'imported',
        sourceCount: mergedEvents.length,
        sourceHash: sourceEventsHash || importedEventsHash,
        importedCount: importedEventRows.length,
        importedHash: importedEventsHash,
        reconciled: true,
      });

      db.prepare(`
        UPDATE board_state
        SET authority_mode = 'sqlite_active',
            authority_marker = ?,
            authority_activated_at = ?,
            updated_at = ?
        WHERE id = 1
      `).run(BOARD_AUTHORITY_MARKER, nowIso(), nowIso());
    });
  }

  let privateAuthorityInitError = null;

  function assertPrivateAuthorityActive() {
    const state = db.prepare('SELECT authority_mode, authority_marker FROM board_state WHERE id = 1').get();
    if (state?.authority_mode !== 'sqlite_active' || state?.authority_marker !== BOARD_AUTHORITY_MARKER) {
      const err = new Error('private board authority is not active (legacy import pending/failed)');
      err.code = 'board_authority_inactive';
      err.diagnostic = {
        authority_mode: state?.authority_mode || null,
        authority_marker: state?.authority_marker || null,
        ...(privateAuthorityInitError?.diagnostic ? { import_error: privateAuthorityInitError.diagnostic } : {}),
        remediation: [
          'fix malformed legacy board JSON under legacy/private roots',
          'restart board storage so import can complete',
          'private reads and mutations remain blocked until sqlite authority is active',
        ],
      };
      throw err;
    }
  }

  try {
    enforcePrivateAuthorityCutover();
  } catch (err) {
    privateAuthorityInitError = err;
  }

  function withPrivateMutation(fn) {
    assertPrivateAuthorityActive();
    const result = transaction(db, fn);
    return Promise.resolve(result);
  }

  function writeTeamEntity(scope, kind, id, entity, expectedVersion = null) {
    const file = kind === 'project'
      ? projectFile(scope, id)
      : kind === 'activity'
        ? activityFile(scope, id)
        : taskFile(scope, id);
    const dir = path.dirname(file);
    detectTeamDivergenceSync(dir, id);
    let pre = null;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      pre = JSON.parse(raw);
      if (!pre || typeof pre !== 'object' || Array.isArray(pre)) {
        throwTeamDivergence('invalid_entity_shape_detected', [path.basename(file)]);
      }
    } catch (err) {
      if (err?.code === 'ENOENT') {
        pre = null;
      } else if (err instanceof SyntaxError) {
        throwTeamDivergence('malformed_json_detected', [path.basename(file)]);
      } else {
        throw err;
      }
    }
    if (pre && Number.isInteger(expectedVersion) && pre.version !== expectedVersion) {
      throw boardError(409, 'conflict', 'Version mismatch', { expected: pre.version, got: expectedVersion });
    }
    atomicWriteJsonSync(file, entity);
    detectTeamDivergenceSync(dir, id);
  }

  return {
    withLock,
    preparePrivateMutation: () => {
      assertPrivateAuthorityActive();
    },
    resolveScopeRoot: scopeRoot,
    authorityMarker: BOARD_AUTHORITY_MARKER,
    getPrivateAuthorityState: () => {
      const row = db.prepare('SELECT authority_mode, authority_marker, authority_activated_at FROM board_state WHERE id = 1').get();
      return {
        mode: row?.authority_mode || null,
        marker: row?.authority_marker || null,
        activatedAt: row?.authority_activated_at || null,
      };
    },
    getPrivateDbPath: () => privateDbPath,
    getPrivateDbSnapshotPath: () => privateDbSnapshotPath,
    createPrivateDbSnapshot: () => createDatabaseSnapshot({ db, snapshotPath: privateDbSnapshotPath }),
    getPrivateDbQuickCheck: () => databaseQuickCheck(db),
    listProjects: async (scope) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        return sortByUpdatedDesc(privateListProjects());
      }
      const dirs = scopeDirs(scope);
      detectTeamDivergenceForReadsSync(dirs.projectsDir);
      return listEntitiesSync(dirs.projectsDir);
    },
    listActivities: async (scope) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        return sortByUpdatedDesc(privateListActivities());
      }
      const dirs = scopeDirs(scope);
      detectTeamDivergenceForReadsSync(dirs.activitiesDir);
      return listEntitiesSync(dirs.activitiesDir);
    },
    listTasks: async (scope) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        return sortByUpdatedDesc(privateListTasks());
      }
      const dirs = scopeDirs(scope);
      detectTeamDivergenceForReadsSync(dirs.tasksDir);
      return listEntitiesSync(dirs.tasksDir);
    },
    listTaskLists: async (scope, ownerId) => {
      if (scope !== 'private') return [];
      assertPrivateAuthorityActive();
      return privateListTaskLists(String(ownerId || ''));
    },
    readProject: async (scope, id) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        return privateReadProject(id);
      }
      try {
        detectTeamDivergenceForReadsSync(scopeDirs(scope).projectsDir);
        return readEntitySync(projectFile(scope, id));
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },
    readTask: async (scope, id) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        return privateReadTask(id);
      }
      try {
        detectTeamDivergenceForReadsSync(scopeDirs(scope).tasksDir);
        return readEntitySync(taskFile(scope, id));
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },
    readTaskList: async (scope, id) => {
      if (scope !== 'private') return null;
      assertPrivateAuthorityActive();
      return privateReadTaskList(id);
    },
    readActivityEntity: async (scope, id) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        return privateReadActivity(id);
      }
      try {
        detectTeamDivergenceForReadsSync(scopeDirs(scope).activitiesDir);
        return readEntitySync(activityFile(scope, id));
      } catch (err) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },
    writeProject: async (scope, id, entity, options = {}) => {
      if (scope === 'private') {
        const updated = await withPrivateMutation(() => {
          persistProjectTx(scope, id, entity, options.expectedVersion ?? null);
          if (options.event) insertEventTx(scope, options.event);
          return entity;
        });
        await ensurePrivateCompatibilityInitialized();
        await applyPrivateCompatibilityDelta({
          project: updated,
          activityEvents: options.event ? [options.event] : [],
          auditEvents: options.event ? [options.event] : [],
        });
        return updated;
      }
      writeTeamEntity(scope, 'project', id, entity, options.expectedVersion ?? null);
      if (options.event) {
        const day = new Date().toISOString().slice(0, 10);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'activity', day), [options.event]);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'audit', day), [options.event]);
      }
      return entity;
    },
    writeActivityEntity: async (scope, id, entity, options = {}) => {
      if (scope === 'private') {
        const updated = await withPrivateMutation(() => {
          persistActivityTx(scope, id, entity, options.expectedVersion ?? null);
          if (options.event) insertEventTx(scope, options.event);
          return entity;
        });
        await ensurePrivateCompatibilityInitialized();
        await applyPrivateCompatibilityDelta({
          activity: updated,
          activityEvents: options.event ? [options.event] : [],
          auditEvents: options.event ? [options.event] : [],
        });
        return updated;
      }
      writeTeamEntity(scope, 'activity', id, entity, options.expectedVersion ?? null);
      if (options.event) {
        const day = new Date().toISOString().slice(0, 10);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'activity', day), [options.event]);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'audit', day), [options.event]);
      }
      return entity;
    },
    writeTask: async (scope, id, entity, options = {}) => {
      if (scope === 'private') {
        const updated = await withPrivateMutation(() => {
          try {
            persistTaskTx(scope, id, entity, options.expectedVersion ?? null);
          } catch (err) {
            if (String(err?.code || '').includes('SQLITE_CONSTRAINT') && String(err?.message || '').includes('idempotency_key')) {
              throw boardError(409, 'execution_active', 'active execution attempt already exists');
            }
            throw err;
          }
          if (options.event) insertEventTx(scope, options.event);
          return entity;
        });
        await ensurePrivateCompatibilityInitialized();
        await applyPrivateCompatibilityDelta({
          task: updated,
          activityEvents: options.event ? [options.event] : [],
          auditEvents: options.event ? [options.event] : [],
        });
        return updated;
      }
      writeTeamEntity(scope, 'task', id, entity, options.expectedVersion ?? null);
      if (options.event) {
        const day = new Date().toISOString().slice(0, 10);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'activity', day), [options.event]);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'audit', day), [options.event]);
      }
      return entity;
    },
    writeTaskList: async (scope, id, entity, options = {}) => {
      if (scope !== 'private') throw boardError(422, 'validation_error', 'task lists support private scope only');
      const updated = await withPrivateMutation(() => {
        persistTaskListTx(scope, id, entity, options.expectedVersion ?? null);
        return entity;
      });
      return updated;
    },
    deleteProject: async (scope, id, options = {}) => {
      if (scope === 'private') {
        const events = Array.isArray(options.events) ? options.events : (options.event ? [options.event] : []);
        await withPrivateMutation(() => {
          db.prepare('DELETE FROM board_projects WHERE scope = ? AND id = ?').run(scope, id);
          for (const event of events) insertEventTx(scope, event);
        });
        await ensurePrivateCompatibilityInitialized();
        await applyPrivateCompatibilityDelta({
          deleteProjectId: id,
          activityEvents: events,
          auditEvents: events,
        });
        return;
      }
      await fsp.unlink(projectFile(scope, id)).catch(() => {});
      if (options.event) {
        const day = new Date().toISOString().slice(0, 10);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'audit', day), [options.event]);
      }
    },
    deleteActivityEntity: async (scope, id, options = {}) => {
      if (scope === 'private') {
        const events = Array.isArray(options.events) ? options.events : (options.event ? [options.event] : []);
        await withPrivateMutation(() => {
          db.prepare('DELETE FROM board_activities WHERE scope = ? AND id = ?').run(scope, id);
          for (const event of events) insertEventTx(scope, event);
        });
        await ensurePrivateCompatibilityInitialized();
        await applyPrivateCompatibilityDelta({
          deleteActivityId: id,
          activityEvents: events,
          auditEvents: events,
        });
        return;
      }
      await fsp.unlink(activityFile(scope, id)).catch(() => {});
      if (options.event) {
        const day = new Date().toISOString().slice(0, 10);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'audit', day), [options.event]);
      }
    },
    deleteTask: async (scope, id, options = {}) => {
      if (scope === 'private') {
        const events = Array.isArray(options.events) ? options.events : (options.event ? [options.event] : []);
        await withPrivateMutation(() => {
          db.prepare('DELETE FROM board_tasks WHERE scope = ? AND id = ?').run(scope, id);
          for (const event of events) insertEventTx(scope, event);
        });
        await ensurePrivateCompatibilityInitialized();
        await applyPrivateCompatibilityDelta({
          deleteTaskId: id,
          activityEvents: events,
          auditEvents: events,
        });
        return;
      }
      await fsp.unlink(taskFile(scope, id)).catch(() => {});
      if (options.event) {
        const day = new Date().toISOString().slice(0, 10);
        await writeJsonlAtomic(resolveScopeLogFile(scope, 'audit', day), [options.event]);
      }
    },
    deleteTaskList: async (scope, id) => {
      if (scope !== 'private') throw boardError(422, 'validation_error', 'task lists support private scope only');
      return withPrivateMutation(() => deleteTaskListTx(scope, id));
    },
    appendActivity: async (scope, record) => {
      if (scope === 'private') {
        await withPrivateMutation(() => {
          insertEventTx(scope, record);
        });
        await ensurePrivateCompatibilityInitialized();
        await applyPrivateCompatibilityDelta({ activityEvents: [record], auditEvents: [record] });
        return;
      }
      const file = resolveScopeLogFile(scope, 'activity', new Date().toISOString().slice(0, 10));
      await fsp.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    },
    appendAudit: async (scope, record) => {
      if (scope === 'private') {
        await withPrivateMutation(() => {
          insertEventTx(scope, record);
        });
        await ensurePrivateCompatibilityInitialized();
        await applyPrivateCompatibilityDelta({ activityEvents: [record], auditEvents: [record] });
        return;
      }
      const file = resolveScopeLogFile(scope, 'audit', new Date().toISOString().slice(0, 10));
      await fsp.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    },
    readActivity: async (scope, filterFn) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        const rows = db.prepare('SELECT event_id, timestamp, entity_id, project_id, action, actor_id, result, details_json FROM board_activity_projection WHERE scope = ? ORDER BY timestamp DESC, event_id DESC').all(scope);
        const out = rows.map((row) => ({
          event_id: row.event_id,
          timestamp: row.timestamp,
          entity_id: row.entity_id,
          project_id: row.project_id,
          action: row.action,
          actor_id: row.actor_id,
          result: row.result,
          ...(fromJson(row.details_json, null) ? { details: fromJson(row.details_json, null) } : {}),
        }));
        return filterFn ? out.filter(filterFn) : out;
      }
      const dir = scopeDirs(scope).activityDir;
      const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.jsonl')).sort().reverse();
      const out = [];
      for (const name of names) {
        const file = scope === 'team'
          ? resolveTeamRelativePathSafe(path.join('activity', name))
          : path.join(dir, name);
        const text = await fsp.readFile(file, 'utf8').catch(() => '');
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          const row = parseJsonSafe(line, null);
          if (!row) continue;
          if (!filterFn || filterFn(row)) out.push(row);
        }
      }
      return out;
    },
    readAudit: async (scope, filterFn) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        const rows = db.prepare(`
          SELECT event_id, timestamp, entity_type, entity_id, project_id, action, actor_id, old_version, new_version, result, details_json
          FROM board_audit_projection WHERE scope = ?
          ORDER BY timestamp DESC, event_id DESC
        `).all(scope);
        const out = rows.map((row) => ({
          event_id: row.event_id,
          timestamp: row.timestamp,
          entity_type: row.entity_type,
          entity_id: row.entity_id,
          project_id: row.project_id,
          action: row.action,
          actor_id: row.actor_id,
          old_version: row.old_version,
          new_version: row.new_version,
          result: row.result,
          ...(fromJson(row.details_json, null) ? { details: fromJson(row.details_json, null) } : {}),
        }));
        return filterFn ? out.filter(filterFn) : out;
      }
      const dir = scopeDirs(scope).auditDir;
      const names = (await fsp.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.jsonl')).sort().reverse();
      const out = [];
      for (const name of names) {
        const file = scope === 'team'
          ? resolveTeamRelativePathSafe(path.join('audit', name))
          : path.join(dir, name);
        const text = await fsp.readFile(file, 'utf8').catch(() => '');
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          const row = parseJsonSafe(line, null);
          if (!row) continue;
          if (!filterFn || filterFn(row)) out.push(row);
        }
      }
      return out;
    },
    listProjectTasks: async (scope, projectId) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        return privateListTasks({ projectId });
      }
      const dirs = scopeDirs(scope);
      detectTeamDivergenceForReadsSync(dirs.tasksDir);
      return listEntitiesSync(dirs.tasksDir).filter((t) => t.project_id === projectId);
    },
    listActivityTasks: async (scope, activityId) => {
      if (scope === 'private') {
        assertPrivateAuthorityActive();
        return privateListTasks().filter((t) => t.activity_id === activityId);
      }
      const dirs = scopeDirs(scope);
      detectTeamDivergenceForReadsSync(dirs.tasksDir);
      return listEntitiesSync(dirs.tasksDir).filter((t) => t.activity_id === activityId);
    },
    listCatalogArtifacts: async (params) => {
      assertPrivateAuthorityActive();
      return listCatalogArtifacts(params || {});
    },
    listCatalogArtifactsByAttemptPathVariants: async (params) => {
      assertPrivateAuthorityActive();
      return listCatalogArtifactsByAttemptPathVariants(params || {});
    },
    readCatalogArtifactById: async (artifactId) => {
      assertPrivateAuthorityActive();
      return readCatalogArtifactById(artifactId);
    },
    upsertCatalogArtifacts: async (params) => withPrivateMutation(() => upsertCatalogArtifacts(params || {})),
    markCatalogArtifactDeleted: async (params) => withPrivateMutation(() => markCatalogArtifactDeleted(params || {})),
    appendArtifactAccessAudit: async (params) => withPrivateMutation(() => appendArtifactAccessAuditRow(params || {})),
    listArtifactAccessAudit: async ({ limit = 100 } = {}) => {
      assertPrivateAuthorityActive();
      const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
      return db.prepare('SELECT * FROM board_artifact_access_audit ORDER BY timestamp DESC, id DESC LIMIT ?').all(safeLimit);
    },
  };
}
