const fs = require('fs');
let code = fs.readFileSync('interface/public/app.js', 'utf8');

const oldGrid = `<div class="cc-grid" style="margin-bottom:0;">
          <div class="card stat-card" tabindex="0" role="button" data-desk-metric="inbox">
            <div class="mono-label">INBOX</div>
            <div class="stat-value">\${inboxTasks.length}</div>
          </div>
          <div class="card stat-card" tabindex="0" role="button" data-desk-metric="today">
            <div class="mono-label">DUE TODAY</div>
            <div class="stat-value">\${todayTasks.length}</div>
          </div>
          <div class="card stat-card \${overdueTasks.length ? 'warn' : ''}" tabindex="0" role="button" data-desk-metric="focus">
            <div class="mono-label">OVERDUE</div>
            <div class="stat-value">\${overdueTasks.length}</div>
          </div>
          <div class="card stat-card" tabindex="0" role="button" data-desk-metric="waiting">
            <div class="mono-label">WAITING</div>
            <div class="stat-value">\${waitingTasks.length}</div>
          </div>
        </div>`;

const newGrid = `<div class="desk-stats-grid" style="margin-bottom:0;">
          <div class="desk-combo-card">
            <div class="desk-combo-main" tabindex="0" role="button" data-desk-metric="all">
              <div class="mono-label" style="color:var(--green)">MY TASKS</div>
              <div class="stat-value">\${totalOpen}</div>
            </div>
            <div class="desk-combo-sub">
              <button class="desk-combo-btn" data-desk-metric="inbox">
                <span class="c-label">Inbox</span>
                <span class="c-val">\${inboxTasks.length}</span>
              </button>
              <button class="desk-combo-btn" data-desk-metric="personal">
                <span class="c-label">Personal</span>
                <span class="c-val">\${personalTasks.length}</span>
              </button>
              <button class="desk-combo-btn" data-desk-metric="project">
                <span class="c-label">Project</span>
                <span class="c-val">\${projectTasks.length}</span>
              </button>
            </div>
          </div>
          <div class="card stat-card" tabindex="0" role="button" data-desk-metric="today">
            <div class="mono-label">DUE TODAY</div>
            <div class="stat-value">\${todayTasks.length}</div>
          </div>
          <div class="card stat-card \${overdueTasks.length ? 'warn' : ''}" tabindex="0" role="button" data-desk-metric="focus">
            <div class="mono-label">OVERDUE</div>
            <div class="stat-value">\${overdueTasks.length}</div>
          </div>
          <div class="card stat-card" tabindex="0" role="button" data-desk-metric="waiting">
            <div class="mono-label">WAITING</div>
            <div class="stat-value">\${waitingTasks.length}</div>
          </div>
        </div>`;

if(code.includes(oldGrid)) {
  code = code.replace(oldGrid, newGrid);
  fs.writeFileSync('interface/public/app.js', code);
  console.log('patched grid');
} else {
  console.log('could not find old grid');
}
