// Single source of truth for the category order used by both the list grouping
// (ui.js) and the filter chips (app.js). Prefers the live config order, falls
// back to a built-in list. UMD: window.CSMCategories in the renderer, require() in jest.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMCategories = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Matches the shipped config DEFAULTS; user-specific categories (e.g. CPM)
  // live in config, not here. Used only until the config IPC resolves at boot.
  const FALLBACK = ['FEAT', 'BUG', 'REVIEW', 'CHORE', 'TEST', 'PERSO']
  // Live category order: config-driven when available, else the fallback.
  function order() {
    return (typeof window !== 'undefined' && window.CSM_CONFIG && window.CSM_CONFIG.order) || FALLBACK
  }
  return { FALLBACK, order }
})
