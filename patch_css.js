const fs = require('fs');
let css = fs.readFileSync('interface/public/styles.css', 'utf8');
css = css.replace(
  /\.desk-task-row \{\n  background: var\(--white\);/,
  ".desk-task-row {\n  position: relative;\n  background: var(--white);"
);
css = css.replace(
  /\.desk-metric-card \{\n  background: var\(--white\);/,
  ".desk-metric-card {\n  cursor: pointer;\n  outline: none;\n  background: var(--white);"
);
css = css.replace(
  /\.desk-metric-card:hover \{/,
  ".desk-metric-card:focus-visible {\n  border-color: var(--green);\n  box-shadow: 0 0 0 3px var(--green-tint);\n}\n\n.desk-metric-card:hover {"
);
fs.writeFileSync('interface/public/styles.css', css);
