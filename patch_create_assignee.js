const fs = require('fs');
let app = fs.readFileSync('interface/public/app.js', 'utf8');

const regex = /const assigneeType = defaults\.assignee_type === 'human' \? 'human' : \(defaults\.assignee_type === 'unassigned' \? 'unassigned' : 'agent'\);/;
app = app.replace(regex, "const assigneeType = 'human';"); // Enforce human/me as default

const selectRegex = /<select id="task-new-assignee-type">\s*<option value="agent" \$\{assigneeType === 'agent' \? 'selected' : ''\}>Agent<\/option>\s*<option value="human" \$\{assigneeType === 'human' \? 'selected' : ''\}>Human<\/option>\s*<option value="unassigned" \$\{assigneeType === 'unassigned' \? 'selected' : ''\}>Unassigned<\/option>\s*<\/select>/;
const newSelect = `<select id="task-new-assignee-type">
            <option value="agent" \${assigneeType === 'agent' ? 'selected' : ''}>Agent</option>
            <option value="human" \${assigneeType === 'human' ? 'selected' : ''}>Human</option>
            <option value="unassigned" \${assigneeType === 'unassigned' ? 'selected' : ''}>Unassigned</option>
          </select>`;
app = app.replace(selectRegex, newSelect);

const createAssigneeHumanWrap = /<div class="form-field hidden" id="task-assignee-human-wrap"><label>Human assignee name<\/label><input id="task-new-assignee-human-label" placeholder="Full name"><\/div>/;
const newCreateAssigneeHumanWrap = `<div class="form-field \${assigneeType !== 'human' ? 'hidden' : ''}" id="task-assignee-human-wrap"><label>Human assignee name</label><input id="task-new-assignee-human-label" value="Me" placeholder="Full name"></div>`;
app = app.replace(createAssigneeHumanWrap, newCreateAssigneeHumanWrap);

const createSaveRegex = /const type = \$\('#task-new-assignee-type', drawer\)\?\.value \|\| 'agent';[\s\S]*?body: \{/m;
const newCreateSave = `const type = $('#task-new-assignee-type', drawer)?.value || 'agent';
      let aId = null;
      let hLabel = null;
      if (type === 'agent') {
        aId = $('#task-new-assignee-agent', drawer)?.value || null;
      } else if (type === 'human') {
        const val = $('#task-new-assignee-human-label', drawer)?.value.trim() || 'Me';
        if (val.toLowerCase() === 'me') {
          aId = state.system?.user?.id || 'allan';
        } else {
          aId = val.toLowerCase().replace(/[^a-z0-9]/g, '_');
          hLabel = val;
        }
      }

      const payload = {`;
app = app.replace(/const type = \$\('#task-new-assignee-type', drawer\)\?\.value \|\| 'agent';/, newCreateSave);
app = app.replace(/assignee_type: type,\n\s*assignee_id: type === 'agent' \? \$\('#task-new-assignee-agent', drawer\)\?\.value \|\| null : null,/, `assignee_type: type,
          assignee_id: aId,
          human_assignee_label: hLabel,`);

fs.writeFileSync('interface/public/app.js', app);
