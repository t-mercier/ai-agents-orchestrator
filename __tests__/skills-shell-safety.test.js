// Shell snippets in the bundled session skills. Each guard below fails on a pattern that
// shipped and broke a real session.
const fs = require('fs')
const path = require('path')
const read = (s) => fs.readFileSync(path.join(__dirname, '..', 'skills', s, 'SKILL.md'), 'utf8')

// A category name can exist under several spaces. Looking the vault up by name alone
// resolves the first space listed, so a personal note could land in the company vault.
describe.each(['learn', 'save-session', 'close-session', 'route'])('%s vault lookup', (skill) => {
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

// With no tickets the branch pattern was "", which matches every branch: every PR in the
// repository (up to 60) was attached to the session, permanently.
describe('sync-refs branch match', () => {
  const block = bashBlock('sync-refs', '## Step 3 — Pull requests')
  const prs = JSON.stringify([
    { number: 1, url: 'https://github.com/o/r/pull/1', headRefName: 'fix/GOSDK-1-a', title: 'a' },
    { number: 2, url: 'https://github.com/o/r/pull/2', headRefName: 'feat/other', title: 'b' },
  ])
  const withTickets = (t) =>
    `gh() { printf '%s' '${prs}'; }\n` + block.replace(/^TICKETS=.*$/m, `TICKETS='${t}'`)
  test('attaches nothing when the session has no tickets', () => {
    expect(run(withTickets(''), os.tmpdir(), {}).trim()).toBe('')
  })
  test('still matches branches naming a ticket', () => {
    const out = [...new Set(run(withTickets('GOSDK-1'), os.tmpdir(), {}).trim().split('\n'))]
    expect(out).toEqual(['https://github.com/o/r/pull/1'])
  })
})

// wrap-session runs headless, possibly in a checkout now on another branch: a bare
// `gh pr view` attached that branch's PR to the session, forever.
test('wrap-session looks up the PR of the branch recorded in the notes', () => {
  const t = read('wrap-session')
  expect(t).toMatch(/gh pr view "\$BRANCH" --json url -q \.url/)
  expect(t).not.toMatch(/gh pr view --json/)
})

// restart-session checked out origin/<branch> before fetching, so a branch pushed after
// the last local fetch failed with "not a commit" and the user was told to stash.
test('restart-session checks out a branch pushed after the last fetch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-restart-'))
  const env = {
    ...process.env, HOME: dir, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  }
  const sh = (cmd, cwd) => execFileSync('bash', ['-c', cmd], { cwd, env, encoding: 'utf8', stdio: 'pipe' })
  sh('git init -q --bare -b main origin.git && git clone -q origin.git a 2>/dev/null && cd a && git commit -q --allow-empty -m init && git push -q origin main && cd .. && git clone -q origin.git b', dir)
  sh('git checkout -q -b feat && git commit -q --allow-empty -m f && git push -q origin feat', path.join(dir, 'b'))
  const script = bashBlock('restart-session', '### Step 5 — Git sync')
    .replace('<BRANCH from Step 2 frontmatter>', 'feat')
  sh(script, path.join(dir, 'a'))
  expect(sh('git branch --show-current', path.join(dir, 'a')).trim()).toBe('feat')
})

// The dashboard passes `--root "<space name>"` double-quoted, and a space name may hold
// spaces ("My Perso"). Reading `--root <space>` as one token kept "My" and left "Perso" in NAME.
describe.each(['start-session', 'import-session'])('%s --root', (skill) => {
  test('accepts a double-quoted space name that may contain spaces', () => {
    const t = read(skill)
    expect(t).toMatch(/--root "<space>"/)
    expect(t).toMatch(/double-quoted[^\n]*spaces/i)
    expect(t).not.toMatch(/--root <space>/)
  })
})

// The app passes the category in its configured spelling (a lowercase `bugs` exists).
// Uppercasing it named a folder and a category that do not exist.
describe.each(['start-session', 'import-session'])('%s category spelling', (skill) => {
  test('matches case-insensitively and keeps the configured spelling', () => {
    const t = read(skill)
    expect(t).not.toMatch(/`CATEGORY` — uppercase it/)
    expect(t).toMatch(/`CATEGORY` — match it case-insensitively/)
    expect(t).toMatch(/keep the configured spelling/)
  })
})

// +New's "Start in" folder was used to launch and then forgotten, so Resume went back to
// the space root and the session worked in the wrong folder. The skill records it.
describe('start-session --start-in', () => {
  test('captures the double-quoted folder, strips it from NAME and writes start_in:', () => {
    const t = read('start-session')
    expect(t).toMatch(/--start-in "<dir>"/)
    expect(t).toMatch(/strip[^\n]*--start-in/i)
    expect(t).toMatch(/^start_in: <START_IN/m)
  })
})
