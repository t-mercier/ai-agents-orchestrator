// Settings: Assistant — Brutus's name and style (config.json: the backend composes his
// prompt from them) and where he appears (localStorage: how the app looks to you).
;(function () {
  if (!window.CSMSettings) return
  const $ = (id) => document.getElementById(id)
  const STYLES = {
    concise: { label: 'Concise', sample: '2 need you: [[session:checkout-redesign]] (retry strategy) and [[session:search-suggest]] (API contract).' },
    friendly: { label: 'Friendly', sample: 'Morning! Two sessions are waiting for you — [[session:checkout-redesign]] wants your call on the retry strategy, and [[session:search-suggest]] is stuck on the API contract.' },
    casual: { label: 'Casual', sample: 'yo, two of them are poking you: [[session:checkout-redesign]] and [[session:search-suggest]]. retry strategy and API contract, your call.' },
    nerdy: { label: 'Nerdy', sample: '2 processes blocked on user input 🤓 [[session:checkout-redesign]]: exponential vs. jittered backoff? [[session:search-suggest]]: awaiting the API contract since yesterday.' },
    sarcastic: { label: 'Sarcastic', sample: 'Oh good, two sessions are waiting on you. [[session:checkout-redesign]] needs you to pick a retry strategy — riveting. [[session:search-suggest]] has been staring at an API contract since yesterday. Go on, they won\'t unblock themselves.' },
  }
  const SAMPLE_SESSIONS = [{ name: 'checkout-redesign', status: 'waiting' }, { name: 'search-suggest', status: 'waiting' }]
  let style = 'concise'

  function paint() {
    const host = $('set-assistant-styles'); if (!host) return
    host.innerHTML = Object.entries(STYLES).map(([k, v]) =>
      `<button type="button" role="radio" aria-checked="${k === style}" data-style="${k}" class="${k === style ? 'on' : ''}">${v.label}</button>`).join('')
    const n = ($('set-assistant-name').value || '').trim() || 'Brutus'
    $('set-assistant-sample').innerHTML = `<div class="bru-b"><span class="bru-av lg">${window.CSMFormatters.escapeHtml(window.CSMBrutus.initialOf(n))}</span><div class="bru-bt">${window.CSMBrutus.renderAnswer(STYLES[style].sample, SAMPLE_SESSIONS)}</div></div>`
  }
  function populate() {
    const a = (window.CSM_CONFIG || {}).assistant || {}
    $('set-assistant-name').value = a.name || 'Brutus'
    style = STYLES[a.style] ? a.style : 'concise'
    let home = 'bubble'; try { home = localStorage.getItem('csm.brutusHome') === 'side' ? 'side' : 'bubble' } catch {}
    document.querySelectorAll('input[name="set-assistant-home"]').forEach(r => { r.checked = r.value === home })
    paint()
  }
  function collect(out) {
    out.assistant = { name: ($('set-assistant-name').value || '').trim() || 'Brutus', style }
    // Only on a real change: setHome opens him in his new home, which every Save must not do.
    const home = document.querySelector('input[name="set-assistant-home"]:checked')
    let was = 'bubble'; try { was = localStorage.getItem('csm.brutusHome') === 'side' ? 'side' : 'bubble' } catch {}
    if (home && home.value !== was && window.CSMBrutusUI) window.CSMBrutusUI.setHome(home.value)
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#set-assistant-styles [data-style]')
    if (b) { style = b.dataset.style; paint() }
    if (e.target.closest('#set-assistant-memory')) openMemory()
  })
  async function openMemory() {
    if (window.clearSettingsError) window.clearSettingsError()
    const r = await window.api.brutusOpenMemory()
    if ((!r || !r.ok) && window.showSettingsError) window.showSettingsError(`Could not open his memory: ${(r && r.error) || 'unknown error'}`)
  }
  document.addEventListener('input', (e) => { if (e.target.id === 'set-assistant-name') paint() })
  window.CSMSettings.register({ populate, collect })
})()
