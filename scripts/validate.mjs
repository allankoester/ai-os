// Steadymade AI OS — repository validity checks (Stage 2 quality gate)
// Zero-dependency. Run:  node scripts/validate.mjs
// Exit code 0 = all checks pass, 1 = failures (suitable for CI).

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const ok = [];

const rel = (p) => path.relative(ROOT, p);
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function check(label, condition, detail = '') {
  if (condition) ok.push(label);
  else errors.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

// ---------- 1. Folder contract ----------
for (const dir of ['knowledge/company', 'knowledge/personal', 'knowledge/inbox', 'templates', 'runs', 'profiles', 'docs']) {
  check(`folder exists: ${dir}/`, exists(dir));
}

// personal knowledge must not be git-tracked (beyond README/.gitkeep)
try {
  const tracked = execSync('git ls-files knowledge/personal', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !f.endsWith('README.md') && !f.endsWith('.gitkeep'));
  check('knowledge/personal/ is not git-tracked', tracked.length === 0, `tracked: ${tracked.join(', ')}`);
} catch {
  ok.push('knowledge/personal/ git check skipped (not a git repo)');
}

// ---------- 2. Required Stage 1/2 artifacts ----------
for (const f of [
  'templates/task-brief.md',
  'templates/approval-checklist.md',
  'templates/quality-rubric.md',
  'runs/run-log-template.md',
  'scripts/backup.sh',
  'docs/stage1-onboarding.md',
  'docs/knowledge-sync-policy.md',
  'docs/team-operations-runbook.md',
  'docs/environment-parity-checklist.md',
  'profiles/_template.yml',
  'knowledge/README.md',
  'knowledge/company/operating-profile.md',
  'skills/README.md',
  'scheduler/README.md',
]) {
  check(`file exists: ${f}`, exists(f));
}

// ---------- 2b. Skills library ----------
const companySkillsDir = path.join(ROOT, 'skills', 'company');
check('folder exists: skills/company/', fs.existsSync(companySkillsDir));
if (fs.existsSync(companySkillsDir)) {
  const skillDirs = fs.readdirSync(companySkillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of skillDirs) {
    const skillFile = `skills/company/${d.name}/SKILL.md`;
    if (!exists(skillFile)) { errors.push(`skill ${d.name}: missing SKILL.md`); continue; }
    const fm = read(skillFile).match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const name = fm && (fm[1].match(/^name:\s*(.+)$/m) || [])[1]?.trim();
    const desc = fm && (fm[1].match(/^description:\s*(.+)$/m) || [])[1]?.trim();
    check(`skill ${d.name}: has name + description frontmatter`, Boolean(name && desc));
    check(`skill ${d.name}: kebab-case name matches folder`, name === d.name && /^[a-z0-9][a-z0-9-]*$/.test(d.name));
  }
  for (const required of ['company-onboarding', 'personal-onboarding']) {
    check(`onboarding skill exists: skills/company/${required}`, exists(`skills/company/${required}/SKILL.md`));
  }
}

// personal skills and skill activation symlinks must not be git-tracked
try {
  const trackedSkills = execSync('git ls-files skills/personal .claude/skills', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !f.endsWith('.gitkeep'));
  check('skills/personal + .claude/skills are not git-tracked', trackedSkills.length === 0, `tracked: ${trackedSkills.join(', ')}`);
} catch {
  ok.push('skills git check skipped (not a git repo)');
}

// ---------- 3. Agent definitions ----------
const agentDir = path.join(ROOT, '.claude', 'agents');
const agentFiles = fs.readdirSync(agentDir).filter((f) => f.endsWith('.md'));
const agentNames = [];
for (const f of agentFiles) {
  const text = read(path.join('.claude/agents', f));
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) { errors.push(`agent ${f}: missing frontmatter`); continue; }
  const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const desc = (fm[1].match(/^description:\s*(.+)$/m) || [])[1]?.trim();
  check(`agent ${f}: has name + description`, Boolean(name && desc));
  if (name && name !== f.replace(/\.md$/, '')) {
    errors.push(`agent ${f}: frontmatter name "${name}" does not match filename`);
  }
  if (name) agentNames.push(name);
}

// no stale pre-contract knowledge paths in instructions
const OLD_PATH = /knowledge\/(?!company\/|personal\/|inbox\/|README)[A-Za-z]/;
for (const f of ['CLAUDE.md', 'docs/danny-orchestrator-system-prompt.md', ...agentFiles.map((a) => `.claude/agents/${a}`)]) {
  if (!exists(f)) continue;
  check(`no stale knowledge paths in ${f}`, !OLD_PATH.test(read(f)));
}

// ---------- 4. Interface model consistency ----------
const dataJs = read('interface/public/data.js');
for (const m of dataJs.matchAll(/promptPath:\s*'([^']+)'/g)) {
  check(`data.js promptPath exists: ${m[1]}`, exists(m[1]));
}
const accessKeys = new Set();
for (const m of dataJs.matchAll(/access:\s*\[([^\]]*)\]/g)) {
  for (const k of m[1].matchAll(/'([^']+)'/g)) accessKeys.add(k[1]);
}
for (const key of accessKeys) {
  check(`data.js access folder exists on disk: knowledge/${key}`, exists(path.join('knowledge', key)));
}

// ---------- 5. Skills profiles ----------
function parseProfileAgents(text) {
  // naive but sufficient: collect "- item" lines under agents.core/optional/excluded
  const lists = { core: [], optional: [], excluded: [] };
  let inAgents = false;
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (/^agents:\s*$/.test(line)) { inAgents = true; current = null; continue; }
    if (/^[a-zA-Z_]+:/.test(line)) { inAgents = false; current = null; }
    if (!inAgents) continue;
    const section = line.match(/^\s{2}(core|optional|excluded):/);
    if (section) { current = section[1]; continue; }
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && current) lists[current].push(item[1].trim());
  }
  return lists;
}

const profileFiles = fs.readdirSync(path.join(ROOT, 'profiles'))
  .filter((f) => f.endsWith('.yml') && !f.startsWith('_'));
check('at least one user profile exists', profileFiles.length > 0);
for (const f of profileFiles) {
  const lists = parseProfileAgents(read(path.join('profiles', f)));
  const all = [...lists.core, ...lists.optional, ...lists.excluded];
  for (const a of all) {
    check(`profile ${f}: agent "${a}" exists`, agentNames.includes(a));
  }
  const seen = new Set();
  for (const a of all) {
    check(`profile ${f}: agent "${a}" listed only once`, !seen.has(a));
    seen.add(a);
  }
  for (const a of agentNames) {
    check(`profile ${f}: agent "${a}" is classified`, seen.has(a));
  }
}

// ---------- report ----------
console.log(`Checks passed: ${ok.length}`);
if (errors.length) {
  console.error(`\nFAILED (${errors.length}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('All checks passed.');
