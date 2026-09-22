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
