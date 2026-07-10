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

function unquote(v) {
  const s = String(v ?? '').trim();
  return s.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
}

function parseCsvOrList(v) {
  if (Array.isArray(v)) return v.map((x) => unquote(x)).filter(Boolean);
  const s = unquote(v);
  if (!s) return [];
  const inline = s.match(/^\[(.*)\]$/s);
  const body = inline ? inline[1] : s;
  return body.split(',').map((x) => unquote(x)).map((x) => x.trim()).filter(Boolean);
}

function skillMetaFromFrontmatter(fm = {}) {
  const requiresPlugins = parseCsvOrList(fm['requires-plugins'] ?? fm.requires_plugins);
  const knowledge = parseCsvOrList(fm.knowledge);
  const capabilities = parseCsvOrList(fm.capabilities);
  return { requiresPlugins, knowledge, capabilities };
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (value) {
      out[key] = unquote(value);
      continue;
    }
    const list = [];
    for (let j = idx + 1; j < lines.length; j++) {
      const item = lines[j].match(/^\s*-\s*(.+)$/);
      if (!item) break;
      list.push(unquote(item[1]));
      idx = j;
    }
    out[key] = list.length ? list : '';
  }
  return out;
}

export function createSkillHub({ rootDir, listEnabledPlugins = () => [] }) {
  const libraryDir = path.join(rootDir, 'skills');
  const activeDir = path.join(rootDir, '.claude', 'skills');
  const profileFile = path.join(rootDir, '.skill-profile');

  fs.mkdirSync(activeDir, { recursive: true });
  for (const scope of BASE_SCOPES) fs.mkdirSync(path.join(libraryDir, scope), { recursive: true });

  const validName = (name) => /^[a-z0-9][a-z0-9-]*$/.test(name);
  const isPersonalScope = (scope) => scope === 'personal' || PERSONAL_WORKSPACE.test(scope);
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
      const meta = skillMetaFromFrontmatter(fm);
      const skill = {
        name,
        scope,
        description: fm.description || null,
        version: fm.version || null,
        requiresPlugins: meta.requiresPlugins,
        knowledge: meta.knowledge,
        capabilities: meta.capabilities,
        active: skillIsActiveInProfile(profile, scope, name),
        path: path.relative(rootDir, skillFile),
      };

      const metaFile = path.join(dir, name, '.install.json');
      if (fs.existsSync(metaFile)) {
        let meta = {};
        try { meta = JSON.parse(await fsp.readFile(metaFile, 'utf8')); } catch {}
        skill.sha = meta.sha || null;
        skill.installedAt = meta.installedAt || null;
        skill.source = meta.source || null;
        skill.owner = meta.owner || null;
        skill.repo = meta.repo || null;
        skill.ref = meta.ref || null;
        skill.subpath = meta.subpath || null;
        if (typeof meta.installedAt === 'string') {
          try {
            const st = await fsp.stat(skillFile);
            skill.localModified = st.mtime.toISOString() > meta.installedAt;
          } catch {
            skill.localModified = null;
          }
        } else {
          skill.localModified = null;
        }
      }

      skills.push(skill);
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

  // Resolve the commit sha a branch currently points at, so installs are
  // pinned and reproducible. Best-effort: offline installs record sha null.
  async function resolveHeadSha(owner, repo, ref) {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, {
        headers: { accept: 'application/vnd.github.v3+json' },
      });
      if (!res.ok) return null;
      const json = await res.json();
      return typeof json.sha === 'string' ? json.sha : null;
    } catch { return null; }
  }

  // Local-only version history for personal skills (never gets a remote).
  // Company skills are versioned by the main repo; personal scopes are
  // gitignored there, so each personal scope carries its own git repo.
  function personalGitSnapshot(scope, message) {
    if (scope === 'company') return;
    const dir = path.join(libraryDir, scope);
    const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    try {
      if (!fs.existsSync(path.join(dir, '.git'))) git(['init', '-q']);
      git(['add', '-A']);
      git(['-c', 'user.name=skill-hub', '-c', 'user.email=skill-hub@local', 'commit', '-q', '-m', message]);
    } catch { /* best-effort: empty commit or missing git never breaks installs */ }
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
      let extracted = false, lastErr = '', usedRef = null;
      for (const r of tryRefs) {
        const tarUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${r}`;
        const res = await fetch(tarUrl);
        if (!res.ok) { lastErr = `HTTP ${res.status} for ${r}`; continue; }
        const tarFile = path.join(tmpDir, 'repo.tar.gz');
        await fsp.writeFile(tarFile, Buffer.from(await res.arrayBuffer()));
        execFileSync('tar', ['-xzf', tarFile, '-C', tmpDir]);
        extracted = true;
        usedRef = r;
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

      // note the origin so updates/customizations stay traceable; pin the
      // installed revision (branch head sha at install time)
      const sha = await resolveHeadSha(owner, repo, usedRef);
      const meta = {
        source: entry.url,
        marketplace: MARKETPLACE_REPO,
        installedAt: new Date().toISOString(),
        originalName: entry.name,
        owner,
        repo,
        ref: usedRef,
        subpath: subpath || null,
        sha,
      };
      await fsp.writeFile(path.join(targetDir, '.install.json'), JSON.stringify(meta, null, 2), 'utf8');
      personalGitSnapshot(scope, `install ${slug} from ${owner}/${repo}@${sha ? sha.slice(0, 7) : usedRef}`);

      return { ok: true, scope, name: slug, path: `skills/${scope}/${slug}/SKILL.md`, sha, foundSkillDirs: skillDirs.length };
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

      if (active) {
        const skillFile = path.join(libraryDir, scope, name, 'SKILL.md');
        const fm = parseFrontmatter(await fsp.readFile(skillFile, 'utf8'));
        const required = skillMetaFromFrontmatter(fm).requiresPlugins;
        if (required.length) {
          const enabled = new Set(await Promise.resolve(listEnabledPlugins()));
          const missing = required.filter((id) => !enabled.has(id));
          if (missing.length) {
            return {
              errors: [`cannot activate /${name}: required plugins not enabled — ${missing.join(', ')}`],
              blockedByDependencies: true,
              missingPlugins: missing,
            };
          }
        }
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

    async createPersonalSkill({ scope, name, content }) {
      if (!isPersonalScope(scope)) return { errors: ['scope must be personal or personal-<name>'] };
      if (!validName(name)) return { errors: ['invalid skill name'] };
      if (content !== undefined && typeof content !== 'string') return { errors: ['content must be a string when provided'] };

      const scopeDir = path.join(libraryDir, scope);
      const skillDir = path.join(scopeDir, name);
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (fs.existsSync(skillDir)) return { errors: [`skills/${scope}/${name} already exists`] };

      const initial = typeof content === 'string'
        ? content
        : `---\nname: ${name}\ndescription: TODO\n---\n\n# ${name}\n\nDescribe what this skill does and when to use it.\n`;

      await fsp.mkdir(skillDir, { recursive: true });
      await fsp.writeFile(skillFile, initial, 'utf8');
      personalGitSnapshot(scope, `create ${name}`);
      return { ok: true, scope, name, path: `skills/${scope}/${name}/SKILL.md` };
    },

    async savePersonalSkillContent({ scope, name, content }) {
      if (!isPersonalScope(scope)) return { errors: ['scope must be personal or personal-<name>'] };
      if (!validName(name)) return { errors: ['invalid skill name'] };
      if (typeof content !== 'string') return { errors: ['content must be a string'] };

      const skillFile = path.join(libraryDir, scope, name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) return { errors: [`skill not found: skills/${scope}/${name}/SKILL.md`] };

      await fsp.writeFile(skillFile, content, 'utf8');
      personalGitSnapshot(scope, `customize ${name}`);
      return { ok: true, scope, name, path: `skills/${scope}/${name}/SKILL.md`, mtime: (await fsp.stat(skillFile)).mtimeMs };
    },

    marketplace,
    installFromMarketplace,

    // Update check for marketplace-installed skills: compares the pinned
    // install sha against the current branch head; flags local edits.
    async checkUpdates() {
      const results = [];
      for (const scope of scopeNames()) {
        for (const name of librarySkillDirs(scope)) {
          const metaFile = path.join(libraryDir, scope, name, '.install.json');
          if (!fs.existsSync(metaFile)) continue;
          let meta = {};
          try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
          const entry = { scope, name, source: meta.source || null, installedAt: meta.installedAt || null, sha: meta.sha || null };
          let localModified = false;
          try {
            const st = fs.statSync(path.join(libraryDir, scope, name, 'SKILL.md'));
            localModified = Boolean(meta.installedAt) && st.mtime.toISOString() > meta.installedAt;
          } catch {}
          entry.localModified = localModified;
          if (!meta.owner || !meta.repo || !meta.ref || !meta.sha) {
            entry.status = 'unpinned'; // pre-contract install — reinstall to pin
          } else {
            const head = await resolveHeadSha(meta.owner, meta.repo, meta.ref);
            if (!head) entry.status = 'unknown'; // offline or repo gone
            else entry.status = head === meta.sha ? 'current' : 'update_available';
            entry.headSha = head;
          }
          results.push(entry);
        }
      }
      return { skills: results, checkedAt: new Date().toISOString() };
    },
  };
}
