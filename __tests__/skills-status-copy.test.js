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

describe('launchNoticeText — the notice she actually reads at launch', () => {
  const { launchNoticeText } = require('../renderer/lib/skills-status-copy')

  // The 0.17.0 launch said: "Skills updated for this version: close-session, save-session,
  // wrap-session — nothing to do. close-session, save-session, wrap-session had been edited
  // and were restored…" — the same three names twice, and "nothing to do" announced right
  // before saying something had been undone.
  it('never names the same skill as both routine and restored', () => {
    const out = launchNoticeText({
      updated: ['close-session', 'save-session', 'wrap-session'],
      restored: ['close-session', 'save-session', 'wrap-session'],
    })
    expect(out.match(/save-session/g)).toHaveLength(1)
    expect(out).not.toMatch(/nothing to do/)
    expect(out).toMatch(/put back to this version/)
  })

  it('leads with the restore, then lists the rest as a receipt', () => {
    const out = launchNoticeText({ updated: ['sync-refs', 'save-session'], restored: ['save-session'] })
    expect(out.indexOf('save-session')).toBeLessThan(out.indexOf('sync-refs'))
    expect(out).toMatch(/Also updated: sync-refs — nothing to do\./)
  })

  it('is a plain receipt when nothing was touched by hand', () => {
    expect(launchNoticeText({ updated: ['sync-refs'] }))
      .toBe('Skills updated for this version: sync-refs — nothing to do.')
  })

  it('agrees in number for a single restored skill', () => {
    expect(launchNoticeText({ restored: ['save-session'] })).toMatch(/save-session had been edited outside the app and was put back/)
  })

  it('drops the shared lib, which is not a skill anyone invokes', () => {
    expect(launchNoticeText({ installed: ['lib', 'learn'] })).toBe('Skills updated for this version: learn — nothing to do.')
  })

  it('says nothing at all when there is nothing to say', () => {
    expect(launchNoticeText({})).toBe('')
    expect(launchNoticeText()).toBe('')
  })
})
