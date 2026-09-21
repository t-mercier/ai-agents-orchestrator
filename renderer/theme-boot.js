// Theme, density and accent, applied before the first paint.
//
// This runs from its own file rather than an inline <script> so that the Content Security
// Policy can stay at `script-src 'self'`: an inline block would need a hash that goes stale
// the moment this code is edited. A plain <script src> in <head> is still render-blocking
// and still runs in order, so there is no flash of the wrong theme.
  try {
    var t = localStorage.getItem('csm.theme'); if (t) document.documentElement.dataset.theme = t
    var d = localStorage.getItem('csm.density'); if (d) document.documentElement.dataset.density = d
    var lt = localStorage.getItem('csm.lookTint'); if (lt) document.documentElement.style.setProperty('--look-tint', lt)
    var la = localStorage.getItem('csm.lookTintA'); if (la) document.documentElement.style.setProperty('--look-tint-a', la)
    if (localStorage.getItem('csm.compactChrome') === '1') document.documentElement.classList.add('compact-chrome')
    var a = localStorage.getItem('csm.accent')
    if (a && /^#[0-9a-f]{6}$/i.test(a)) {
      var n = parseInt(a.slice(1), 16)
      document.documentElement.style.setProperty('--accent', a)
      document.documentElement.style.setProperty('--accent-rgb', ((n>>16)&255) + ', ' + ((n>>8)&255) + ', ' + (n&255))
      var lum = 0.299*((n>>16)&255) + 0.587*((n>>8)&255) + 0.114*(n&255)
      document.documentElement.style.setProperty('--on-accent', lum > 150 ? '#16171b' : '#ffffff')
    }
  } catch (e) { /* ignore */ }
