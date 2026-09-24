// Smoke tests for the renderer, in a real browser.
//
// A real browser and not jsdom, deliberately: of the four interface defects found by
// hand on 2026-09-21, three were CSS — a menu row inheriting `opacity: 0`, pinned slots
// inheriting a 36x32 icon square, and a <dialog> made permanently visible by a bare
// `display`. jsdom has no layout engine, so `getBoundingClientRect()` returns zeros and
// computed styles are partial: it would have caught none of those three.
const { defineConfig, devices } = require('@playwright/test')

const PORT = Number(process.env.AO_SMOKE_PORT) || 4173   // overridable so two suites can run side by side

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
    // Always a fresh server, locally too. Reusing one that was mid-shutdown made a run
    // report 8 of 9 tests with no failure — a suite that silently loses a test is worse
    // than no suite. A cold start costs about a second.
    reuseExistingServer: false,
    timeout: 20_000,
  },
})
