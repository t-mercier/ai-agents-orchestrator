// The app runs under the CSP of tauri.conf.json, which blocks every handler written in the
// HTML (onclick="…"). The fixture serves the page without it, so the terminal toolbar's
// Pause and Close buttons, wired that way, passed every test while doing nothing in the app
// from 0.19.0 on. These tests load the page under the app's own CSP and click for real.
const { test, expect } = require('@playwright/test')
const fs = require('fs'), path = require('path')
const ROOT = path.join(__dirname, '..', '..')
const csp = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')).app.security.csp

async function openUnderCsp(page) {
  const blocked = []
  page.on('console', m => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) blocked.push(m.text()) })
  await page.route('**/index.html', async route => {
    const res = await route.fetch()
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp } })
  })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(async () => {
    window.api.ptyInput = () => Promise.resolve()
    window.__killed = []
    const orig = window.killTerminal
    window.killTerminal = (sid) => { window.__killed.push(sid); return orig && orig(sid) }
    window.openTerminalPane('S9', '/tmp', '', '', '')
    await new Promise(r => setTimeout(r, 300))
  })
  return blocked
}

test('Pause in the terminal toolbar ends the terminal under the app CSP', async ({ page }) => {
  const blocked = await openUnderCsp(page)
  await page.click('.terminal-pause-btn')
  await expect.poll(() => page.evaluate(() => window.__killed)).toEqual(['S9'])
  expect(blocked).toEqual([])
})

test('Close session in the terminal toolbar ends the terminal under the app CSP', async ({ page }) => {
  const blocked = await openUnderCsp(page)
  await page.click('.terminal-close-btn')      // no notes.md: an unmanaged session is just ended
  await expect.poll(() => page.evaluate(() => window.__killed)).toEqual(['S9'])
  expect(blocked).toEqual([])
})

test('no page writes a handler in its HTML, which the CSP would block', async () => {
  const pages = ['renderer/index.html', 'renderer/detail.html', ...fs.readdirSync(path.join(ROOT, 'renderer', 'settings'))
    .filter(f => f.endsWith('.html')).map(f => `renderer/settings/${f}`)]
  const found = []
  for (const p of pages) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8')
    for (const m of html.matchAll(/<[^>]*\son[a-z]+\s*=\s*["']/gi)) found.push(`${p}: ${m[0].slice(0, 80)}`)
  }
  expect(found).toEqual([])
})
