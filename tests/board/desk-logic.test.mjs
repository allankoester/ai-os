import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  deriveDeskData,
  groupDeskTasks,
  getDeskCategory,
  filterDeskTasks,
  deriveDeskFilterState,
  deriveDeskDashboardCounts,
} = require('../../interface/public/desk-logic.js');

test('deriveDeskData excludes completed tasks and calculates scoped metrics', () => {
  const asLocalIso = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0).toISOString();
  const now = new Date(2026, 6, 22, 12, 0, 0, 0);
  const tasks = [
    { id: 'inbox-overdue', title: 'Inbox overdue', status: 'todo', due_at: asLocalIso(2026, 7, 21, 9) },
    { id: 'personal-today', title: 'Personal today', status: 'todo', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 22, 19) },
    { id: 'project-waiting', title: 'Project waiting', status: 'blocked', project_id: 'proj-1' },
    { id: 'activity-today', title: 'Activity today', status: 'todo', activity_id: 'act-1', due_at: asLocalIso(2026, 7, 22, 15) },
    { id: 'completed-personal', title: 'Done', status: 'done', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 22, 10) },
  ];

  const derived = deriveDeskData(tasks, now);

  assert.equal(derived.open.length, 4);
  assert.equal(derived.completed.length, 1);
  assert.equal(derived.byCategory.inbox.length, 1);
  assert.equal(derived.byCategory.personal.length, 1);
  assert.equal(derived.byCategory.project.length, 2);
  assert.equal(derived.today.length, 2);
  assert.equal(derived.overdue.length, 1);
  assert.equal(derived.waiting.length, 1);

  assert.deepEqual(derived.categoryMetrics.personal, { today: 1, overdue: 0, waiting: 0 });
  assert.deepEqual(derived.categoryMetrics.project, { today: 1, overdue: 0, waiting: 1 });
  assert.equal(getDeskCategory(tasks[3]), 'project');
});

test('groupDeskTasks hides empty groups and keeps activity-linked tasks in project grouping', () => {
  const tasks = [
    { id: 't1', title: 'Inbox task', status: 'todo' },
    { id: 't2', title: 'Activity task', status: 'todo', activity_id: 'act-1' },
  ];

  const grouped = groupDeskTasks(tasks, {
    taskLists: [{ id: 'list-1', name: 'Personal list' }],
    projects: [{ id: 'proj-1', name: 'Project Alpha' }],
    activities: [{ id: 'act-1', name: 'Activity Alpha' }],
  });

  assert.equal(grouped.inbox.length, 1);
  assert.equal(grouped.personalGroups.length, 0);
  assert.equal(grouped.projectGroups.length, 1);
  assert.equal(grouped.projectGroups[0].name, 'Activity Alpha');
  assert.equal(grouped.projectGroups[0].tasks[0].id, 't2');
});

test('grouped filters compose with AND logic across type/time/priority/status', () => {
  const asLocalIso = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0).toISOString();
  const now = new Date(2026, 6, 22, 12, 0, 0, 0);
  const tasks = [
    { id: 'match', title: 'Personal urgent today', status: 'todo', priority: 'high', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 22, 17) },
    { id: 'wrong-time', title: 'Personal urgent overdue', status: 'todo', priority: 'high', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 21, 9) },
    { id: 'wrong-prio', title: 'Personal normal today', status: 'todo', priority: 'medium', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 22, 18) },
    { id: 'wrong-type', title: 'Inbox urgent today', status: 'todo', priority: 'high', due_at: asLocalIso(2026, 7, 22, 15) },
    { id: 'wrong-status', title: 'Personal waiting today', status: 'blocked', priority: 'high', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 22, 13) },
  ];

  const result = filterDeskTasks(tasks, {
    now,
    filters: { type: 'personal', time: 'today', priority: 'important', status: 'open' },
  });

  assert.deepEqual(result.map((task) => task.id), ['match']);
});

test('deriveDeskFilterState returns active-of-total semantics based on type+status universe', () => {
  const asLocalIso = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0).toISOString();
  const now = new Date(2026, 6, 22, 12, 0, 0, 0);
  const tasks = [
    { id: 'p1', title: 'Personal alpha today', status: 'todo', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 22, 10) },
    { id: 'p2', title: 'Personal beta overdue', status: 'todo', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 21, 10) },
    { id: 'p3', title: 'Personal blocked today', status: 'blocked', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 22, 11) },
    { id: 'i1', title: 'Inbox alpha today', status: 'todo', due_at: asLocalIso(2026, 7, 22, 11) },
  ];

  const summary = deriveDeskFilterState(tasks, {
    now,
    query: 'alpha',
    filters: { type: 'personal', status: 'open', time: 'today', priority: 'any' },
  });

  // Total ignores time/priority/query and uses selected type+status universe only.
  assert.equal(summary.totalCount, 2); // p1 + p2
  // Active uses full filter set + search.
  assert.equal(summary.activeCount, 1); // p1
  assert.deepEqual(summary.activeTasks.map((task) => task.id), ['p1']);
});

test('dashboard counts respect current filter context instead of global-only counts', () => {
  const asLocalIso = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0).toISOString();
  const now = new Date(2026, 6, 22, 12, 0, 0, 0);
  const tasks = [
    { id: 'personal-overdue', title: 'Personal overdue', status: 'todo', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 21, 9) },
    { id: 'personal-today', title: 'Personal today', status: 'todo', task_list_id: 'list-1', due_at: asLocalIso(2026, 7, 22, 9) },
    { id: 'project-overdue', title: 'Project overdue', status: 'todo', project_id: 'proj-1', due_at: asLocalIso(2026, 7, 21, 8) },
    { id: 'project-today', title: 'Project today', status: 'todo', project_id: 'proj-1', due_at: asLocalIso(2026, 7, 22, 8) },
  ];

  const counts = deriveDeskDashboardCounts(tasks, {
    now,
    filters: { type: 'personal', status: 'open', time: 'today', priority: 'any' },
  });

  assert.equal(counts.timeCounts.overdue, 1); // personal overdue only, excludes project-overdue
  assert.equal(counts.timeCounts.today, 1);
  assert.equal(counts.typeCounts.project, 1); // same status+time context, switching type keeps context
});
