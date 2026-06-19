// Pure formatting helpers. UMD: usable as a <script> in the renderer
// (window.CSMFormatters) and via require() in jest. No DOM, no state.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMFormatters = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function truncate(str, max) {
    if (!str) return ''
    return str.length > max ? str.slice(0, max - 1) + '…' : str
  }

  function escapeHtml(str) {
    if (!str) return ''
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function statusLabel(status) {
    return { busy: 'BUSY', waiting: 'WAIT', idle: 'IDLE', shell: 'SHELL' }[status] ||
      (status || 'IDLE').toUpperCase()
  }

  // Normalize a session's last-activity to epoch ms. updatedAt may be a number
  // (epoch ms) or an ISO string; falls back to lastActivityAt then startedAt.
  function sessionTime(s) {
    const v = s.updatedAt || s.lastActivityAt || s.startedAt
    if (!v) return 0
    if (typeof v === 'number') return v
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? 0 : t
  }

  // Relative time, e.g. "just now" / "5m ago" / "3h ago" / a date. `now` is
  // injectable for deterministic tests (defaults to Date.now()).
  function formatTimestamp(iso, now) {
    if (!iso) return ''
    try {
      const ref = typeof now === 'number' ? now : Date.now()
      const d = new Date(iso)
      const diffMin = Math.floor((ref - d) / 60000)
      if (diffMin < 1) return 'just now'
      if (diffMin < 60) return `${diffMin}m ago`
      const diffH = Math.floor(diffMin / 60)
      if (diffH < 24) return `${diffH}h ago`
      return d.toLocaleDateString()
    } catch {
      return ''
    }
  }

  // Absolute date+time, e.g. "Jun 3, 2026 · 14:32". Accepts epoch ms or ISO string.
  function formatDateTime(value) {
    if (!value) return ''
    try {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return ''
      const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      return `${date} · ${time}`
    } catch {
      return ''
    }
  }

  return { truncate, escapeHtml, statusLabel, sessionTime, formatTimestamp, formatDateTime }
})
