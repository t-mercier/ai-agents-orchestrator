// A question typed to Brutus and not sent stays (asked for on 2026-09-30: text typed in his
// chat, then a click outside folded the bubble, and reopening it showed an empty input).
const { test, expect } = require('@playwright/test')

async function open(page) {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => window.CSMBrutusUI.setHome('bubble'))
}
const input = (page) => page.locator('.bru-panel.v-A input')

test('a draft survives folding the bubble and opening it again', async ({ page }) => {
  await open(page)
  await input(page).fill('Which session waits the longest')
  await page.mouse.click(5, 300)   // outside the bubble: it folds
  await expect(page.locator('.bru-panel.v-A')).toHaveCount(0)
  await page.locator('.bru-fab').click()
  await expect(input(page)).toHaveValue('Which session waits the longest')
})

// The fixture clears localStorage on every load, so a reload cannot stand for a restart here;
// what a restart needs is that the draft is stored, and the fold test reads it back.
test('a draft is stored as it is typed, for a restart to find', async ({ page }) => {
  await open(page)
  await input(page).fill('half a question')
  expect(await page.evaluate(() => localStorage.getItem('csm.brutusDraft'))).toBe('half a question')
})

test('sending clears the draft', async ({ page }) => {
  await open(page)
  await input(page).fill('What is waiting on me?')
  await input(page).press('Enter')
  await expect(page.locator('.bru-panel .bru-u').last()).toHaveText('What is waiting on me?')
  expect(await page.evaluate(() => localStorage.getItem('csm.brutusDraft') || '')).toBe('')
})
