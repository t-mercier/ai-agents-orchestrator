// Settings: Integrations tab — ticket URL + Obsidian toggle.
// Per-space vault paths have moved to the General tab (spaces editor).
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const $ = (id) => document.getElementById(id)

  // Populate integrations fields from config.
  function populateIntegrations() {
    const c = window.CSM_CONFIG || {}
    const obs = c.obsidian || {}
    $('set-obsidian-enabled').checked = !!obs.enabled
    $('set-ticket').value = c.ticketBaseUrl || ''
  }

  // Collect integrations fields into config.
  function collectIntegrations(out) {
    out.obsidian = {
      enabled: $('set-obsidian-enabled').checked,
    }
    out.ticketBaseUrl = $('set-ticket').value.trim()
  }

  // Register populate and collect.
  window.CSMSettings.register({
    populate: populateIntegrations,
    collect: collectIntegrations,
  })
})()
