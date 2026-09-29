// Invited models: other models a session's agent consults read-only (skills/lib/ao_ask.py).
// This is the pure part the UI builds on: names, ids, the chip, the line typed into the
// session's terminal, and which thread entries show open. UMD like the other lib/ models:
// window.CSMOtherModels in the renderer, require() in jest. Spec:
// docs/superpowers/specs/2026-09-30-invite-models-design.md.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMOtherModels = api
})(typeof self !== 'undefined' ? self : this, function () {
  const CLIS = ['claude', 'codex', 'copilot']
  // A leading letter or digit, so a model can never be read as another option of the CLI.
  const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,63}$/
  const validModel = (m) => !m || MODEL_RE.test(m)
  // Copilot's "auto" is Copilot choosing: sent as no --model at all.
  const clean = (cli, model) => {
    const m = String(model || '').trim()
    return cli === 'copilot' && m === 'auto' ? '' : m
  }

  function label(cli, model, claudeModels) {
    const m = clean(cli, model)
    if (cli === 'codex') return m ? `GPT · ${m} (Codex)` : 'GPT (Codex)'
    if (cli === 'copilot') return m ? `Copilot · ${m}` : 'Copilot'
    if (cli === 'claude') {
      const known = (claudeModels || []).find(([id]) => id === m)
      return m ? `Claude · ${(known && known[1]) || m}` : 'Claude'
    }
    return m || cli
  }

  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const baseId = (cli, model) => cli === 'codex' ? 'gpt' : cli === 'claude' ? (model ? `claude-${slug(model)}` : 'claude') : cli

  /** Rows `{ cli, model }` as invitees `{ id, cli, model, label }`, ids unique. */
  function withIds(rows, claudeModels) {
    const used = new Set()
    return (rows || []).filter(r => CLIS.includes(r.cli)).map(r => {
      const model = clean(r.cli, r.model)
      const base = baseId(r.cli, model).slice(0, 29)
      let id = base
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`
      used.add(id)
      return { id, cli: r.cli, model, label: label(r.cli, model, claudeModels) }
    })
  }

  const SHORT = { claude: 'Claude', codex: 'GPT', copilot: 'Copilot' }
  function chip(invitees) {
    const names = []
    for (const i of invitees || []) {
      const n = SHORT[i.cli] || i.cli
      if (!names.includes(n)) names.push(n)
    }
    return names.length ? '+ ' + names.join(', ') : ''
  }

  const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
  const guide = (notesPath) => `python3 ~/.claude/skills/lib/ao_ask.py guide --session ${shq(notesPath)}`

  function inviteLine(invitees, notesPath) {
    const who = (invitees || []).map(i => i.label).join(', ')
    return `Other models are invited to this session: ${who}. To see how to consult them, run: ${guide(notesPath)}`
  }

  function dismissLine() {
    return 'The other models are no longer invited to this session: do not consult them any more.'
  }

  /** A TUI may take a fast burst of characters as a paste, where a \r inside is a newline:
   *  paste the text, then press Enter in a second write. */
  const pasteThenEnter = (text) => ['\x1b[200~' + text + '\x1b[201~', '\r']

  /** The thread's entries, the latest two open and older ones folded. */
  function entriesForDisplay(thread) {
    const e = (thread && thread.entries) || []
    return e.map((x, i) => ({ ...x, folded: i < e.length - 2 }))
  }

  return { CLIS, MODEL_RE, validModel, label, withIds, chip, guide, inviteLine, dismissLine, pasteThenEnter, entriesForDisplay }
})
