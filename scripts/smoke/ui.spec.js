// Regression smoke tests for the renderer.
//
// Every assertion here corresponds to a defect that actually shipped, or nearly did.
// The rule for adding one: it earns its place when a human found the bug by looking at
// the window. Anything provable from pure data belongs in a jest test instead.
const { test, expect } = require('@playwright/test')

// serve.py injects scripts/screenshots/fixture.js into the page, which stubs
// window.__TAURI__ and feeds the renderer a synthetic set of sessions. The fixture
// signals __SHOT_READY__ once its scene has run and it has frozen the poll timers,
// which is what makes these assertions deterministic.
test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.__errors = errors
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
})

test('the app boots and renders its sessions, with no uncaught error', async ({ page }) => {
  // Scoped to the list: Settings' Appearance tab holds a sample card of its own, which
  // is in the DOM but hidden while the dialog is closed.
  const cards = page.locator('#panel-list .list-card[data-key]')
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBeGreaterThan(2)
  expect(page.__errors).toEqual([])
})

test('the settings dialog is invisible until it is opened', async ({ page }) => {
  // Shipped once: `#settings-modal { display: flex }` overrode the UA's
  // `dialog:not([open]) { display: none }`, so the app opened behind a panel that
  // nothing could close — it had never been opened, so Esc and Cancel had no target.
  const dlg = page.locator('#settings-modal')
  await expect(dlg).toBeHidden()
  expect(await dlg.evaluate((d) => getComputedStyle(d).display)).toBe('none')
  expect(await dlg.evaluate((d) => d.getBoundingClientRect().height)).toBe(0)
})

test('a long settings panel scrolls, and Save stays inside the dialog', async ({ page }) => {
  // Shipped: one stray </div> closed .settings-panels after the Appearance panel, so
  // Categories and four others sat outside the scroll container. Their content was
  // clipped in silence and the Save row pushed out of the box.
  await page.evaluate(() => {
    document.getElementById('settings-modal').showModal()
    document.querySelector('[data-settings-tab="categories"]')?.click()
  })
  const inScroller = await page.evaluate(() => {
    const dlg = document.getElementById('settings-modal')
    return dlg.querySelector('.settings-panel.active').parentElement === dlg.querySelector('.settings-panels')
  })
  expect(inScroller, 'the active panel must live inside .settings-panels').toBe(true)

  const m = await page.evaluate(() => {
    const dlg = document.getElementById('settings-modal')
    const panels = dlg.querySelector('.settings-panels')
    const pad = document.createElement('div')
    for (let i = 0; i < 40; i++) {
      const d = document.createElement('div'); d.style.height = '34px'; d.textContent = 'x'; pad.appendChild(d)
    }
    dlg.querySelector('.settings-panel.active').appendChild(pad)
    const r = dlg.getBoundingClientRect()
    const acts = dlg.querySelector('.modal-actions').getBoundingClientRect()
    return {
      scrolls: panels.scrollHeight > panels.clientHeight + 2,
      saveInside: acts.bottom <= r.bottom + 1 && acts.top >= r.top,
      fitsWindow: r.bottom <= window.innerHeight + 1,
      gutter: panels.offsetWidth - panels.clientWidth,
    }
  })
  expect(m.scrolls, 'content taller than the pane must scroll').toBe(true)
  expect(m.saveInside, 'the Save row must stay inside the dialog').toBe(true)
  expect(m.fitsWindow, 'the dialog must fit the window').toBe(true)
  expect(m.gutter, 'a permanent scrollbar is what says "there is more below"').toBeGreaterThan(0)
})

test('every row of a session menu is legible', async ({ page }) => {
  // Shipped: a menu row carries the CLASS of the button it mirrors so the delegated
  // handler runs it — and inherited its appearance too. `.pin-btn` is opacity:0 until
  // its card is hovered, so "Unpin" was invisible; .terminal-toggle-btn's border made
  // "Open in terminal" read as a disabled text field.
  const card = page.locator('#panel-list .list-card[data-key]').first()
  await card.click({ button: 'right' })
  const menu = page.locator('#session-menu')
  await expect(menu).toBeVisible()

  const rows = await menu.locator('.board-menu-item').evaluateAll((els) => {
    // Measured against the MENU, not against each row's own box. Measuring inside the
    // button missed a row shifted by a borrowed `margin-left` — the text was centred in
    // its button and the button was in the wrong place.
    const menuLeft = els[0].closest('.board-menu').getBoundingClientRect().left
    return els.map((el) => {
      const range = document.createRange(); range.selectNodeContents(el)
      return {
        text: (el.textContent || '').trim().slice(0, 30),
        opacity: parseFloat(getComputedStyle(el).opacity),
        height: Math.round(el.getBoundingClientRect().height),
        border: getComputedStyle(el).borderTopWidth,
        disabled: el.hasAttribute('disabled'),
        textLeft: Math.round(range.getBoundingClientRect().left - menuLeft),
      }
    })
  })

  expect(rows.length, 'the menu should offer the session actions').toBeGreaterThan(5)
  for (const r of rows) {
    const floor = r.disabled ? 0.3 : 0.9   // disabled rows are dimmed on purpose
    expect(r.opacity, `"${r.text}" is invisible`).toBeGreaterThanOrEqual(floor)
    expect(r.height, `"${r.text}" has collapsed`).toBeGreaterThanOrEqual(14)
    expect(r.border, `"${r.text}" kept a borrowed border`).toBe('0px')
  }
  const lefts = [...new Set(rows.map((r) => r.textLeft))]
  expect(lefts.length, `rows start at different x: ${JSON.stringify(rows.map((r) => [r.text, r.textLeft]))}`).toBe(1)
})

test('a card has no pause button; its menu and the terminal bar keep one', async ({ page }) => {
  // Removed on request: the card's hover-revealed pause sat where a click to reopen the
  // session lands, so it paused sessions by accident. The terminal bar and the card's
  // menu both keep it.
  await page.evaluate(() => { window.liveTerminalKeyFor = () => 'live' })
  await page.locator('.tab-btn[data-tab="running"]').click()
  const card = page.locator('#panel-list .list-card[data-key]').first()
  await expect(card).toBeVisible()
  expect(await page.locator('#panel-list .list-card .pause-btn').count()).toBe(0)
  await card.click({ button: 'right' })
  await expect(page.locator('#session-menu .board-menu-item.pause-btn:not([disabled])')).toBeVisible()
})

test('a context menu opens at the pointer', async ({ page }) => {
  const card = page.locator('#panel-list .list-card[data-key]').first()
  const box = await card.boundingBox()
  const x = Math.round(box.x + box.width - 30)
  const y = Math.round(box.y + box.height / 2)
  await page.mouse.click(x, y, { button: 'right' })
  const r = await page.locator('#session-menu').evaluate((el) => {
    const b = el.getBoundingClientRect(); return { left: b.left, top: b.top }
  })
  expect(Math.abs(r.left - x), 'the menu must open at the pointer, not under the card').toBeLessThanOrEqual(8)
  expect(Math.abs(r.top - y)).toBeLessThanOrEqual(8)
})

test('the titlebar shows one empty pinned slot, sized like its neighbours', async ({ page }) => {
  // Shipped: three fixed slots, each a 36x32 icon square next to 25px-tall buttons.
  const slots = page.locator('#pin-global .pin-slot')
  await expect(slots).toHaveCount(1)
  await expect(slots.first()).toHaveClass(/empty/)

  const { slot, neighbour } = await page.evaluate(() => {
    const h = (el) => Math.round(el.getBoundingClientRect().height)
    return {
      slot: h(document.querySelector('#pin-global .pin-slot')),
      neighbour: h(document.getElementById('settings-btn')),
    }
  })
  expect(Math.abs(slot - neighbour), `slot ${slot}px vs neighbour ${neighbour}px`).toBeLessThanOrEqual(2)
})

test('a pinned-skill slot shows its tooltip, in the titlebar and in the detail panel', async ({ page }) => {
  // Shipped: every slot had its text in data-tip and aria-label, and no tooltip ever
  // appeared. The tooltip is the button's own ::after, outside its box, and the slot's
  // `overflow: hidden` (there for the label's ellipsis) clipped it. Its opacity dimmed
  // it too, and in the titlebar it opened upward, out of the window.
  // Keyboard selection, not a click: the card's centre can land on one of its own buttons.
  await page.locator('body').press('j')
  await expect(page.locator('#detail-info-pane .acts')).toBeVisible()
  for (const sel of ['#pin-global .pin-slot.empty', '#detail-info-pane .pin-slot.empty']) {
    const slot = page.locator(sel).first()
    await expect(slot, `${sel} is not rendered`).toBeVisible()
    await slot.hover()
    const t = await slot.evaluate((el) => {
      const cs = getComputedStyle(el)
      const tip = getComputedStyle(el, '::after')
      return {
        text: el.dataset.tip, content: tip.content, overflow: cs.overflow,
        opacity: cs.opacity, opensDown: parseFloat(tip.top) >= el.getBoundingClientRect().height,
        inTitlebar: !!el.closest('.titlebar'),
      }
    })
    expect(t.text, `${sel} has no description`).toBeTruthy()
    expect(t.content, `${sel}: the tooltip is not rendered`).toBe(JSON.stringify(t.text))
    expect(t.overflow, `${sel}: overflow clips the tooltip`).toBe('visible')
    expect(t.opacity, `${sel}: dimming the button fades its tooltip`).toBe('1')
    if (t.inTitlebar) expect(t.opensDown, 'a titlebar tooltip must open downward, inside the window').toBe(true)
  }
})

test('saving Settings keeps the pinned skills', async ({ page }) => {
  // Shipped: Save rebuilt the config from the tabs' collectors alone, and no tab owns the
  // pinned skills — every Save wiped them from config.json.
  await page.evaluate(() => { window.CSM_CONFIG.pinnedSkills = { global: ['route'], session: ['learn'] } })
  await page.locator('#settings-btn').click()
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.__LAST_SET_CONFIG__ && window.__LAST_SET_CONFIG__.pinnedSkills))
    .toEqual({ global: ['route'], session: ['learn'] })
})

test('an icon button holds one centred glyph, whatever its state', async ({ page }) => {
  // Shipped: the ticket and pull-request buttons drew their state as a second glyph
  // beside the icon, inside a button sized for one. The icon was pushed off centre and
  // the row read as misaligned. The state is the icon's own colour now.
  await page.locator('#panel-list .list-card[data-key]').first().click()

  const pills = await page.locator('.act.pill').evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect()
      const svgs = el.querySelectorAll('svg')
      // The count badge is absolutely positioned, so it never shifts the glyph.
      const g = svgs[0] ? svgs[0].getBoundingClientRect() : null
      return {
        label: el.getAttribute('aria-label') || '?',
        svgCount: svgs.length,
        offset: g ? Math.abs((g.left + g.width / 2) - (b.left + b.width / 2)) : -1,
        colour: getComputedStyle(el).color,
      }
    }))

  expect(pills.length, 'the fixture should render at least one ticket or PR button').toBeGreaterThan(0)
  for (const p of pills) {
    expect(p.svgCount, `"${p.label}" carries more than its own icon`).toBe(1)
    expect(p.offset, `"${p.label}" is off centre by ${p.offset}px`).toBeLessThanOrEqual(1)
  }
})

test('each pull-request state tints the icon differently', async ({ page }) => {
  // This contract was silently broken: `.pr-open` and `.act` have the same specificity
  // and `.act` comes later in the stylesheet, so the tint never applied to an icon-only
  // button. Nobody noticed because a second glyph was carrying the state instead. Now
  // the colour IS the signal, so it has to be checked.
  const tints = await page.evaluate(() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const out = {}
    for (const c of ['pr-open', 'pr-draft', 'pr-merged', 'pr-closed', 'pr-unknown', '']) {
      host.innerHTML = `<button class="act pill ${c}"><svg viewBox="0 0 24 24" stroke="currentColor"></svg></button>`
      out[c || 'default'] = getComputedStyle(host.querySelector('svg')).stroke
    }
    host.remove()
    return out
  })
  const seen = Object.values(tints)
  expect(new Set(seen).size, `states share a colour: ${JSON.stringify(tints)}`).toBe(seen.length)

  // And they stay in this app's register. The ceiling is 45 % saturation: ours peaks at
  // 40 % and GitHub's quietest offender — their green — is 49 %, so the rule separates
  // the two sets. Asserted as a ceiling rather than as exact hexes, so it survives a
  // tweak while a vivid colour dropped back in does not.
  const sat = (css) => {
    const [r, g, b] = css.match(/[\d.]+/g).slice(0, 3).map((n) => n / 255)
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
    return mx === mn ? 0 : (mx - mn) / (l > 0.5 ? 2 - mx - mn : mx + mn) * 100
  }
  for (const [state, css] of Object.entries(tints)) {
    expect(sat(css), `${state} (${css}) is louder than anything else in the app`).toBeLessThanOrEqual(45)
  }
})

test('a card and a menu are controls, not documents — no text selection', async ({ page }) => {
  // Right-clicking a card used to select the word under the pointer before the menu
  // opened. Asserted as a CSS contract, not as behaviour: Playwright's synthetic
  // right-click does not produce the native selection a real mouse does, so a
  // behavioural check passed with the rule removed — it proved nothing.
  await page.locator('#panel-list .list-card[data-key]').first().click({ button: 'right' })
  await expect(page.locator('#session-menu')).toBeVisible()
  const sel = await page.evaluate(() => ({
    card: getComputedStyle(document.querySelector('#panel-list .list-card')).userSelect,
    menu: getComputedStyle(document.getElementById('session-menu')).userSelect,
    detail: getComputedStyle(document.getElementById('panel-detail')).userSelect,
  }))
  expect(sel.card, 'a card must not be selectable').toBe('none')
  expect(sel.menu, 'a menu must not be selectable').toBe('none')
  // The detail panel stays selectable — ids and paths there are worth copying.
  expect(sel.detail).not.toBe('none')
})

test('a tab count updates in place, so a click in progress is not lost', async ({ page }) => {
  // Shipped: switching tabs sometimes took two clicks. updateTabBadges rewrote the
  // button's innerHTML whenever a count changed; when that landed between mouse-down and
  // mouse-up, WebKit (the app's engine) dispatched no click at all — measured 0/5 in
  // Playwright's WebKit, 5/5 in Chromium, which is why nothing caught it. The check here
  // is the contract that fixes it, and holds in any engine: the nodes survive.
  const nodes = await page.evaluate(() => {
    const btn = document.querySelector('.tab-btn[data-tab="running"]')
    const before = [...btn.childNodes]
    window._tabCounts.running = (window._tabCounts.running || 0) + 7
    window._waitingCount = (window._waitingCount || 0) + 1
    window.updateTabBadges()
    const after = [...btn.childNodes]
    return { same: before.length > 0 && before.every((n) => after.includes(n)), text: btn.textContent }
  })
  expect(nodes.same, 'the button\'s own nodes must not be replaced').toBe(true)
  expect(nodes.text).toMatch(/Running\s*\d+/)
})

test('the whole group title bar folds, at once, and its buttons do not', async ({ page }) => {
  // Shipped: only the arrow and the name folded; the count and the empty stretch of the
  // bar did nothing (and armed a drag), so "clicking the title bar" took two or three
  // tries. And the fold only painted after a full backend re-read, so a slow read looked
  // like a missed click, and the second click undid the first.
  await page.evaluate(() => {
    const key = (s) => s.notesPath || s.sessionId || s.name || ''
    const ss = (window._lastSessions || []).filter((s) => s.status !== 'waiting')
    const a = key(ss[0]), b = key(ss[1])
    if (!window.isPinned(a)) window.togglePin(a)
    if (!window.isPinned(b)) window.togglePin(b)
    window.CSMListOrg.save(window.CSMListOrg.createGroupWith(window.CSMListOrg.load(), window.PINNED_CAT, 'lg-bar', [a, b], 0))
    window.fetchAndRender(false)
  })
  const body = page.locator('.list-group-body').first()
  await expect(body).not.toHaveClass(/collapsed/)
  // Make every re-read slow: the fold must not wait for it.
  await page.evaluate(() => {
    const slow = (f) => (...a) => new Promise((r) => setTimeout(() => r(f(...a)), 1500))
    window.api.getSessions = slow(window.api.getSessions)
    window.api.getHistoricalSessions = slow(window.api.getHistoricalSessions)
  })
  await page.locator('.list-group-count').first().click()
  await expect(body, 'a click on the count folds, before the re-read returns').toHaveClass(/collapsed/, { timeout: 400 })
  // The buttons on the bar keep their own job.
  await page.waitForTimeout(1700)
  const before = await page.locator('.list-group-body').first().getAttribute('class')
  await page.locator('.list-group-color').first().click()
  await page.keyboard.press('Escape')
  expect(await page.locator('.list-group-body').first().getAttribute('class')).toBe(before)
})

test('the group chevron folds and unfolds', async ({ page }) => {
  // Shipped dead: drag-list calls preventDefault on mousedown for anything that is not a
  // button/input/link/[data-nodrag], which suppresses the click that follows. The group
  // NAME carried data-nodrag and worked; the chevron beside it did not and did nothing.
  //
  // Built in the pinned block rather than in a category: every category in the fixture
  // holds exactly one non-waiting session, and a group needs two. groupBlock renders the
  // same header either way.
  const built = await page.evaluate(() => {
    const key = (s) => s.notesPath || s.sessionId || s.name || ''
    const ss = (window._lastSessions || []).filter((s) => s.status !== 'waiting')
    if (ss.length < 2) return false
    const a = key(ss[0]), b = key(ss[1])
    if (!window.isPinned(a)) window.togglePin(a)
    if (!window.isPinned(b)) window.togglePin(b)
    window.CSMListOrg.save(window.CSMListOrg.createGroupWith(
      window.CSMListOrg.load(), window.PINNED_CAT, 'lg-chev', [a, b], 0))
    window.fetchAndRender(false)
    return true
  })
  expect(built, 'the fixture must offer two non-waiting sessions to pin').toBe(true)

  const chev = page.locator('.list-group-chev').first()
  await expect(chev).toBeVisible()

  // The defect was the hit area, not the wiring: `line-height: 1` on the glyph left a
  // 13x5.7px target, so clicking "the arrow" mostly landed on the header — which has no
  // collapse handler — and folding felt unresponsive rather than missed.
  const box = await chev.boundingBox()
  expect(box.height, `the arrow is ${box.height}px tall — too small to hit`).toBeGreaterThanOrEqual(16)
  expect(box.width).toBeGreaterThanOrEqual(16)
  const onTarget = await chev.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    return hit === el || el.contains(hit)
  })
  expect(onTarget, 'the arrow must be what sits under its own centre').toBe(true)
  const collapsed = () => page.evaluate(() => {
    const c = window.CSMListOrg.load().categories[window.PINNED_CAT] || {}
    return !!(c.groups || {})['lg-chev']?.collapsed
  })

  expect(await collapsed()).toBe(false)
  await chev.click()
  await expect.poll(collapsed, { message: 'clicking the chevron must fold the group' }).toBe(true)
  await page.locator('.list-group-chev').first().click()
  await expect.poll(collapsed, { message: 'and unfold it again' }).toBe(false)
})

test.describe('Brutus', () => {
  // The reload needs the same wait as the top-level beforeEach: without it a test ran while
  // the fixture was still booting the app and freezing its timers, and lost clicks to it.
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => { try { localStorage.removeItem('csm.brutusHome'); localStorage.removeItem('csm.brutusLog') } catch {} })
    await page.reload()
    await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  })

  test('bubble by default, and no titlebar button in that mode', async ({ page }) => {
    await expect(page.locator('.bru-fab')).toBeVisible()
    await expect(page.locator('#brutus-btn')).toBeHidden()
  })

  test('right-click the bubble docks him in the side panel; the header icon brings him back', async ({ page }) => {
    await page.locator('.bru-fab').click({ button: 'right' })
    await expect(page.locator('.bru-menu button')).toHaveCount(2)
    await page.locator('.bru-menu [data-a=side]').click()
    await expect(page.locator('.bru-panel.docked')).toBeVisible()
    await expect(page.locator('#brutus-btn')).toBeVisible()
    await expect(page.locator('.bru-fab')).toHaveCount(0)
    // The dock animates its margin; read it once the transition is over.
    await expect.poll(() => page.locator('.layout').evaluate(el => getComputedStyle(el).marginRight)).toBe('400px')
    await page.locator('[data-bru="to-bubble"]').click()
    await expect(page.locator('.bru-fab')).toBeVisible()
    await expect(page.locator('#brutus-btn')).toBeHidden()
  })

  test('⌘K opens the palette over either home; Esc closes it', async ({ page }) => {
    await page.keyboard.press('Meta+k')
    await expect(page.locator('.bru-panel.v-B')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.bru-panel.v-B')).toHaveCount(0)
  })

  test('an answer renders a chip for a known session and never executes markup', async ({ page }) => {
    await page.locator('.bru-fab').click()
    await page.locator('.bru-panel input').fill("What's waiting on me?")
    await page.keyboard.press('Enter')
    await expect(page.locator('.bru-panel [data-brutus-session="checkout-redesign"]')).toBeVisible()
    await expect(page.locator('.bru-panel .bru-steps').last()).toContainText('Read the dashboard')
    expect(await page.evaluate(() => window.__XSS__)).toBeUndefined()
    await expect(page.locator('.bru-panel input')).toBeEnabled()
  })

  test('Settings → Assistant saves the name and style, and his menu opens it', async ({ page }) => {
    await page.locator('.bru-fab').click({ button: 'right' })
    await page.locator('.bru-menu [data-a=set]').click()
    await expect(page.locator('[data-settings-panel="assistant"]')).toBeVisible()
    await page.locator('#set-assistant-name').fill('Jarvis')
    await page.locator('#set-assistant-styles [data-style="nerdy"]').click()
    await expect(page.locator('#set-assistant-sample .bru-av')).toHaveText('J')
    await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
    await expect.poll(() => page.evaluate(() => window.__LAST_SET_CONFIG__ && window.__LAST_SET_CONFIG__.assistant))
      .toEqual({ name: 'Jarvis', style: 'nerdy' })
  })

  test('a failed run shows one error line and gives the input back', async ({ page }) => {
    await page.locator('.bru-fab').click()
    await page.locator('.bru-panel input').fill('please fail')
    await page.keyboard.press('Enter')
    await expect(page.locator('.bru-panel .bru-err')).toContainText('logged in')
    await expect(page.locator('.bru-panel input')).toBeEnabled()
  })
})
