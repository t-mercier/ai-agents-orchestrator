// One screenshot, through Playwright's Chromium.
//
// Replaces a raw `--headless=new --virtual-time-budget` invocation, which stopped
// producing usable shots: the fixture clears every pending timer once its scene is set,
// and under virtual time that lands before the first render resolves — Chrome wrote a
// correct screenshot of an empty session list. Real time keeps the ordering the app was
// written for, and Playwright is already a dev dependency for the smoke tests.
//
//   node shoot.js <url> <out.png> <width> <height>
const { chromium } = require('@playwright/test')

const [url, out, w, h] = process.argv.slice(2)

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport: { width: Number(w), height: Number(h) },
    deviceScaleFactor: 1,          // 1x, matching the sizes capture.sh checks and the
                                   // images already committed under docs/media/
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(url, { waitUntil: 'load' })
  // The fixture flips this once its scene has run and the page is frozen.
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 20_000 })
  await page.waitForTimeout(400)   // let the last transition settle
  await page.screenshot({ path: out })
  await browser.close()
  if (errors.length) {
    console.error(`  !! page error during ${out}: ${errors[0]}`)
    process.exit(1)
  }
})().catch((e) => { console.error(`  !! ${e.message}`); process.exit(1) })
