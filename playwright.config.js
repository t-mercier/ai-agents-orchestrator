// Smoke tests for the renderer, in a real browser.
//
// A real browser and not jsdom, deliberately: of the four interface defects found by
// hand on 2026-09-21, three were CSS — a menu row inheriting `opacity: 0`, pinned slots
// inheriting a 36x32 icon square, and a <dialog> made permanently visible by a bare
// `display`. jsdom has no layout engine, so `getBoundingClientRect()` returns zeros and
// computed styles are partial: it would have caught none of those three.
const { defineConfig, devices } = require('@playwright/test')

const PORT = 4173

module.exports = defineConfig({
  testDir: './scripts/smoke',
  fullyParallel: false,          // one page, one fixture, deterministic order
  forbidOnly: !!process.env.CI,
  retries: 0,                    // a flaky UI test is a bug report, not something to retry away
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `python3 scripts/smoke/serve.py ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
})
