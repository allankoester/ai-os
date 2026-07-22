/* Shared My Desk derivation helpers (browser + tests). */
(function initDeskLogic(global) {
  const COMPLETED_STATUSES = new Set(['done', 'completed', 'delivered']);

  function getDeskTaskListId(task) {
    return task?.task_list_id || task?.list_id || null;
  }

  function isDeskTaskCompleted(task) {
    return COMPLETED_STATUSES.has(String(task?.status || '').toLowerCase());
  }

  function getDeskCategory(task) {
    if (task?.project_id || task?.activity_id) return 'project';
    if (getDeskTaskListId(task)) return 'personal';
    return 'inbox';
  }

  function isSameLocalDay(a, b) {
    return a.getDate() === b.getDate()
      && a.getMonth() === b.getMonth()
      && a.getFullYear() === b.getFullYear();
  }

  function isDeskWaitingTask(task) {
    return task?.status === 'blocked' || (task?.review?.required && task?.review?.state === 'needs_review');
  }

  const DEFAULT_DESK_FILTERS = {
    type: 'all',
    time: 'any',
    priority: 'any',
    status: 'open',
  };

  function normalizeDeskFilters(filters) {
    const next = { ...DEFAULT_DESK_FILTERS, ...(filters || {}) };
    if (!['all', 'inbox', 'personal', 'project'].includes(next.type)) next.type = DEFAULT_DESK_FILTERS.type;
    if (!['any', 'today', 'overdue', 'upcoming'].includes(next.time)) next.time = DEFAULT_DESK_FILTERS.time;
    if (!['any', 'important'].includes(next.priority)) next.priority = DEFAULT_DESK_FILTERS.priority;
    if (!['open', 'waiting', 'completed'].includes(next.status)) next.status = DEFAULT_DESK_FILTERS.status;
    return next;
  }

  function deskTaskTimeBucket(task, nowInput = new Date()) {
    if (!task?.due_at) return 'none';
    const due = new Date(task.due_at);
    if (Number.isNaN(due.valueOf())) return 'none';
    const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
    if (isSameLocalDay(due, now)) return 'today';
    if (due < now) return 'overdue';
    return 'upcoming';
  }

  function deskTaskStatusGroup(task) {
    if (isDeskTaskCompleted(task)) return 'completed';
    if (isDeskWaitingTask(task)) return 'waiting';
    return 'open';
  }

  function filterDeskTasks(tasks, { filters = DEFAULT_DESK_FILTERS, now = new Date(), query = '' } = {}) {
    const normalized = normalizeDeskFilters(filters);
    const q = String(query || '').trim().toLowerCase();
    const source = Array.isArray(tasks) ? tasks : [];
    return source.filter((task) => {
      if (normalized.type !== 'all' && getDeskCategory(task) !== normalized.type) return false;
      if (normalized.status !== deskTaskStatusGroup(task)) return false;
      if (normalized.priority === 'important' && !(task?.priority === 'high' || task?.priority === 'urgent')) return false;
      if (normalized.time !== 'any' && deskTaskTimeBucket(task, now) !== normalized.time) return false;
      if (q && !(String(task?.title || '') + ' ' + String(task?.description || '')).toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function deriveDeskFilterState(tasks, { filters = DEFAULT_DESK_FILTERS, now = new Date(), query = '' } = {}) {
    const normalized = normalizeDeskFilters(filters);
    const allTasks = Array.isArray(tasks) ? tasks : [];
    const baseFilters = {
      ...normalized,
      time: 'any',
      priority: 'any',
    };
    const baseUniverse = filterDeskTasks(allTasks, { filters: baseFilters, now, query: '' });
    const activeTasks = filterDeskTasks(allTasks, { filters: normalized, now, query });
    return {
      filters: normalized,
      baseUniverse,
      activeTasks,
      activeCount: activeTasks.length,
      totalCount: baseUniverse.length,
    };
  }

  function deriveDeskDashboardCounts(tasks, { filters = DEFAULT_DESK_FILTERS, now = new Date() } = {}) {
    const normalized = normalizeDeskFilters(filters);
    const allTasks = Array.isArray(tasks) ? tasks : [];

    const typeCounts = {
      all: filterDeskTasks(allTasks, { now, filters: { ...normalized, type: 'all' }, query: '' }).length,
      inbox: filterDeskTasks(allTasks, { now, filters: { ...normalized, type: 'inbox' }, query: '' }).length,
      personal: filterDeskTasks(allTasks, { now, filters: { ...normalized, type: 'personal' }, query: '' }).length,
      project: filterDeskTasks(allTasks, { now, filters: { ...normalized, type: 'project' }, query: '' }).length,
    };

    return {
      typeCounts,
      timeCounts: {
        today: filterDeskTasks(allTasks, { now, filters: { ...normalized, time: 'today' }, query: '' }).length,
        overdue: filterDeskTasks(allTasks, { now, filters: { ...normalized, time: 'overdue' }, query: '' }).length,
      },
      statusCounts: {
        waiting: filterDeskTasks(allTasks, { now, filters: { ...normalized, status: 'waiting' }, query: '' }).length,
      },
    };
  }

  function deriveDeskData(tasks, nowInput = new Date()) {
    const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
    const all = Array.isArray(tasks) ? tasks : [];
    const open = [];
    const completed = [];
    const byCategory = { inbox: [], personal: [], project: [] };
    const categoryMetrics = {
      inbox: { today: 0, overdue: 0, waiting: 0 },
      personal: { today: 0, overdue: 0, waiting: 0 },
      project: { today: 0, overdue: 0, waiting: 0 },
    };
    const today = [];
    const overdue = [];
    const upcoming = [];
    const important = [];
    const waiting = [];

    for (const task of all) {
      if (isDeskTaskCompleted(task)) {
        completed.push(task);
        continue;
      }

      open.push(task);
      const category = getDeskCategory(task);
      byCategory[category].push(task);

      if (task?.priority === 'high' || task?.priority === 'urgent') important.push(task);

      if (isDeskWaitingTask(task)) {
        waiting.push(task);
        categoryMetrics[category].waiting += 1;
      }

      if (task?.due_at) {
        const due = new Date(task.due_at);
        if (!Number.isNaN(due.valueOf())) {
          if (isSameLocalDay(due, now)) {
            today.push(task);
            categoryMetrics[category].today += 1;
          } else if (due < now) {
            overdue.push(task);
            categoryMetrics[category].overdue += 1;
          } else {
            upcoming.push(task);
          }
        }
      }
    }

    return {
      all,
      open,
      completed,
      byCategory,
      categoryMetrics,
      today,
      overdue,
      upcoming,
      important,
      waiting,
    };
  }

  function groupDeskTasks(tasks, refs = {}) {
    const taskLists = Array.isArray(refs.taskLists) ? refs.taskLists : [];
    const projects = Array.isArray(refs.projects) ? refs.projects : [];
    const activities = Array.isArray(refs.activities) ? refs.activities : [];

    const personalGroupsById = new Map(taskLists.map((list) => [list.id, { id: list.id, name: list.name || 'Untitled List', tasks: [] }]));
    const projectGroupsByKey = new Map();

    for (const project of projects) {
      projectGroupsByKey.set(`project:${project.id}`, { key: `project:${project.id}`, name: project.name || 'Untitled Project', tasks: [] });
    }
    for (const activity of activities) {
      projectGroupsByKey.set(`activity:${activity.id}`, { key: `activity:${activity.id}`, name: activity.name || activity.title || 'Untitled Activity', tasks: [] });
    }

    const inbox = [];

    for (const task of (Array.isArray(tasks) ? tasks : [])) {
      const category = getDeskCategory(task);
      if (category === 'inbox') {
        inbox.push(task);
        continue;
      }
      if (category === 'personal') {
        const listId = getDeskTaskListId(task) || '__unknown_personal__';
        if (!personalGroupsById.has(listId)) {
          personalGroupsById.set(listId, { id: listId, name: 'Unknown list', tasks: [] });
        }
        personalGroupsById.get(listId).tasks.push(task);
        continue;
      }

      const key = task.project_id
        ? `project:${task.project_id}`
        : `activity:${task.activity_id || '__unknown_activity__'}`;
      if (!projectGroupsByKey.has(key)) {
        const fallbackName = task.project_id
          ? `Project ${task.project_id}`
          : `Activity ${task.activity_id || 'Unknown'}`;
        projectGroupsByKey.set(key, { key, name: fallbackName, tasks: [] });
      }
      projectGroupsByKey.get(key).tasks.push(task);
    }

    const personalGroups = [...personalGroupsById.values()]
      .filter((group) => group.tasks.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    const projectGroups = [...projectGroupsByKey.values()]
      .filter((group) => group.tasks.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      inbox,
      personalGroups,
      projectGroups,
    };
  }

  const api = {
    COMPLETED_STATUSES,
    DEFAULT_DESK_FILTERS,
    getDeskTaskListId,
    isDeskTaskCompleted,
    getDeskCategory,
    isDeskWaitingTask,
    deskTaskTimeBucket,
    deskTaskStatusGroup,
    normalizeDeskFilters,
    filterDeskTasks,
    deriveDeskFilterState,
    deriveDeskDashboardCounts,
    deriveDeskData,
    groupDeskTasks,
  };

  global.DeskLogic = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
