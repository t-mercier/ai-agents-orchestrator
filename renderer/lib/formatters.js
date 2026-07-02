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

  // Normalize a session's last-activity to epoch ms. Each field may be a number (epoch
  // ms) or an ISO string. Takes the MOST RECENT of updatedAt / lastActivityAt — not a
  // fixed priority — because either can be the true "last touched" signal depending on
  // the write path: updatedAt is the notes.md file's mtime (bumped by /save-session,
  // /close-session, Archive…), lastActivityAt is the transcript's last message. Pause
  // (kills the pty, no notes.md write) only bumps the transcript, so if updatedAt won
  // outright it would show a stale, days-old "last activity" right after pausing today's
  // work. Falls back to startedAt only when neither is present.
  function toMs(v) {
    if (!v) return 0
    if (typeof v === 'number') return v
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  function sessionTime(s) {
    const best = Math.max(toMs(s.updatedAt), toMs(s.lastActivityAt))
    return best || toMs(s.startedAt)
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

  // Compact age for a card's icon row, e.g. "2m" / "5h" / "3d" / "2w" / "4mo" / "1y".
  // Unlike formatTimestamp (verbose "5m ago", falls back to a full date), this always
  // stays a short token — used next to a clock glyph where space is tight. `now` is
  // injectable for deterministic tests (defaults to Date.now()).
  function formatAge(ms, now) {
    if (!ms) return ''
    const ref = typeof now === 'number' ? now : Date.now()
    const diffMin = Math.floor((ref - ms) / 60000)
    if (diffMin < 1) return 'now'
    if (diffMin < 60) return `${diffMin}m`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `${diffD}d`
    const diffW = Math.floor(diffD / 7)
    if (diffD < 30) return `${diffW}w`
    const diffMo = Math.floor(diffD / 30)
    if (diffMo < 12) return `${diffMo}mo`
    return `${Math.floor(diffD / 365)}y`
  }

  return { truncate, escapeHtml, statusLabel, sessionTime, formatTimestamp, formatDateTime, formatAge }
})
