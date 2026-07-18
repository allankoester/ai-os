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
const warnings = [];

const rel = (p) => path.relative(ROOT, p);
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function check(label, condition, detail = '') {
  if (condition) ok.push(label);
  else errors.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, condition, detail = '') {
  if (condition) ok.push(label);
  else warnings.push(`${label}${detail ? ` — ${detail}` : ''}`);
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
  'scripts/start.mjs',
  'scripts/stop.mjs',
  'scripts/start-mac.command',
  'scripts/stop-mac.command',
  'scripts/start-windows.ps1',
  'scripts/stop-windows.ps1',
  'scripts/start-windows.cmd',
  'scripts/stop-windows.cmd',
  'scripts/README.md',
  'docs/runbook-stage1-onboarding.md',
  'docs/guide-how-to-start.md',
  'docs/compatibility-claude-opencode.md',
  'docs/status-and-roadmap.md',
  'docs/policy-knowledge-sync.md',
  'docs/runbook-team-operations.md',
  'docs/checklist-environment-parity.md',
  'docs/README.md',
  'profiles/_template.yml',
  'knowledge/README.md',
  'skills/README.md',
  'scheduler/README.md',
]) {
  check(`file exists: ${f}`, exists(f));
}

if (exists('operating-profile.md')) {
  check('file exists: operating profile', true);
} else {
  ok.push('operating profile check skipped (symlink to AI_OS root not resolvable — OK in CI without OneDrive mounted)');
}

for (const p of ['knowledge/company', 'knowledge/inbox', 'operating-profile.md']) {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) {
    warn(`${p} path exists`, false, 'missing (expected on user machines with OneDrive bridge)');
    continue;
  }
  let isLink = false;
  try { isLink = fs.lstatSync(abs).isSymbolicLink(); } catch { /* missing path */ }
  warn(`${p} uses symlink bridge to OneDrive (recommended in Stage 2)`, isLink);
}

if (exists('.gitignore')) {
  const gitignore = read('.gitignore');
  check('.gitignore excludes .claude/settings.local.json', /(^|\n)\.claude\/settings\.local\.json(\n|$)/.test(gitignore));
  check('.gitignore excludes interface/app-settings.json', /(^|\n)interface\/app-settings\.json(\n|$)/.test(gitignore));
}

try {
  const trackedLocalState = execSync('git ls-files interface/app-settings.json interface/provider-settings.json interface/workflows.json scheduler runs/usage.jsonl', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => f !== 'scheduler/README.md');
  check('machine-local runtime state files are not git-tracked', trackedLocalState.length === 0, `tracked: ${trackedLocalState.join(', ')}`);
} catch {
  ok.push('machine-local state git check skipped (not a git repo)');
}

if (exists('.claude/settings.local.json')) {
  const localSettings = read('.claude/settings.local.json');
  check('settings.local has no home-wide read grant', !/Read\(\/\/Users\/[^/)]+\/\*\*\)/.test(localSettings));
  check('settings.local has no unrelated KI-OS read grant', !/Read\(\/\/Users\/[^/)]+\/KI-OS\/\*\*\)/.test(localSettings));
}

if (exists('scripts/start.mjs')) {
  const startText = read('scripts/start.mjs');
  check('scripts/start.mjs does not force STEADYMADE_KNOWLEDGE_FS_ROOT local default', !/STEADYMADE_KNOWLEDGE_FS_ROOT\s*:\s*process\.env\.STEADYMADE_KNOWLEDGE_FS_ROOT\s*\|\|/.test(startText));
  check('scripts/start.mjs has no hardcoded _local knowledge default path', !/\.\.\.\/\.\.\.\/_local\/onedrive-company\/AI_OS\/knowledge/.test(startText));
}

if (exists('.claude/launch.json')) {
  let launchText = '';
  try { launchText = read('.claude/launch.json'); } catch { launchText = ''; }
  check('.claude/launch.json has no hardcoded STEADYMADE_KNOWLEDGE_FS_ROOT env', !/"STEADYMADE_KNOWLEDGE_FS_ROOT"\s*:/.test(launchText));
  check('.claude/launch.json has no hardcoded _local knowledge default path', !/_local\/onedrive-company\/AI_OS\/knowledge/.test(launchText));
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
    const version = fm && (fm[1].match(/^version:\s*(.+)$/m) || [])[1]?.trim();
    check(`skill ${d.name}: has name + description frontmatter`, Boolean(name && desc));
    check(`skill ${d.name}: kebab-case name matches folder`, name === d.name && /^[a-z0-9][a-z0-9-]*$/.test(d.name));
    check(`skill ${d.name}: has semver version frontmatter`, /^\d+\.\d+\.\d+$/.test(version || ''), `version=${version || 'missing'} — company skills need version: x.y.z (see skills/README.md)`);
  }
  for (const required of ['company-onboarding', 'personal-onboarding']) {
    check(`onboarding skill exists: skills/company/${required}`, exists(`skills/company/${required}/SKILL.md`));
  }
  // every company skill must be registered in the skill registry (Phase 0, agent consolidation)
  check('skill registry exists: skills/registry.yml', exists('skills/registry.yml'));
  if (exists('skills/registry.yml')) {
    const registry = read('skills/registry.yml');
    for (const d of skillDirs) {
      check(`skill ${d.name}: registered in skills/registry.yml`, new RegExp(`^  ${d.name}:`, 'm').test(registry));
    }
    // reverse check: no registry entry without a skill folder
    const dirNames = new Set(skillDirs.map((d) => d.name));
    for (const m of registry.matchAll(/^  ([a-z0-9][a-z0-9-]*):\s*$/gm)) {
      check(`registry entry has skill folder: ${m[1]}`, dirNames.has(m[1]));
    }
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

// skill registry allowed_agents entries must resolve to real agents (or 'all'/'danny')
if (exists('skills/registry.yml')) {
  const registryText = read('skills/registry.yml');
  const allowedIds = new Set();
  for (const m of registryText.matchAll(/allowed_agents:\s*(all|\[([^\]]*)\])/g)) {
    if (m[2] !== undefined) for (const id of m[2].split(',')) allowedIds.add(id.trim());
  }
  for (const id of allowedIds) {
    const okId = id === 'danny' || agentNames.some((n) => n === id || n.startsWith(id + '-'));
    check(`registry allowed_agents id resolves to an agent: ${id}`, okId);
  }
}

// no stale pre-contract knowledge paths in instructions
const OLD_PATH = /`knowledge\/(?!company(?:\/|\b)|personal(?:\/|\b)|inbox(?:\/|\b)|team(?:\/|\b)|README)[^`]+`/;
for (const f of ['CLAUDE.md', ...agentFiles.map((a) => `.claude/agents/${a}`)]) {
  if (!exists(f)) continue;
  check(`no stale knowledge paths in ${f}`, !OLD_PATH.test(read(f)));
}

for (const f of agentFiles.map((a) => `.claude/agents/${a}`)) {
  if (!exists(f)) continue;
  const text = read(f);
  check(`no unmanaged ~/.claude/skills refs in ${f}`, !/~\/\.claude\/skills\//.test(text));
}

// Kie.ai execution discipline lives in the generation-package skill since the
// creative merge (Vera absorbed Kira); the skill must not assume key availability.
if (exists('skills/company/generation-package/SKILL.md')) {
  const genPkg = read('skills/company/generation-package/SKILL.md');
  check('generation-package skill does not assume API key availability', !/The Kie\.ai API key is available/.test(genPkg));
  check('generation-package skill keeps execution-pending discipline', /Execution pending/.test(genPkg));
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

function parseWorkflowListFromDoc(file) {
  if (!exists(file)) return [];
  const text = read(file);
  const out = new Set();
  const known = ['strategy_review', 'knowledge_retrieval', 'knowledge_intake', 'transcript_intake', 'setup_profile', 'marketing_content', 'proposal', 'delivery', 'document', 'creative_image', 'calendar_planning', 'security_audit', 'dev_spec', 'multi_department'];
  for (const m of text.matchAll(/`([a-z_]+)`/g)) {
    const id = m[1];
    if (known.includes(id)) {
      out.add(id);
    }
  }
  const normalized = text.replace(/[<>]/g, ' ');
  for (const token of normalized.split(/[^a-z_]+/)) {
    if (known.includes(token)) out.add(token);
  }
  return [...out];
}

const canonicalWorkflowIds = ['strategy_review', 'knowledge_retrieval', 'knowledge_intake', 'transcript_intake', 'setup_profile', 'marketing_content', 'proposal', 'delivery', 'document', 'creative_image', 'calendar_planning', 'security_audit', 'dev_spec', 'multi_department'];
const dataWorkflowIds = [...dataJs.matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]);
for (const id of canonicalWorkflowIds) {
  check(`workflow exists in interface/public/data.js: ${id}`, dataWorkflowIds.includes(id));
}
for (const id of parseWorkflowListFromDoc('CLAUDE.md')) {
  check(`workflow in CLAUDE.md is canonical: ${id}`, canonicalWorkflowIds.includes(id));
}
for (const id of parseWorkflowListFromDoc('templates/task-brief.md')) {
  check(`workflow in templates/task-brief.md is canonical: ${id}`, canonicalWorkflowIds.includes(id));
}
for (const id of parseWorkflowListFromDoc('runs/run-log-template.md')) {
  check(`workflow in runs/run-log-template.md is canonical: ${id}`, canonicalWorkflowIds.includes(id));
}

if (exists('interface/meta.json')) {
  let meta = { docs: {} };
  try { meta = JSON.parse(read('interface/meta.json')); } catch { errors.push('interface/meta.json: invalid JSON'); }
  const docsMeta = meta.docs || {};
  const allowedStatuses = new Set(['approved', 'draft', 'candidate', 'needs_review', 'approved_candidate', 'conflict', 'deprecated']);
  for (const [docPath, record] of Object.entries(docsMeta)) {
    check(`meta path exists: ${docPath}`, exists(docPath));
    check(`meta status valid: ${docPath}`, allowedStatuses.has(record.status), `status=${record.status}`);
  }
  const ssotDir = path.join(ROOT, 'knowledge/company/company_handbook_SSOT');
  if (fs.existsSync(ssotDir)) {
    const ssotFiles = fs.readdirSync(ssotDir).filter((f) => f.endsWith('.md'))
      .map((f) => `knowledge/company/company_handbook_SSOT/${f}`);
    for (const f of ssotFiles) {
      check(`SSOT metadata exists: ${f}`, Boolean(docsMeta[f]));
    }
  }
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
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.error(`\nFAILED (${errors.length}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('All checks passed.');
