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

  const rows = await menu.locator('.board-menu-item').evaluateAll((els) =>
    els.map((el) => ({
      text: (el.textContent || '').trim().slice(0, 30),
      opacity: parseFloat(getComputedStyle(el).opacity),
      height: Math.round(el.getBoundingClientRect().height),
      border: getComputedStyle(el).borderTopWidth,
      disabled: el.hasAttribute('disabled'),
    })))

  expect(rows.length, 'the menu should offer the session actions').toBeGreaterThan(5)
  for (const r of rows) {
    const floor = r.disabled ? 0.3 : 0.9   // disabled rows are dimmed on purpose
    expect(r.opacity, `"${r.text}" is invisible`).toBeGreaterThanOrEqual(floor)
    expect(r.height, `"${r.text}" has collapsed`).toBeGreaterThanOrEqual(14)
    expect(r.border, `"${r.text}" kept a borrowed border`).toBe('0px')
  }
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
