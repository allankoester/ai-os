import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createBoardStorage } from '../interface/board/storage.mjs';
import { createBoardService } from '../interface/board/service.mjs';

function isoNow() {
  return new Date().toISOString();
}

function toTaskId() {
  return `task_${randomUUID().replace(/-/g, '_').slice(0, 24)}`;
}

function parseDueDate(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const now = new Date();
  if (raw === 'today') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0);
    return d.toISOString();
  }
  if (raw === 'tomorrow') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
    return d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T09:00:00.000Z`;
  }
  return null;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
}

function classifyDueBucket(task, now = new Date()) {
  const due = task?.due_at ? Date.parse(task.due_at) : NaN;
  if (!Number.isFinite(due)) return 'no_due';
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const inSevenDays = todayStart + 8 * 24 * 60 * 60 * 1000;
  if (due < todayStart) return 'overdue';
  if (due < tomorrowStart) return 'today';
  if (due < inSevenDays) return 'upcoming';
  return 'later';
}

function classifyLocation(task) {
  if (task?.project_id) return 'project';
  if (!task?.project_id && !task?.activity_id) return 'inbox';
  return 'private';
}

function listCanonicalIdsFromDir(dirPath) {
  try {
    return new Set(
      fs.readdirSync(dirPath)
        .filter((name) => name.endsWith('.md'))
        .map((name) => path.basename(name, '.md')),
    );
  } catch {
    return new Set();
  }
}

function createNoopScheduler() {
  const unsupported = async () => ({ errors: ['scheduler unavailable in chat board adapter'] });
  return {
    createJob: unsupported,
    runNow: unsupported,
    cancelRun: unsupported,
    getRunLog: async () => null,
  };
}

function actorIdFromContext(actor) {
  return String(actor?.id || '').trim() || os.userInfo().username;
}

export function createChatBoardAdapter({ rootDir, runtimeRootOverride = null, privateRoot = null, teamRoot = null } = {}) {
  const privateBoardRoot = privateRoot
    ? path.resolve(privateRoot)
    : path.join(rootDir, 'project-board');
  const normalizedTeamRoot = teamRoot ? path.resolve(teamRoot) : null;
  try { fs.mkdirSync(privateBoardRoot, { recursive: true }); } catch {}
  if (normalizedTeamRoot) {
    try { fs.mkdirSync(normalizedTeamRoot, { recursive: true }); } catch {}
  }

  const boardStorage = createBoardStorage({
    rootDir,
    runtimeRootOverride,
    resolveRoots: () => ({
      privateRoot: privateBoardRoot,
      teamRoot: normalizedTeamRoot,
      sharedKnowledgeRoot: path.join(rootDir, 'knowledge'),
      personalKnowledgeRoot: path.join(rootDir, 'knowledge', 'personal'),
    }),
  });

  const boardService = createBoardService({
    rootDir,
    guardrails: {
      check() {
        return { allowed: true };
      },
    },
    scheduler: createNoopScheduler(),
    storage: boardStorage,
    resolveDeploymentState: async () => ({
      requestedDeployment: 'local-only',
      effectiveDeployment: 'local-only',
      teamCapability: { status: 'disabled', reason: 'CHAT_LOCAL_ONLY' },
    }),
    getRuntimeSettingsRaw: async () => ({ runtimeMode: 'claude-subscription', envVault: [] }),
    listCanonicalAgentIds: async () => listCanonicalIdsFromDir(path.join(rootDir, '.claude', 'agents')),
    listCanonicalWorkflowIds: async () => new Set(),
  });

  async function listMyDeskTasks(actor, { limit = 200 } = {}) {
    return boardService.listTasks({ desk_scope: 'my_desk', limit }, actor);
  }

  async function createMyDeskTask(actor, { title, description = '', due_at = null } = {}) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      const err = new Error('title is required');
      err.code = 'validation_error';
      throw err;
    }
    const payload = {
      id: toTaskId(),
      title: cleanTitle,
      description: String(description || '').trim(),
      status: 'todo',
      assignee_type: 'unassigned',
      due_at: due_at || null,
    };
    return boardService.createTask(payload, actor);
  }

  async function updateTaskStatusDue(actor, { task_id, status = null, due_at = null, has_due_at = false } = {}) {
    const id = String(task_id || '').trim();
    if (!id) {
      const err = new Error('task_id is required');
      err.code = 'validation_error';
      throw err;
    }
    const existing = await boardService.getTask(id, actor);
    const ops = [];
    if (status) ops.push({ op: 'set_status', value: String(status).trim() });
    if (has_due_at) {
      ops.push({ op: 'set_due_at', value: due_at });
    }
    if (!ops.length) {
      const err = new Error('no update fields provided');
      err.code = 'validation_error';
      throw err;
    }
    return boardService.patchTask(id, { version: existing.version, ops }, actor);
  }

  async function buildDaySummary(actor) {
    const tasksResult = await listMyDeskTasks(actor, { limit: 200 });
    const tasks = Array.isArray(tasksResult?.items) ? tasksResult.items : [];
    const locationGroups = { private: [], inbox: [], project: [] };
    const dueBuckets = { overdue: [], today: [], upcoming: [], later: [], no_due: [] };

    for (const task of tasks) {
      const summarized = {
        id: task.id,
        title: task.title,
        status: task.status,
        due_at: task.due_at || null,
        visibility: task.visibility || 'private',
        project_id: task.project_id || null,
        activity_id: task.activity_id || null,
        location: classifyLocation(task),
        due_bucket: classifyDueBucket(task),
      };
      const loc = summarized.location;
      const bucket = summarized.due_bucket;
      if (locationGroups[loc]) locationGroups[loc].push(summarized);
      if (dueBuckets[bucket]) dueBuckets[bucket].push(summarized);
    }

    return {
      generated_at: isoNow(),
      actor_id: actorIdFromContext(actor),
      total_tasks: tasks.length,
      by_location: locationGroups,
      due_buckets: dueBuckets,
      tasks,
    };
  }

  return {
    parseDueDate,
    listMyDeskTasks,
    createMyDeskTask,
    updateTaskStatusDue,
    buildDaySummary,
    close() {
      try {
        boardStorage.db.close();
      } catch {
        // ignore close errors in shutdown path
      }
    },
  };
}
