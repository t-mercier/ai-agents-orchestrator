// Settings: Shortcuts tab — remap single-key actions (localStorage, applies live).
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const $ = (id) => document.getElementById(id)

  const escKey = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const keyLabel = (k) => k === ' ' ? 'Space' : (k.length === 1 ? k.toUpperCase() : k)

  function renderKeys() {
    const host = $('set-keys')
    if (!host || !window.KEY_ACTIONS || !window.getKeys) return
    const keys = window.getKeys()
    host.innerHTML = window.KEY_ACTIONS.map(a => `
      <div class="key-row">
        <span class="key-label">${escKey(a.label)}</span>
        <button type="button" class="key-cap" data-key-action="${a.id}">${escKey(keyLabel(keys[a.id] || '—'))}</button>
      </div>`).join('')
  }

  // Register populate only (live-only tab).
  window.CSMSettings.register({
    populate: renderKeys,
  })

  let capturingKey = null
  const keysHost = $('set-keys')
  if (keysHost) keysHost.addEventListener('click', (e) => {
    const btn = e.target.closest('.key-cap'); if (!btn) return
    keysHost.querySelectorAll('.key-cap.capturing').forEach(b => b.classList.remove('capturing'))
    btn.classList.add('capturing'); btn.textContent = '…'
    capturingKey = btn.dataset.keyAction
  })
  // Capture-phase: grab the next keypress while a button is armed (beats the global nav).
  document.addEventListener('keydown', (e) => {
    if (!capturingKey) return
    e.preventDefault(); e.stopPropagation()
    if (e.key === 'Escape') { capturingKey = null; renderKeys(); return }
    if (e.key.length === 1) { if (window.setKey) window.setKey(capturingKey, e.key); capturingKey = null; renderKeys() }
  }, true)
  if ($('set-keys-reset')) $('set-keys-reset').addEventListener('click', () => { if (window.resetKeys) window.resetKeys(); renderKeys() })
})()
