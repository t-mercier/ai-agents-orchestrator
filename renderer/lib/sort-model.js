// How the List orders sessions inside each category. UMD: window.CSMSort in the renderer
// + require() in jest. No DOM, no state. "manual" is the order you set by dragging; the
// other modes sort by the session's last update or by its primary ticket's number.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMSort = api
})(typeof self !== 'undefined' ? self : this, function () {
  const MODES = [
    { id: 'manual', label: 'Manual' },
    { id: 'updated', label: 'Last updated' },
    { id: 'ticket-asc', label: 'Ticket ↑' },
    { id: 'ticket-desc', label: 'Ticket ↓' },
  ]
  const normalizeMode = (m) => (MODES.some(x => x.id === m) ? m : 'manual')

  // The number of a PROJ-123 ticket, or null. The prefix breaks ties between projects.
  function ticketParts(s) {
    const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(String((s && s.ticket) || '').trim())
    return m ? { prefix: m[1].toUpperCase(), n: Number(m[2]) } : null
  }

  // A comparator for two sessions, or null in manual mode. A session with no ticket sorts
  // last in both ticket directions: it has no place on that axis.
  function comparator(mode, timeOf) {
    if (mode === 'updated') return (a, b) => (timeOf(b) || 0) - (timeOf(a) || 0)
    if (mode === 'ticket-asc' || mode === 'ticket-desc') {
      const dir = mode === 'ticket-asc' ? 1 : -1
      return (a, b) => {
        const x = ticketParts(a), y = ticketParts(b)
        if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1)
        return dir * (x.n - y.n || x.prefix.localeCompare(y.prefix))
      }
    }
    return null
  }

  function sortSessions(sessions, mode, timeOf) {
    const cmp = comparator(normalizeMode(mode), timeOf)
    return cmp ? sessions.slice().sort(cmp) : sessions.slice()
  }

  // The List's items (loose cards and groups, as orderedItems returns them) in `mode`.
  // A group's members are sorted, and the group ranks by its first member once sorted.
  function sortItems(items, byKey, mode, timeOf) {
    const cmp = comparator(normalizeMode(mode), timeOf)
    if (!cmp) return items
    const sessionOf = (k) => byKey.get(k) || {}
    const sorted = items.map(it => it.kind === 'group'
      ? { ...it, members: it.members.slice().sort((a, b) => cmp(sessionOf(a), sessionOf(b))) }
      : it)
    const lead = (it) => sessionOf(it.kind === 'group' ? it.members[0] : it.key)
    return sorted.sort((a, b) => cmp(lead(a), lead(b)))
  }

  return { MODES, normalizeMode, ticketParts, sortSessions, sortItems }
})
