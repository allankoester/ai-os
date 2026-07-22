const fs = require('fs');
let code = fs.readFileSync('interface/public/app.js', 'utf8');

const oldChips = `\${renderFilter('focus', 'Focus')}
            \${renderFilter('inbox', 'Inbox')}
            \${renderFilter('today', 'Today')}
            \${renderFilter('upcoming', 'Upcoming')}
            \${renderFilter('important', 'Important')}
            \${renderFilter('waiting', 'Waiting')}
            \${renderFilter('completed', 'Completed')}`;

const newChips = `\${renderFilter('focus', 'Focus')}
            \${renderFilter('all', 'All')}
            \${renderFilter('inbox', 'Inbox')}
            \${renderFilter('personal', 'Personal')}
            \${renderFilter('project', 'Project')}
            \${renderFilter('today', 'Today')}
            \${renderFilter('upcoming', 'Upcoming')}
            \${renderFilter('important', 'Important')}
            \${renderFilter('waiting', 'Waiting')}
            \${renderFilter('completed', 'Completed')}`;

if(code.includes(oldChips)) {
  code = code.replace(oldChips, newChips);
  fs.writeFileSync('interface/public/app.js', code);
  console.log('patched chips');
} else {
  console.log('could not find chips');
}
