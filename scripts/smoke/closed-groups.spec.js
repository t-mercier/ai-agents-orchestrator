// Groups, manual order and drag were a Running-tab feature. The Closed tab now has its
// own, kept apart from Running's: the same category name holds other sessions there.
const { test, expect } = require('@playwright/test')

async function withTwoClosedFeat(page) {
  await page.setViewportSize({ width: 1400, height: 1600 })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(async () => {
    try { localStorage.removeItem('csm.listorg') } catch {}
    if (viewMode !== 'list') setViewMode('list')
    const orig = window.api.getHistoricalSessions
    window.api.getHistoricalSessions = async (tab) => {
      const list = await orig(tab)
      if (tab !== 'closed') return list
      const base = list.find(s => s.category === 'FEAT')
      return [...list, { ...base, name: 'pdf-fonts', sessionId: 'closed-pdf-fonts',
        notesPath: '/Users/dev/work/FEAT/pdf-fonts/notes.md' }]
    }
    switchTab('closed')
    await fetchAndRender(true)
  })
}

test('on the Closed tab, a card dropped on another makes a group that stays there', async ({ page }) => {
  await withTwoClosedFeat(page)
  const body = page.locator('[data-drop-key="cat:closed:FEAT"]')
  await expect(body, 'Closed categories accept drops').toHaveCount(1)
  const cards = body.locator(':scope > .list-drag-item')
  await expect(cards).toHaveCount(2)
  const a = await cards.nth(0).boundingBox(), b = await cards.nth(1).boundingBox()
  await page.mouse.move(a.x + 60, a.y + 12)
  await page.mouse.down()
  await page.mouse.move(a.x + 60, a.y + 30, { steps: 3 })
  await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(body.locator('.list-group')).toHaveCount(1)
  // Its own bucket: Running's FEAT is untouched.
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('csm.listorg')))
  expect(Object.keys(st.categories['closed:FEAT'].groups)).toHaveLength(1)
  expect((st.categories.FEAT || { groups: {} }).groups).toEqual({})
  // And it survives the next poll of the Closed tab.
  await page.evaluate(() => fetchAndRender(false))
  await expect(page.locator('[data-drop-key="cat:closed:FEAT"] .list-group')).toHaveCount(1)
})

test('with two spaces, a group in one space does not show up in the other', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1800 })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  const r = await page.evaluate(async () => {
    try { localStorage.removeItem('csm.listorg') } catch {}
    if (viewMode !== 'list') setViewMode('list')
    window.CSM_CONFIG.roots = [{ name: 'Work', path: '/Users/dev/work' }, { name: 'Perso', path: '/Users/dev/perso' }]
    const base = (await window.api.getSessions()).find(s => s.category === 'FEAT')
    const mk = (root, x) => ({ ...base, root, name: `${root}-${x}`, sessionId: `${root}-${x}`,
      notesPath: `/Users/dev/${root.toLowerCase()}/AI-SYSTEM/${x}/notes.md`, category: 'AI-SYSTEM', status: 'idle' })
    const extra = [mk('Work', 'a'), mk('Work', 'b'), mk('Perso', 'c'), mk('Perso', 'd')]
    const orig = window.api.getSessions
    window.api.getSessions = async (...a) => [...(await orig(...a)), ...extra]
    await fetchAndRender(true)
    const O = window.CSMListOrg
    O.save(O.createGroupWith(O.load(), O.bucketName('running', 'Work', 'AI-SYSTEM', true), 'lg-w',
      ['/Users/dev/work/AI-SYSTEM/a/notes.md', '/Users/dev/work/AI-SYSTEM/b/notes.md'], 0))
    await fetchAndRender(false)
    const groupsIn = (key) => document.querySelectorAll(`[data-drop-key="cat:${key}"] .list-group`).length
    return { work: groupsIn('Work/AI-SYSTEM'), perso: groupsIn('Perso/AI-SYSTEM') }
  })
  expect(r).toEqual({ work: 1, perso: 0 })
})
