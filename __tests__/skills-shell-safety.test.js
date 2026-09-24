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
