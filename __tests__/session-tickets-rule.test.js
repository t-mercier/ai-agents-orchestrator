// The tickets a session carries are the one it is dedicated to, plus the ones it CREATED.
// Shipped: a session started for GOSDK-225187 was given the three tickets Jira links to
// it, written into notes.md by the session that started it, and save/close/wrap-session
// accepted any ticket "identified" in the conversation. The four skills now say so.
const fs = require('fs')
const path = require('path')
const read = (s) => fs.readFileSync(path.join(__dirname, '..', 'skills', s, 'SKILL.md'), 'utf8')

describe.each(['save-session', 'close-session', 'wrap-session'])('%s', (skill) => {
  test('adds only tickets the session created, never ones it only saw', () => {
    const t = read(skill)
    expect(t).not.toMatch(/created\/identified/)
    expect(t).toMatch(/tickets? this session created/i)
    expect(t).toMatch(/only read, linked, mentioned/i)
  })
})

test('start-session writes the ticket it was given, and no other', () => {
  const t = read('start-session')
  expect(t).toMatch(/Write only the ticket passed as an argument/)
})
