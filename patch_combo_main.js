const fs = require('fs');
let code = fs.readFileSync('interface/public/styles.css', 'utf8');

code = code.replace(`.desk-combo-main {
  flex: 1;
  padding: 18px 20px;
  cursor: pointer;
  background: var(--bg);
  transition: background 0.15s;
}`, `.desk-combo-main {
  flex: 1;
  padding: 18px 20px;
  cursor: pointer;
  background: var(--bg);
  transition: background 0.15s;
  display: flex;
  flex-direction: column;
  justify-content: center;
}`);

fs.writeFileSync('interface/public/styles.css', code);
console.log('patched combo main');
