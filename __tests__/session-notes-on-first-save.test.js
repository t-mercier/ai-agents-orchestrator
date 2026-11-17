// A session opened outside the dashboard (Claude desktop, a bare `claude` in a shell) never
// ran /start-session, so it has no notes.md. save-session and close-session used to stop
// there and send the user to /start-session; the first checkpoint now creates the notes.
const fs = require('fs')
const path = require('path')
const read = (s) => fs.readFileSync(path.join(__dirname, '..', 'skills', s, 'SKILL.md'), 'utf8')

describe.each(['save-session', 'close-session'])('%s without registered notes', (skill) => {
  test('does not send the user to /start-session', () => {
    expect(read(skill)).not.toMatch(/run `\/start-session` \(new\)/)
  })
})

describe('save-session Step 2b', () => {
  const t = read('save-session')
  const at = t.indexOf('## Step 2b — No notes yet')
  const step = at < 0 ? '' : t.slice(at, t.indexOf('## Step 3 —'))

  test('exists, between Step 2 and Step 3', () => {
    expect(at).toBeGreaterThan(t.indexOf('## Step 2 —'))
    expect(step.length).toBeGreaterThan(0)
  })
  test('reuses the start-session template instead of carrying a second one', () => {
    expect(step).toMatch(/`\/start-session` Steps? /)
    expect(step).not.toMatch(/^## Decisions made/m)
  })
  test('never overwrites a notes.md that is already there', () => {
    expect(step).toMatch(/never overwrite/i)
  })
  test('leaves out what belongs to a terminal: git sync and rename', () => {
    expect(step).toMatch(/Skip[^\n]*Step 8[^\n]*Step 9/)
  })
})

test('close-session creates the notes the same way save-session does', () => {
  expect(read('close-session')).toMatch(/`\/save-session` Step 2b/)
})
