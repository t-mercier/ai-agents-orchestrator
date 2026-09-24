// Shell snippets in the bundled session skills. Each guard below fails on a pattern that
// shipped and broke a real session.
const fs = require('fs')
const path = require('path')
const read = (s) => fs.readFileSync(path.join(__dirname, '..', 'skills', s, 'SKILL.md'), 'utf8')

// A category name can exist under several spaces. Looking the vault up by name alone
// resolves the first space listed, so a personal note could land in the company vault.
describe.each(['learn', 'save-session', 'close-session'])('%s vault lookup', (skill) => {
  test('passes the session root to aoconfig vault', () => {
    const t = read(skill)
    expect(t).toMatch(/(aoconfig\.py|"\$LIB") rootof "\$NOTES_PATH"/)
    const calls = t.match(/(aoconfig\.py|"\$LIB") vault [^\n]*/g) || []
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c).toMatch(/\$\{ROOT:\+"\$ROOT"\}/)
  })
})

// The relink fallback searched one base per category NAME, so a session in the second
// space holding that name was never found.
describe.each(['save-session', 'close-session'])('%s relink fallback', (skill) => {
  test('iterates every (root, category) base', () => {
    const t = read(skill)
    expect(t).toMatch(/aoconfig\.py bases/)
    expect(t).not.toMatch(/aoconfig\.py base "\$cat"/)
  })
})

// Registration heredocs were unquoted `<<EOF` with values spliced into single-quoted
// Python literals, so a name like "Fix user's crash" raised a SyntaxError after the
// notes.md was already written: the session was never registered, and a retry refused.
const os = require('os')
const { execFileSync } = require('child_process')

const bashBlock = (skill, heading) => {
  const t = read(skill)
  const at = t.indexOf(heading)
  if (at < 0) throw new Error(`${skill}: heading not found: ${heading}`)
  const m = t.slice(at).match(/```bash\n([\s\S]*?)\n```/)
  return m[1]
}
const scratchHome = () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-skill-'))
  fs.mkdirSync(path.join(h, '.claude'))
  return h
}
const run = (script, home, env) =>
  execFileSync('bash', ['-c', script], { env: { ...process.env, HOME: home, ...env }, encoding: 'utf8' })
const registry = (home) => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'active-sessions.json'), 'utf8'))

const NAME = "Fix user's crash"
const NOTES = "/x/FEAT/fix-l'import/notes.md"

describe.each([
  ['start-session', '## Step 7 — Register in active-sessions.json'],
  ['import-session', '## Step 6 — Register in active-sessions.json'],
  ['restart-session', '### Step 4 — Register in active-sessions.json'],
])('%s registration', (skill, heading) => {
  test('registers a name and path containing an apostrophe', () => {
    const home = scratchHome()
    // restart-session reads these from the frontmatter: substitute as the model would.
    const script = bashBlock(skill, heading)
      .replace('<CATEGORY from frontmatter>', 'FEAT')
      .replace('<TICKET from frontmatter>', '')
      .replace('<NAME from frontmatter>', NAME)
    run(script, home, { SESSION_ID: 'sid-1', NOTES_PATH: NOTES, CATEGORY: 'FEAT', TICKET: '', NAME, NOW: '2026-09-24 10:00' })
    const e = registry(home)['sid-1']
    expect(e.name).toBe(NAME)
    expect(e.notes_path).toBe(NOTES)
    expect(e.category).toBe('FEAT')
  })
})

test('archive-session removes a registered path containing an apostrophe', () => {
  const home = scratchHome()
  fs.writeFileSync(path.join(home, '.claude', 'active-sessions.json'),
    JSON.stringify({ a: { notes_path: NOTES }, b: { notes_path: '/other/notes.md' } }))
  run(bashBlock('archive-session', '## Step 5 — Remove from active-sessions.json'), home, { NOTES_PATH: NOTES })
  expect(Object.keys(registry(home))).toEqual(['b'])
})
