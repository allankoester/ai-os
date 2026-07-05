// Steadymade AI OS — skill hub
//
// Library scopes:
//   skills/company/<name>/SKILL.md   shared, committed to git
//   skills/personal/<name>/SKILL.md  private per user, gitignored
//
// Activation state lives in `.skill-profile` (workspace root, gitignored) —
// same pattern as the KI-OS workspaces:
//   company            scope line = whole scope active
//   +personal/foo      activate a single skill
//   -company/bar       exclude a single skill from an active scope
// The hub materializes the profile as symlinks in .claude/skills/<name>,
// which is where Claude Code discovers project skills.
//
// The marketplace browses ComposioHQ/awesome-claude-skills and installs
// GitHub-hosted skills into the library (default: personal scope).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Base scopes always exist. On a shared drive, every person can additionally
// have an own personal workspace: skills/personal-<name>/ (gitignored). Scopes
// are discovered dynamically so the hub's workspace filter adapts by itself.
const BASE_SCOPES = ['company', 'personal'];
const PERSONAL_WORKSPACE = /^personal-[a-z0-9][a-z0-9-]*$/;
const MARKETPLACE_REPO = 'ComposioHQ/awesome-claude-skills';
const MARKETPLACE_README = `https://raw.githubusercontent.com/${MARKETPLACE_REPO}/master/README.md`;
const MARKETPLACE_CACHE_MS = 60 * 60 * 1000;

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/s, '$1');
  }
  return out;
}

export function createSkillHub({ rootDir }) {
  const libraryDir = path.join(rootDir, 'skills');
  const activeDir = path.join(rootDir, '.claude', 'skills');
  const profileFile = path.join(rootDir, '.skill-profile');

  fs.mkdirSync(activeDir, { recursive: true });
  for (const scope of BASE_SCOPES) fs.mkdirSync(path.join(libraryDir, scope), { recursive: true });

  const validName = (name) => /^[a-z0-9][a-z0-9-]*$/.test(name);
  const activePath = (name) => path.join(activeDir, name);

  // company + personal + every personal-<name> workspace found on disk
  function scopeNames() {
    const names = new Set(BASE_SCOPES);
    try {
      for (const e of fs.readdirSync(libraryDir, { withFileTypes: true })) {
        if (e.isDirectory() && PERSONAL_WORKSPACE.test(e.name)) names.add(e.name);
      }
    } catch { /* library dir missing */ }
    const rank = (s) => { const i = BASE_SCOPES.indexOf(s); return i === -1 ? BASE_SCOPES.length : i; };
    return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  // ---------- .skill-profile ----------

  function readProfile() {
    const profile = { scopes: new Set(), include: new Set(), exclude: new Set() };
    let text;
    try { text = fs.readFileSync(profileFile, 'utf8'); } catch { return null; }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('+')) profile.include.add(line.slice(1));
      else if (line.startsWith('-')) profile.exclude.add(line.slice(1));
      else profile.scopes.add(line);
    }
    return profile;
  }

  async function writeProfile(profile) {
    const lines = [
      '# Aktive Skills — verwaltet vom Skill Hub (Interface, http://localhost:4011).',
      "# Scope-Zeile (z.B. 'company') = ganzer Scope, '+scope/skill' = Einzelskill,",
      "# '-scope/skill' = Ausnahme aus einem aktiven Scope.",
      ...[...profile.scopes].sort(),
      ...[...profile.include].sort().map((s) => '+' + s),
      ...[...profile.exclude].sort().map((s) => '-' + s),
      '',
    ];
    await fsp.writeFile(profileFile, lines.join('\n'), 'utf8');
  }

  function defaultProfile() {
    // KI-OS default: company scope active, personal skills opt-in
    return { scopes: new Set(['company']), include: new Set(), exclude: new Set() };
  }

  function skillIsActiveInProfile(profile, scope, name) {
    const key = `${scope}/${name}`;
    if (profile.exclude.has(key)) return false;
    return profile.scopes.has(scope) || profile.include.has(key);
  }

  function librarySkillDirs(scope) {
    const dir = path.join(libraryDir, scope);
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
        .map((d) => d.name)
        .sort();
    } catch { return []; }
  }

  // Materialize the profile as symlinks in .claude/skills/.
  // Only touches hub-managed entries (symlinks); real directories are left alone.
  async function syncActiveDir(profile) {
    const wanted = new Map(); // name -> source path
    for (const scope of scopeNames()) {
      for (const name of librarySkillDirs(scope)) {
        if (skillIsActiveInProfile(profile, scope, name) && !wanted.has(name)) {
          wanted.set(name, path.join(libraryDir, scope, name));
        }
      }
    }
    for (const entry of await fsp.readdir(activeDir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue; // never remove real directories
      if (!wanted.has(entry.name)) await fsp.unlink(activePath(entry.name));
    }
    for (const [name, source] of wanted) {
      const target = activePath(name);
      const rel = path.relative(activeDir, source);
      try {
        const st = fs.lstatSync(target);
        if (st.isSymbolicLink()) {
          if (fs.readlinkSync(target) === rel) continue;
          await fsp.unlink(target);
        } else {
          continue; // real dir shadows the library skill — leave it
        }
      } catch { /* does not exist */ }
      await fsp.symlink(rel, target, 'dir');
    }
  }

  // boot: profile is the source of truth; create it once if missing
  let bootProfile = readProfile();
  if (!bootProfile) {
    bootProfile = defaultProfile();
    writeProfile(bootProfile).catch(() => {});
  }
  syncActiveDir(bootProfile).catch((e) => console.error('[skills] sync failed:', e.message));

  // ---------- listing ----------

  async function listScope(scope, profile) {
    const dir = path.join(libraryDir, scope);
    const skills = [];
    for (const name of librarySkillDirs(scope)) {
      const skillFile = path.join(dir, name, 'SKILL.md');
      const fm = parseFrontmatter(await fsp.readFile(skillFile, 'utf8'));
      skills.push({
        name,
        scope,
        description: fm.description || null,
        active: skillIsActiveInProfile(profile, scope, name),
        path: path.relative(rootDir, skillFile),
      });
    }
    return skills;
  }

  // ---------- marketplace ----------

  let marketCache = { at: 0, skills: [] };

  function parseMarketplace(md) {
    const skills = [];
    let category = null;
    let inSkills = false;
    for (const line of md.split(/\r?\n/)) {
      const h2 = line.match(/^##\s+(.+)/);
      if (h2) { inSkills = /^skills$/i.test(h2[1].trim()); continue; }
      if (!inSkills) continue;
      const h3 = line.match(/^###\s+(.+)/);
      if (h3) { category = h3[1].trim(); continue; }
      const entry = line.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–—]\s*(.+)/);
      if (!entry || !category) continue;
      const [, name, url, rest] = entry;
      const description = rest.replace(/\s*\*By \[[^\]]*\]\([^)]*\)\*\s*$/, '').trim();
      // installable = hosted on github.com (repo root or /tree/<branch>/<subpath>)
      // or a directory inside the awesome repo itself (./folder/)
      let install = null;
      const gh = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^/]+)\/(.+?))?\/?$/);
      if (gh) install = { owner: gh[1], repo: gh[2].replace(/\.git$/, ''), ref: gh[3] || null, subpath: gh[4] || null };
      else if (/^\.\//.test(url)) {
        const [owner, repo] = MARKETPLACE_REPO.split('/');
        install = { owner, repo, ref: 'master', subpath: url.replace(/^\.\//, '').replace(/\/$/, '') };
      }
      skills.push({ name, url, description, category, installable: Boolean(install), install });
    }
    return skills;
  }

  async function marketplace(refresh = false) {
    if (!refresh && marketCache.skills.length && Date.now() - marketCache.at < MARKETPLACE_CACHE_MS) {
      return marketCache;
    }
    const res = await fetch(MARKETPLACE_README);
    if (!res.ok) throw new Error(`marketplace fetch failed: HTTP ${res.status}`);
    marketCache = { at: Date.now(), source: `github.com/${MARKETPLACE_REPO}`, skills: parseMarketplace(await res.text()) };
    return marketCache;
  }

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'skill';
  }

  function findSkillDirs(dir, depth = 0, results = []) {
    if (depth > 4 || results.length > 50) return results;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) results.push(dir);
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
        findSkillDirs(path.join(dir, e.name), depth + 1, results);
      }
    }
    return results;
  }

  async function installFromMarketplace({ url, scope = 'personal', name }) {
    if (!scopeNames().includes(scope)) return { errors: [`unknown scope "${scope}" — company, personal or personal-<name>`] };
    const { skills } = await marketplace();
    const entry = skills.find((s) => s.url === url);
    if (!entry) return { errors: ['marketplace entry not found — refresh the marketplace list'] };
    if (!entry.installable || !entry.install) {
      return { errors: ['this entry is not directly installable (external website) — open its URL and follow its own install instructions'] };
    }

    const { owner, repo, ref, subpath } = entry.install;
    const slug = validName(name || '') ? name : slugify(entry.name);
    const targetDir = path.join(libraryDir, scope, slug);
    if (fs.existsSync(targetDir)) return { errors: [`skills/${scope}/${slug} already exists — delete or rename it first`] };

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'skill-install-'));
    try {
      const tryRefs = ref ? [ref] : ['main', 'master'];
      let extracted = false, lastErr = '';
      for (const r of tryRefs) {
        const tarUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${r}`;
        const res = await fetch(tarUrl);
        if (!res.ok) { lastErr = `HTTP ${res.status} for ${r}`; continue; }
        const tarFile = path.join(tmpDir, 'repo.tar.gz');
        await fsp.writeFile(tarFile, Buffer.from(await res.arrayBuffer()));
        execFileSync('tar', ['-xzf', tarFile, '-C', tmpDir]);
        extracted = true;
        break;
      }
      if (!extracted) return { errors: [`could not download ${owner}/${repo}: ${lastErr}`] };

      const repoRoot = fs.readdirSync(tmpDir, { withFileTypes: true }).find((e) => e.isDirectory());
      if (!repoRoot) return { errors: ['downloaded archive is empty'] };
      const base = subpath ? path.join(tmpDir, repoRoot.name, subpath) : path.join(tmpDir, repoRoot.name);
      if (!fs.existsSync(base)) return { errors: [`path not found in repo: ${subpath}`] };

      const skillDirs = findSkillDirs(base);
      if (!skillDirs.length) {
        return { errors: ['no SKILL.md found in this repo — not a standard Claude skill, check its README for manual setup'] };
      }
      // prefer the shallowest SKILL.md (repo/skill root over nested examples)
      skillDirs.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
      await fsp.cp(skillDirs[0], targetDir, { recursive: true });

      // note the origin so updates/customizations stay traceable
      const meta = { source: entry.url, marketplace: MARKETPLACE_REPO, installedAt: new Date().toISOString(), originalName: entry.name };
      await fsp.writeFile(path.join(targetDir, '.install.json'), JSON.stringify(meta, null, 2), 'utf8');

      return { ok: true, scope, name: slug, path: `skills/${scope}/${slug}/SKILL.md`, foundSkillDirs: skillDirs.length };
    } finally {
      fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ---------- public API ----------

  return {
    async list() {
      const profile = readProfile() || defaultProfile();
      const scopes = [];
      for (const scope of scopeNames()) {
        scopes.push({
          name: scope,
          kind: scope === 'company' ? 'company' : 'personal',
          skills: await listScope(scope, profile),
        });
      }
      return { scopes, profileFile: '.skill-profile' };
    },

    async setActive(scope, name, active) {
      if (!scopeNames().includes(scope)) return { errors: [`unknown scope "${scope}" — company, personal or personal-<name>`] };
      if (!validName(name)) return { errors: ['invalid skill name'] };
      if (!fs.existsSync(path.join(libraryDir, scope, name, 'SKILL.md'))) {
        return { errors: [`skill not found in library: skills/${scope}/${name}`] };
      }
      const profile = readProfile() || defaultProfile();
      const key = `${scope}/${name}`;
      if (active) {
        profile.exclude.delete(key);
        if (!profile.scopes.has(scope)) profile.include.add(key);
      } else {
        profile.include.delete(key);
        if (profile.scopes.has(scope)) profile.exclude.add(key);
      }
      await writeProfile(profile);
      await syncActiveDir(profile);
      return { ok: true, active };
    },

    marketplace,
    installFromMarketplace,
  };
}
