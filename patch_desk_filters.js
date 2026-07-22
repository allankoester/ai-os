const fs = require('fs');
let code = fs.readFileSync('interface/public/app.js', 'utf8');

// Find the loop that builds arrays
const loopRegex = /let inboxTasks = \[\];\s*let todayTasks = \[\];/;
code = code.replace(loopRegex, `let inboxTasks = [];
    let personalTasks = [];
    let projectTasks = [];
    let todayTasks = [];`);

const ifInboxRegex = /if \(!t\.project_id && !t\.activity_id\) inboxTasks\.push\(t\);/;
code = code.replace(ifInboxRegex, `const hasProj = !!(t.project_id || t.activity_id);
      const hasList = !!getTaskListId(t);
      if (hasProj) projectTasks.push(t);
      else if (hasList) personalTasks.push(t);
      else inboxTasks.push(t);`);

const elseIfInboxRegex = /else if \(state\.deskFilter === 'inbox'\) displayTasks = inboxTasks;/;
code = code.replace(elseIfInboxRegex, `else if (state.deskFilter === 'inbox') displayTasks = inboxTasks;
    else if (state.deskFilter === 'personal') displayTasks = personalTasks;
    else if (state.deskFilter === 'project') displayTasks = projectTasks;
    else if (state.deskFilter === 'all') displayTasks = myTasks.filter(t => !['done','completed','delivered'].includes(t.status));`);

fs.writeFileSync('interface/public/app.js', code);
console.log('patched');
