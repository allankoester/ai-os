const fs = require('fs');
let code = fs.readFileSync('interface/public/app.js', 'utf8');

const regex1 = /const renderFilter = \(id, label\) => `[\s\S]*?else if \(state\.deskFilter === 'completed'\) displayTasks = completedTasks;/;

const newCode1 = `state.deskFilters = state.deskFilters || { type: 'all', time: 'any', priority: 'any', status: 'open' };
    const df = state.deskFilters;

    const rGroup = (grp, val, lbl) => \`
      <button class="desk-filter-btn \${df[grp] === val ? 'active' : ''}" data-desk-filter-group="\${grp}" data-desk-filter-value="\${val}">\${lbl}</button>\`;

    let displayTasks = derived.open || myTasks;
    // Logic Lane: Apply full combination of state.deskFilters here.
    // Shim for rendering:
    if (df.status === 'completed') displayTasks = derived.completed;
    else if (df.status === 'waiting') displayTasks = derived.waiting;
    else if (df.time === 'today') displayTasks = derived.today;
    else if (df.time === 'overdue') displayTasks = derived.overdue;
    else if (df.type === 'inbox') displayTasks = inboxTasks;
    else if (df.type === 'personal') displayTasks = personalTasks;
    else if (df.type === 'project') displayTasks = projectTasks;`;

code = code.replace(regex1, newCode1);

const regex2 = /<div class="desk-filters">[\s\S]*?<\/div>\s*<div class="desk-search-bar">/;
const newCode2 = `<div class="desk-filters-container">
            <div class="desk-filter-segment">
              <span class="desk-filter-label">Task Type</span>
              <div class="desk-filter-group" role="group" aria-label="Task type">
                \${rGroup('type', 'all', 'My Tasks')}
                \${rGroup('type', 'inbox', 'Inbox')}
                \${rGroup('type', 'personal', 'Personal')}
                \${rGroup('type', 'project', 'Project')}
              </div>
            </div>
            <div class="desk-filter-segment">
              <span class="desk-filter-label">Time</span>
              <div class="desk-filter-group" role="group" aria-label="Time">
                \${rGroup('time', 'any', 'Any time')}
                \${rGroup('time', 'today', 'Today')}
                \${rGroup('time', 'overdue', 'Overdue')}
                \${rGroup('time', 'upcoming', 'Upcoming')}
              </div>
            </div>
            <div class="desk-filter-segment">
              <span class="desk-filter-label">Importance</span>
              <div class="desk-filter-group" role="group" aria-label="Importance">
                \${rGroup('priority', 'any', 'Any priority')}
                \${rGroup('priority', 'important', 'Important')}
              </div>
            </div>
            <div class="desk-filter-segment">
              <span class="desk-filter-label">State</span>
              <div class="desk-filter-group" role="group" aria-label="State">
                \${rGroup('status', 'open', 'Open')}
                \${rGroup('status', 'waiting', 'Waiting')}
                \${rGroup('status', 'completed', 'Completed')}
              </div>
            </div>
            <button class="desk-filter-reset" data-desk-filter-action="reset" aria-label="Reset filters" title="Reset filters">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
          </div>
          <div class="desk-search-bar">`;
code = code.replace(regex2, newCode2);

const regex3 = /Array\.from\(el\.querySelectorAll\('\[data-desk-filter\]'\)\)\.forEach\(b => b\.addEventListener\('click', \(\) => {[\s\S]*?renderDesk\(el\);\s*}\)\);/;
const newCode3 = `Array.from(el.querySelectorAll('[data-desk-filter-group]')).forEach(b => b.addEventListener('click', () => {
      state.deskFilters[b.dataset.deskFilterGroup] = b.dataset.deskFilterValue;
      renderDesk(el);
    }));
    const rBtn = el.querySelector('[data-desk-filter-action="reset"]');
    if (rBtn) rBtn.addEventListener('click', () => {
      state.deskFilters = { type: 'all', time: 'any', priority: 'any', status: 'open' };
      renderDesk(el);
    });`;
code = code.replace(regex3, newCode3);

const regex4 = /const handleMetricClick = \(e\) => {[\s\S]*?state\.deskFilter = state\.deskFilter === card\.dataset\.deskMetric \? 'focus' : card\.dataset\.deskMetric;\s*renderDesk\(el\);\s*};/;
const newCode4 = `const handleMetricClick = (e) => {
        e.preventDefault();
        const metric = card.dataset.deskMetric;
        if (['all', 'inbox', 'personal', 'project'].includes(metric)) {
          state.deskFilters.type = metric;
          state.deskFilters.time = 'any';
          state.deskFilters.priority = 'any';
          state.deskFilters.status = 'open';
        } else if (metric === 'today') {
          state.deskFilters.time = 'today';
          state.deskFilters.status = 'open';
        } else if (metric === 'overdue') {
          state.deskFilters.time = 'overdue';
          state.deskFilters.status = 'open';
        } else if (metric === 'waiting') {
          state.deskFilters.status = 'waiting';
        }
        renderDesk(el);
      };`;
code = code.replace(regex4, newCode4);

fs.writeFileSync('interface/public/app.js', code);
console.log('patched app.js UI');
