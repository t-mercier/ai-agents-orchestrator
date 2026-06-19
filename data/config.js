const fs = require('fs')
const path = require('path')
const os = require('os')

// App preferences (NOT session state — this is the app's own config, so writing
// it does not violate the read-only-of-~/.claude invariant, ADR-001/013).
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config', 'ai-agents-orchestrator', 'config.json')

// Generic shipped defaults — a sensible starting set, NOT user-specific. Personal
// categories (e.g. CPM, AI-SYSTEM) are added by each user via Settings; the
// installer never overwrites an existing config, so an upgrading user keeps theirs.
const DEFAULTS = {
  version: 1,
  workRoot: path.join(os.homedir(), 'work'),
  categories: [
    { name: 'FEAT', color: '#7df0c0', scope: 'work' },
    { name: 'BUG', color: '#ff9eb1', scope: 'work' },
    { name: 'REVIEW', color: '#d9a86e', scope: 'work' },
    { name: 'CHORE', color: '#ffe17a', scope: 'work' },
    { name: 'TEST', color: '#cdd0d6', scope: 'work' },
    { name: 'PERSO', color: '#8fd9ff', scope: 'personal' },
  ],
  obsidian: { enabled: false, vaultPath: '' },
  // Issue-tracker browse prefix; if empty, tickets show as plain text (no link).
  // e.g. "https://yourcompany.atlassian.net/browse/"
  jiraBaseUrl: '',
}

function expandHome(p) {
  if (typeof p !== 'string') return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

function load(configPath = DEFAULT_CONFIG_PATH) {
  let user = {}
  try {
    if (fs.existsSync(configPath)) user = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch { user = {} }  // malformed → defaults

  const merged = {
    version: DEFAULTS.version,
    workRoot: expandHome(user.workRoot || DEFAULTS.workRoot),
    categories: Array.isArray(user.categories) && user.categories.length ? user.categories : DEFAULTS.categories,
    obsidian: { ...DEFAULTS.obsidian, ...(user.obsidian || {}) },
    jiraBaseUrl: typeof user.jiraBaseUrl === 'string' ? user.jiraBaseUrl : DEFAULTS.jiraBaseUrl,
  }

  merged.scanDirs = merged.categories.map(c => ({
    category: c.name,
    base: c.scope === 'personal'
      ? path.join(os.homedir(), c.name)
      : path.join(merged.workRoot, c.name),
  }))
  merged.order = merged.categories.map(c => c.name)
  merged.colorMap = Object.fromEntries(merged.categories.map(c => [c.name, c.color]))
  return merged
}

function validate(c) {
  if (!c || typeof c !== 'object') return { ok: false, error: 'not an object' }
  if (!Array.isArray(c.categories) || c.categories.length === 0) return { ok: false, error: 'categories required' }
  for (const cat of c.categories) {
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(cat.name || '')) return { ok: false, error: `bad category name: ${cat.name}` }
    if (!/^#[0-9a-fA-F]{6}$/.test(cat.color || '')) return { ok: false, error: `bad color: ${cat.color}` }
    if (cat.scope !== 'work' && cat.scope !== 'personal') return { ok: false, error: `bad scope: ${cat.scope}` }
  }
  if (c.obsidian && typeof c.obsidian.vaultPath !== 'string') return { ok: false, error: 'bad vaultPath' }
  return { ok: true }
}

function save(cfg, configPath = DEFAULT_CONFIG_PATH) {
  const v = validate(cfg)
  if (!v.ok) return v
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2))
  fs.renameSync(tmp, configPath)   // atomic
  return { ok: true }
}

module.exports = { load, save, validate, DEFAULTS, DEFAULT_CONFIG_PATH, expandHome }
