const fs = require('fs');
let code = fs.readFileSync('interface/public/app.js', 'utf8');
code = code.replace(
  "$('[data-desk-metric]', el).forEach",
  () => "$$('[data-desk-metric]', el).forEach"
);
fs.writeFileSync('interface/public/app.js', code);
