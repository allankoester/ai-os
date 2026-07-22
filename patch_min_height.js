const fs = require('fs');
let code = fs.readFileSync('interface/public/styles.css', 'utf8');

code = code.replace(`.desk-combo-btn {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;`, `.desk-combo-btn {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  min-height: 32px;`);

fs.writeFileSync('interface/public/styles.css', code);
console.log('patched min-height');
