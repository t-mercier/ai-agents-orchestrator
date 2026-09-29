// Settings: Shortcuts tab — remap single-key actions (localStorage, applies live).
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const $ = (id) => document.getElementById(id)

  // ⌘ exists only on macOS. brutus.js binds metaKey || ctrlKey, so elsewhere the key is
  // Ctrl: rewrite every label marked data-mod-key, text and title alike.
  const IS_MAC = /Mac/.test(navigator.platform || navigator.userAgent || '')
  window.modKeyLabel = IS_MAC ? '⌘' : 'Ctrl+'
  if (!IS_MAC) document.querySelectorAll('[data-mod-key]').forEach((el) => {
    if (el.title) el.title = el.title.replace(/⌘/g, 'Ctrl+')
    if (!el.children.length) el.textContent = el.textContent.replace(/⌘/g, 'Ctrl+')
  })

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

  // Your own shortcuts, on any action: none by default, one combo per action.
  const why = (text) => { const el = $('set-shortcuts-why'); if (el) el.textContent = text || '' }
  function renderShortcuts() {
    const host = $('set-shortcuts')
    if (!host || !window.SHORTCUT_ACTIONS || !window.CSMKeymap) return
    const map = window.getShortcuts()
    const row = (a) => `
      <div class="key-row" data-shortcut="${a.id}">
        <span class="key-label">${escKey(a.label)}${a.session ? ' <em class="key-scope">selected session</em>' : ''}</span>
        <span class="key-ctl">
          <button type="button" class="key-cap" data-shortcut-action="${a.id}">${escKey(map[a.id] ? window.CSMKeymap.label(map[a.id], IS_MAC) : '—')}</button>
          ${map[a.id] ? `<button type="button" class="key-clear" data-clear="${a.id}" aria-label="Remove the shortcut for ${escKey(a.label)}" title="Remove">×</button>` : ''}
        </span>
      </div>`
    host.innerHTML = window.SHORTCUT_ACTIONS.map(row).join('')
  }

  // Register populate only (live-only tab).
  window.CSMSettings.register({
    populate: () => { renderKeys(); renderShortcuts(); why('') },
  })

  let capturingShortcut = null
  const scHost = $('set-shortcuts')
  if (scHost) scHost.addEventListener('click', (e) => {
    const clear = e.target.closest('[data-clear]')
    if (clear) { window.setShortcut(clear.dataset.clear, null); why(''); renderShortcuts(); return }
    const btn = e.target.closest('.key-cap'); if (!btn) return
    renderShortcuts()
    const armed = scHost.querySelector(`.key-cap[data-shortcut-action="${btn.dataset.shortcutAction}"]`)
    armed.classList.add('capturing'); armed.textContent = '…'
    capturingShortcut = btn.dataset.shortcutAction
    why('')
  })
  document.addEventListener('keydown', (e) => {
    if (!capturingShortcut) return
    e.preventDefault(); e.stopPropagation()
    if (e.key === 'Escape') { capturingShortcut = null; renderShortcuts(); return }
    const combo = window.CSMKeymap.fromEvent(e, IS_MAC)
    if (!combo) return   // a modifier on its own: wait for the key
    const r = window.CSMKeymap.check(combo, window.getShortcuts(), capturingShortcut)
    const shown = window.CSMKeymap.label(combo, IS_MAC)
    if (r.ok) { window.setShortcut(capturingShortcut, combo); why('') }
    else if (r.taken) {
      const owner = (window.SHORTCUT_ACTIONS.find(a => a.id === r.taken) || {}).label || r.taken
      why(`${shown} is already used by ${owner}. Remove it there first.`)
    } else why(`${shown}: ${r.why}.`)
    capturingShortcut = null
    renderShortcuts()
  }, true)
  if ($('set-shortcuts-reset')) $('set-shortcuts-reset').addEventListener('click', () => { window.resetShortcuts(); why(''); renderShortcuts() })

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
  // A remap armed when the dialog closes would take the next key typed anywhere.
  modal.addEventListener('close', () => { capturingKey = null; capturingShortcut = null })
  if ($('set-keys-reset')) $('set-keys-reset').addEventListener('click', () => { if (window.resetKeys) window.resetKeys(); renderKeys() })
})()
