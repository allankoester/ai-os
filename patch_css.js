const fs = require('fs');
let code = fs.readFileSync('interface/public/styles.css', 'utf8');

code += `

/* ---- Grouped Desk Filters ---- */
.desk-filters-container {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: flex-end;
  padding: 12px 0;
  margin-left: 12px;
}
.desk-filter-segment {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.desk-filter-label {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-left: 2px;
}
.desk-filter-group {
  display: flex;
  background: var(--white);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.desk-filter-btn {
  padding: 6px 12px;
  font-size: 13px;
  color: var(--muted);
  background: transparent;
  border: none;
  border-right: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: var(--font-body);
}
.desk-filter-btn:last-child {
  border-right: none;
}
.desk-filter-btn:hover,
.desk-filter-btn:focus-visible {
  background: #F4F6F4;
  color: var(--headline);
  outline: none;
}
.desk-filter-btn.active {
  background: var(--surface-dark);
  color: var(--green);
  font-weight: 500;
}
.desk-filter-reset {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 1px;
}
.desk-filter-reset:hover,
.desk-filter-reset:focus-visible {
  background: var(--white);
  border-color: var(--border);
  color: var(--headline);
  outline: none;
}
@container maincol (max-width: 860px) {
  .desk-filters-container {
    margin-left: 0;
    width: 100%;
    border-top: 1px solid var(--border);
    padding-top: 16px;
    margin-top: 4px;
  }
}
`;

fs.writeFileSync('interface/public/styles.css', code);
console.log('patched CSS');
