const S = require('../renderer/lib/skills-status-copy')

describe('syncResultText', () => {
  it('names installed, updated and restored skills', () => {
    const text = S.syncResultText({
      skipped_ahead: false,
      installed: ['lib', 'new-one'],
      updated: ['close-session', 'start-session'],
      restored: ['start-session'],
    })
    expect(text).toContain('Installed 1 new skill: new-one.')
    expect(text).not.toContain('lib') // filtered out — not a slash-command skill
    expect(text).toContain('Updated 2 to this app version: close-session, start-session.')
    expect(text).toContain('start-session had been edited and was restored')
  })

  it('pluralises the restored sentence', () => {
    const text = S.syncResultText({
      installed: [],
      updated: ['a', 'b'],
      restored: ['a', 'b'],
    })
    expect(text).toContain('a, b had been edited and were restored')
  })

  it('reports a stood-down sync as such, not as "up to date"', () => {
    // skipped_ahead is the developer case: install.sh ran after this app was built.
    // "Already up to date" would be wrong — the disk is AHEAD, not merely current.
    const text = S.syncResultText({ skipped_ahead: true, installed: [], updated: [], restored: [] })
    expect(text).toMatch(/already at \(or past\) this app version/)
  })

  it('says "already up to date" when nothing happened', () => {
    expect(S.syncResultText({ installed: ['lib'], updated: [], restored: [] }))
      .toBe('Already up to date.')
  })

  it('tolerates missing fields entirely', () => {
    expect(S.syncResultText({})).toBe('Already up to date.')
  })
})
