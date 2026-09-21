// What the search box matches a session against.
// UMD: window.CSMSearch in the renderer, require() in jest. Pure, no DOM.
//
// This lives here rather than in app.js because it is exactly the shape of logic that
// silently loses a field: a session's references moved from a single `ticket` / `prLink`
// to `tickets` / `prLinks` lists, and the matcher was never told — so a pull request was
// unsearchable, and only the FIRST ticket of a session could be found.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMSearch = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // A session carries its references as a list plus a legacy primary. Read the list,
  // fall back to the primary, so an older payload still resolves.
  function linksOf(s, listKey, primaryKey) {
    const list = Array.isArray(s[listKey]) ? s[listKey].filter(Boolean) : []
    if (list.length) return list
    return s[primaryKey] ? [s[primaryKey]] : []
  }
  const prLinksOf = (s) => linksOf(s, 'prLinks', 'prLink')
  // Junk guard: a frontmatter `ticket: ""` that survived as quotes is not a ticket.
  const ticketsOf = (s) => linksOf(s, 'tickets', 'ticket').filter(t => /[a-z0-9]/i.test(t))

  // '63' from a pull-request URL, so typing the bare number finds it.
  function prNumbersOf(s) {
    const out = []
    for (const url of prLinksOf(s)) {
      const m = /\/pull\/(\d+)/.exec(url || '')
      if (m) out.push(m[1], '#' + m[1])
    }
    return out
  }

  // Every string a query may match. Kept as one list so adding a searchable field is
  // one line here and cannot be forgotten by one of several call sites.
  function haystack(s) {
    return [
      s.name, s.category, s.goal, s.cwd, s.gitBranch || s.branch,
      ...ticketsOf(s),
      ...prLinksOf(s),
      ...prNumbersOf(s),
    ].filter(v => typeof v === 'string' && v)
  }

  function matchesSearch(s, query) {
    if (!query) return true
    const q = String(query).trim().toLowerCase()
    if (!q) return true
    return haystack(s).some(v => v.toLowerCase().includes(q))
  }

  return { linksOf, prLinksOf, ticketsOf, prNumbersOf, haystack, matchesSearch }
})
