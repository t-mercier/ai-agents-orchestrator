// Settings: Integrations tab — ticket URL + Obsidian fields.
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const $ = (id) => document.getElementById(id)

  // Populate integrations fields from config.
  function populateIntegrations() {
    const c = window.CSM_CONFIG || {}
    const obs = c.obsidian || {}
    $('set-obsidian-enabled').checked = !!obs.enabled
    $('set-work-vault').value = obs.workVaultPath || ''
    $('set-personal-vault').value = obs.personalVaultPath || ''
    $('set-ticket').value = c.ticketBaseUrl || ''
  }

  // Collect integrations fields into config.
  function collectIntegrations(out) {
    out.obsidian = {
      enabled: $('set-obsidian-enabled').checked,
      workVaultPath: $('set-work-vault').value.trim(),
      personalVaultPath: $('set-personal-vault').value.trim(),
    }
    out.ticketBaseUrl = $('set-ticket').value.trim()
  }

  // Register populate and collect.
  window.CSMSettings.register({
    populate: populateIntegrations,
    collect: collectIntegrations,
  })
})()
