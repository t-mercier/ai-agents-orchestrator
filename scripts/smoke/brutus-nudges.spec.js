// Brutus nudges: the bubble, Open, Not now, the stale list, and the template fallback.
const { test, expect } = require('@playwright/test')

async function boot(page) {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}
const nudge = (page, n) => page.evaluate((n) => window.CSMBrutusUI.showNudge(n), n)

test('a nudge shows as a bubble with its session as a chip', async ({ page }) => {
  await boot(page)
  await nudge(page, { text: '[[session:checkout-redesign]] is waiting on your answer.', stale: [] })
  const b = page.locator('.bru-nudge')
  await expect(b).toBeVisible()
  await expect(b.locator('.bru-chip')).toHaveText('checkout-redesign')
})

test('Open unfolds the recap into the conversation', async ({ page }) => {
  await boot(page)
  await nudge(page, { text: 'Line one.\nLine two.\nLine three.\nLine four.\nLine five.\nLine six.\nLine seven.', stale: [] })
  await expect(page.locator('.bru-nudge')).toContainText('… and 1 more thing')
  await page.locator('.bru-nudge [data-bru="nudge-open"]').click()
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
  await expect(page.locator('.bru-panel .bru-body')).toContainText('Line seven.')
})

test('"Want me to list them?" lists the stale sessions without a model call', async ({ page }) => {
  await boot(page)
  await nudge(page, { text: '1 session has not moved for more than 3 days — want me to list them?',
    stale: [{ session: 'legacy-export', at: Date.now() - 4 * 86400_000, step: 'Map the remaining three column headers' }] })
  await page.locator('.bru-nudge [data-bru="nudge-open"]').click()
  await page.locator('[data-bru="nudge-list"]').click()
  await expect(page.locator('.bru-panel .bru-body')).toContainText('Map the remaining three column headers')
  await expect(page.locator('.bru-panel .bru-body .bru-chip', { hasText: 'legacy-export' })).toBeVisible()
})

test('Not now closes the bubble', async ({ page }) => {
  await boot(page)
  await nudge(page, { text: 'Something.', stale: [] })
  await page.locator('.bru-nudge [data-bru="nudge-later"]').click()
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
})

test('note text in a nudge is escaped', async ({ page }) => {
  await boot(page)
  await nudge(page, { text: 'For [[session:checkout-redesign]]: <img src=x onerror="window.__XSS__=1">', stale: [] })
  await expect(page.locator('.bru-nudge')).toContainText('<img src=x')
  expect(await page.evaluate(() => window.__XSS__)).toBeUndefined()
})

test('the reply after a recap reaches Brutus with the recap as context', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.__ASKED__ = []; const a = window.api.brutusAsk; window.api.brutusAsk = (m) => { window.__ASKED__.push(m); return a(m) } })
  await nudge(page, { text: '[[session:checkout-redesign]] is waiting on your answer.', stale: [] })
  await page.locator('.bru-nudge [data-bru="nudge-open"]').click()
  await page.locator('.bru-panel input').fill('why is it waiting?')
  await page.locator('.bru-panel input').press('Enter')
  const asked = await page.evaluate(() => window.__ASKED__[0])
  expect(asked).toContain('you just told the person')
  expect(asked.endsWith('why is it waiting?')).toBe(true)
  await expect(page.locator('.bru-panel .bru-u').last()).toHaveText('why is it waiting?')
})

async function seedWaiting(page) {
  await page.evaluate(() => {
    // A waiting session's last activity does not move while it waits.
    const at = new Date(Date.now() - 60_000).toISOString()
    window.api.getSessions = async () => [{ name: 'checkout-redesign', notesPath: '/w/c/notes.md', state: 'active',
      status: 'waiting', lastActivityAt: at, nextSteps: '- [ ] 👤 capture on the Nothing', prLinks: [], ticketStates: [] }]
    window.api.getHistoricalAll = async () => ({ stale: [], closed: [], archived: [] })
  })
}

test('the morning run shows Haiku\'s wording and remembers what it said', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => window.CSMNudges.run('morning'))
  await expect(page.locator('.bru-nudge')).toContainText('is waiting on your answer')
  const saved = await page.evaluate(() => window.__LAST_NUDGE_SAVE__)
  expect(Object.keys(saved.said).some(k => k.startsWith('waiting|/w/c/notes.md|'))).toBe(true)
  expect(saved.lastFacts.length).toBeGreaterThan(0)
})

test('a failed Haiku run falls back to the templates', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => { window.__NUDGE_FAIL__ = true; return window.CSMNudges.run('morning') })
  const b = page.locator('.bru-nudge')
  await expect(b).toContainText('For checkout-redesign:')
  await expect(b.locator('li')).toContainText('capture on the Nothing')
})

test('a second run with nothing new says nothing', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => window.CSMNudges.run('morning'))
  await page.locator('.bru-nudge [data-bru="nudge-later"]').click()
  await page.evaluate(() => window.CSMNudges.run('back'))
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
})

test('nudges turned off in Settings say nothing', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  // The launch counts as arriving, so a launch nudge may already be up: clear it first.
  await page.evaluate(() => window.CSMNudges.run('morning'))
  await page.locator('.bru-nudge [data-bru="nudge-later"]').click()
  await page.evaluate(() => { window.CSM_CONFIG.assistant = { ...(window.CSM_CONFIG.assistant || {}), nudges: false }; window.CSMNudges.state().said = {}; return window.CSMNudges.run('morning') })
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
})

test('Settings → Assistant saves the three nudge settings', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => window.openSettingsTab('assistant'))
  await page.locator('#set-assistant-nudges').uncheck()
  await page.locator('#set-assistant-stale').fill('5')
  await page.locator('#set-assistant-quiet-from').fill('22:00')
  await page.locator('#set-assistant-quiet-to').fill('07:00')
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.__LAST_SET_CONFIG__?.assistant?.nudges)).toBe(false)
  const a = await page.evaluate(() => window.__LAST_SET_CONFIG__.assistant)
  expect(a).toMatchObject({ nudges: false, staleDays: 5, quietHours: { from: '22:00', to: '07:00' } })
})

test('a run in quiet hours keeps the baseline, so the recap waits for the window to end', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  const before = await page.evaluate(() => window.CSMNudges.state().lastVisit)
  await page.evaluate(() => {
    const d = new Date(), hh = (h) => String((h + 24) % 24).padStart(2, '0') + ':00'
    window.CSM_CONFIG.assistant = { ...(window.CSM_CONFIG.assistant || {}), quietHours: { from: hh(d.getHours() - 1), to: hh(d.getHours() + 1) } }
    return window.CSMNudges.run('morning')
  })
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
  expect(await page.evaluate(() => window.CSMNudges.state().lastVisit)).toBe(before)
})

test('with nudges off, leaving the app writes nothing', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.__LAST_NUDGE_SAVE__ = undefined; window.CSM_CONFIG.assistant = { ...(window.CSM_CONFIG.assistant || {}), nudges: false }; window.dispatchEvent(new Event('blur')) })
  await page.evaluate(() => window.CSMNudges.settled())
  expect(await page.evaluate(() => window.__LAST_NUDGE_SAVE__)).toBeUndefined()
})

test('two runs at once take turns: the second starts once the first is worded', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => {
    window.__CALLS__ = 0; window.__GATHERS__ = 0
    const g = window.api.getSessions; window.api.getSessions = () => { window.__GATHERS__++; return g() }
    const f = window.api.brutusNudge
    window.api.brutusNudge = (p) => { window.__CALLS__++; return new Promise(r => { window.__RELEASE__ = () => r(f(p)) }) }
    window.__BOTH__ = Promise.all([window.CSMNudges.run('morning'), window.CSMNudges.run('morning')])
  })
  await expect.poll(() => page.evaluate(() => window.__CALLS__)).toBe(1)
  expect(await page.evaluate(() => window.__GATHERS__)).toBe(1)
  await page.evaluate(() => { window.__RELEASE__(); return window.__BOTH__ })
  expect(await page.evaluate(() => [window.__CALLS__, window.__GATHERS__])).toEqual([1, 2])
})

test('a second nudge joins an unread one instead of replacing it', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.CSMBrutusUI.showNudge({ text: 'First thing.', stale: [] }); window.CSMBrutusUI.showNudge({ text: 'Second thing.', stale: [] }) })
  await expect(page.locator('.bru-nudge')).toContainText('First thing.')
  await expect(page.locator('.bru-nudge')).toContainText('Second thing.')
})

test('a stale step cannot make a chip in the list', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => window.CSMBrutusUI.showNudge({ text: 'Stale ones.', stale: [{ session: 'legacy-export', at: Date.now(), step: 'see [[session:payments-api]]' }] }))
  await page.locator('.bru-nudge [data-bru="nudge-open"]').click()
  await page.locator('[data-bru="nudge-list"]').click()
  await expect(page.locator('.bru-panel .bru-body .bru-chip', { hasText: 'legacy-export' })).toBeVisible()
  await expect(page.locator('.bru-panel .bru-body')).toContainText('see [')
  await expect(page.locator('.bru-panel .bru-body .bru-chip', { hasText: 'payments-api' })).toHaveCount(0)
})

test('the poll watches every running session, not the search-filtered list', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.__POLLED__ = []; const f = window.CSMNudges.onPoll; window.CSMNudges.onPoll = (s) => { window.__POLLED__.push(s.length); return f(s) } })
  await page.locator('#search-field').fill('checkout')
  // The fixture stops the app's timers once the scene is set, so the test makes the poll's call.
  await page.evaluate(() => window.nudgePoll())
  const shown = await page.locator('#panel-list .list-card').count()
  expect(await page.evaluate(() => window.__POLLED__.at(-1))).toBeGreaterThan(shown)
})

test('a save drops what is no longer true and older than a week', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => { window.CSMNudges.state().said['old|x'] = '2020-01-01'; return window.CSMNudges.run('morning') })
  const saved = await page.evaluate(() => window.__LAST_NUDGE_SAVE__)
  expect(saved.said['old|x']).toBeUndefined()
})

async function seed(page, sessions) {
  await page.evaluate((list) => {
    window.api.getSessions = async () => list
    window.api.getHistoricalAll = async () => ({ stale: [], closed: [], archived: [] })
  }, sessions)
}
// An hour before the run, so the session is never stale whatever the day the suite runs.
const AN_HOUR_AGO = new Date(Date.now() - 3600_000).toISOString()
const session = (name, status, step) => ({ name, notesPath: `/w/${name}/notes.md`, state: 'active', status,
  lastActivityAt: AN_HOUR_AGO, nextSteps: step ? `- [ ] 👤 ${step}` : '', prLinks: [], ticketStates: [] })

test('cases that move during the 2 minutes are said together, in one bubble and one run', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.__NUDGE_FAIL__ = true; window.__CALLS__ = 0; const f = window.api.brutusNudge; window.api.brutusNudge = (p) => { window.__CALLS__++; return f(p) } })
  const poll = (list) => page.evaluate((l) => window.CSMNudges.onPoll(l), list)
  await poll([session('checkout-redesign', 'busy'), session('payments-api', 'busy')])
  await poll([session('checkout-redesign', 'waiting'), session('payments-api', 'busy')])
  await poll([session('checkout-redesign', 'waiting'), session('payments-api', 'waiting')])
  await page.evaluate(() => window.CSMNudges.flushMoved())
  const b = page.locator('.bru-nudge')
  await expect(b).toHaveCount(1)
  await expect(b).toContainText('checkout-redesign is waiting on your answer.')
  await expect(b).toContainText('payments-api is waiting on your answer.')
  expect(await page.evaluate(() => window.__CALLS__)).toBe(1)
})

test('nothing that moved means no batch and no bubble', async ({ page }) => {
  await boot(page)
  const poll = (list) => page.evaluate((l) => window.CSMNudges.onPoll(l), list)
  await poll([session('checkout-redesign', 'busy')])
  await poll([session('checkout-redesign', 'busy')])
  await page.evaluate(() => window.CSMNudges.flushMoved())
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
})

test('back after a 30-minute pause, Brutus says what changed while away', async ({ page }) => {
  await boot(page)
  await seed(page, [session('checkout-redesign', 'waiting')])
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); return window.CSMNudges.settled() })
  await seed(page, [session('checkout-redesign', 'waiting'), session('payments-api', 'waiting')])
  await page.evaluate(() => { window.__NUDGE_FAIL__ = true; return window.CSMNudges.foreground(Date.now() + 31 * 60_000) })
  const b = page.locator('.bru-nudge')
  await expect(b).toContainText('payments-api is waiting on your answer.')
  await expect(b).not.toContainText('checkout-redesign')
})

test('leaving the app twice in a row scans the history once', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.__SCANS__ = 0; window.api.getHistoricalAll = async () => { window.__SCANS__++; return { stale: [], closed: [], archived: [] } } })
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('blur')); return window.CSMNudges.settled() })
  expect(await page.evaluate(() => window.__SCANS__)).toBe(1)
})

test('the poll reads the PR states once a minute, not every 5 seconds', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.__PRS__ = 0; window.api.getPrStatus = async () => { window.__PRS__++; return {} } })
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) await window.CSMNudges.onPoll([]) })
  expect(await page.evaluate(() => window.__PRS__)).toBeLessThanOrEqual(1)
})

test('a wording that names a session outside the facts falls back to the templates', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => { window.__NUDGE_REPLY__ = { message: '[[session:ghost]] needs you.', triage: {} }; return window.CSMNudges.run('morning') })
  const b = page.locator('.bru-nudge')
  await expect(b).toContainText('For checkout-redesign:')
  await expect(b.locator('li')).toContainText('capture on the Nothing')
  await expect(b).not.toContainText('ghost')
})

test('refused because Brutus is answering, the nudge waits for him and asks once more', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => { window.__NUDGE_BUSY__ = 1; return window.CSMNudges.run('morning') })
  await expect(page.locator('.bru-nudge')).toContainText('Morning!')
})

test('a nudge stays pending until it is put away', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => window.CSMNudges.run('morning'))
  expect((await page.evaluate(() => window.__LAST_NUDGE_SAVE__.pending)).text).toContain('is waiting on your answer')
  await page.locator('.bru-nudge [data-bru="nudge-later"]').click()
  await page.evaluate(() => window.CSMNudges.settled())
  expect(await page.evaluate(() => window.__LAST_NUDGE_SAVE__.pending)).toBe(null)
})

test('a nudge the app quit before showing is shown at the next launch', async ({ page }) => {
  await page.addInitScript(() => {
    window.__NUDGE_STATE__ = { said: {}, lastVisit: Date.now(), lastFacts: null, triage: {},
      pending: { text: '[[session:checkout-redesign]] is waiting on your answer.', stale: [], lang: 'en' } }
  })
  await boot(page)
  await expect(page.locator('.bru-nudge')).toContainText('is waiting on your answer')
})

test('the bubble speaks the language of the nudge', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => window.CSMBrutusUI.showNudge({ text: 'Quelque chose.', stale: [], lang: 'fr' }))
  await expect(page.locator('.bru-nudge [data-bru="nudge-open"]')).toHaveText('Ouvrir')
  await expect(page.locator('.bru-nudge [data-bru="nudge-later"]')).toHaveText('Pas maintenant')
})

test('the model\'s "not yours" verdict is not saved; its "yours" is', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => { window.__NUDGE_REPLY__ = { message: '[[session:checkout-redesign]] waits.', triage: { '0a1b2c3d': 'you', '1a2b3c4d': 'agent' } }; return window.CSMNudges.run('morning') })
  expect(await page.evaluate(() => window.__LAST_NUDGE_SAVE__.triage)).toEqual({ '0a1b2c3d': 'you' })
})

test('leaving the app inside quiet hours keeps the baseline, so the morning recap still comes', async ({ page }) => {
  await boot(page)
  const before = await page.evaluate(() => window.CSMNudges.state().lastVisit)
  await page.evaluate(() => {
    window.__LAST_NUDGE_SAVE__ = undefined
    const d = new Date(), hh = (h) => String((h + 24) % 24).padStart(2, '0') + ':00'
    window.CSM_CONFIG.assistant = { ...(window.CSM_CONFIG.assistant || {}), quietHours: { from: hh(d.getHours() - 1), to: hh(d.getHours() + 1) } }
    window.dispatchEvent(new Event('blur'))
    return window.CSMNudges.settled()
  })
  expect(await page.evaluate(() => window.CSMNudges.state().lastVisit)).toBe(before)
  expect(await page.evaluate(() => window.__LAST_NUDGE_SAVE__)).toBeUndefined()
})

test('a session chip opens that session and outlines its card inside the list', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => window.CSMBrutusUI.close())
  await nudge(page, { text: '[[session:checkout-redesign]] is waiting on your answer.', stale: [] })
  await page.locator('.bru-nudge .bru-chip').click()
  const card = page.locator('#panel-list .list-card.selected')
  await expect(card).toContainText('checkout-redesign')
  await expect(card).toHaveClass(/bru-flash/)
  expect(await card.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('none')
  // A second click keeps it open: selectSession toggles, the chip must not.
  await nudge(page, { text: '[[session:checkout-redesign]] again.', stale: [] })
  await page.locator('.bru-nudge .bru-chip').last().click()
  await expect(page.locator('#panel-list .list-card.selected')).toContainText('checkout-redesign')
})

test('the moon in his panel pauses the reminders, and Resume lifts the pause', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => window.CSMBrutusUI.open())
  await page.locator('.bru-panel [data-bru="snooze"]').click()
  await page.locator('.bru-menu button', { hasText: '1 hour' }).click()
  await expect(page.locator('.bru-panel .bru-sub')).toContainText('Quiet until')
  const until = await page.evaluate(() => window.__LAST_NUDGE_SAVE__.snoozeUntil)
  expect(until - Date.now()).toBeGreaterThan(55 * 60_000)
  // Paused: a morning run says nothing.
  await page.evaluate(() => window.CSMBrutusUI.close())
  await page.evaluate(() => window.CSMNudges.run('morning'))
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
  await page.evaluate(() => window.CSMBrutusUI.open())
  await page.locator('.bru-panel [data-bru="unsnooze"]').click()
  await expect(page.locator('.bru-panel .bru-sub')).not.toContainText('Quiet until')
  expect(await page.evaluate(() => window.__LAST_NUDGE_SAVE__.snoozeUntil)).toBe(null)
})

test('a chip naming a closed session opens it in the Closed tab', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => window.CSMBrutusUI.close())
  const name = await page.evaluate(() => ((window._historicalForBrutus || []).find(s => s.state === 'closed') || {}).name)
  expect(name).toBeTruthy()
  await nudge(page, { text: `[[session:${name}]] was closed.`, stale: [] })
  await page.locator('.bru-nudge .bru-chip').click()
  await expect(page.locator('.tab-btn.active')).toHaveAttribute('data-tab', 'closed')
  await expect(page.locator('#panel-list .list-card.selected')).toContainText(name)
})

test('a pause set while a reminder is being worded keeps it from showing', async ({ page }) => {
  await boot(page); await seedWaiting(page)
  await page.evaluate(() => { window.__NUDGE_HOLD__ = true; window.CSMNudges.run('morning') })
  await page.waitForFunction(() => typeof window.__NUDGE_RELEASE__ === 'function')
  await page.evaluate(() => { window.CSMNudges.snooze(Date.now() + 3600_000); window.__NUDGE_RELEASE__() })
  await page.evaluate(() => window.CSMNudges.settled())
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
  // Not recorded as said: it can come up once the pause is over.
  expect(Object.keys(await page.evaluate(() => window.CSMNudges.state().said)).some(k => k.startsWith('waiting|'))).toBe(false)
})

test('the session open in front is not announced when it moves; the others still are', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { window.__NUDGE_FAIL__ = true; window._lastSelectedKey = '/w/checkout-redesign/notes.md' })
  const poll = (list) => page.evaluate((l) => window.CSMNudges.onPoll(l), list)
  await poll([session('checkout-redesign', 'busy'), session('payments-api', 'busy')])
  await poll([session('checkout-redesign', 'waiting'), session('payments-api', 'busy')])
  await page.evaluate(() => window.CSMNudges.flushMoved())
  await expect(page.locator('.bru-nudge')).toHaveCount(0)
  await poll([session('checkout-redesign', 'waiting'), session('payments-api', 'waiting')])
  await page.evaluate(() => window.CSMNudges.flushMoved())
  const b = page.locator('.bru-nudge')
  await expect(b).toContainText('payments-api is waiting on your answer.')
  await expect(b).not.toContainText('checkout-redesign')
})
