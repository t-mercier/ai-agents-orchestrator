// Shared session-skills sync summary. UMD: window.CSMSkillsUpdate in the renderer +
// require() in jest. Pure — no DOM, no window.api — so Settings' "Sync skills" button
// and the launch notice (renderer/app.js) report a SyncReport the same way instead of
// drifting apart. The app's skills are app-owned: syncs apply without asking, and this
// summary is the visibility that replaces the permission dialog — it must always name
// what changed, and name any edited copy that was restored (these skills are not the
// user's to edit; the person who forced one learns where the line is here).
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMSkillsUpdate = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Summarises a SyncReport (src-tauri/src/skills.rs sync_skills()) into one string.
  // `installed` filters out `lib` (always refreshed, never itself a slash-command
  // skill worth naming).
  function syncResultText(report) {
    if (report.skipped_ahead) {
      return 'Your installed skills are already at (or past) this app version — nothing was touched.'
    }
    const installed = (report.installed || []).filter(s => s !== 'lib')
    const updated = report.updated || []
    const restored = report.restored || []
    const bits = []
    if (installed.length) {
      bits.push(`Installed ${installed.length} new skill${installed.length === 1 ? '' : 's'}: ${installed.join(', ')}.`)
    }
    if (updated.length) {
      bits.push(`Updated ${updated.length} to this app version: ${updated.join(', ')}.`)
    }
    if (restored.length) {
      bits.push(`${restored.join(', ')} had been edited and ${restored.length === 1 ? 'was' : 'were'} restored — these skills are the app's; for different behaviour, copy one under another name.`)
    }
    if (!bits.length) bits.push('Already up to date.')
    return bits.join(' ')
  }

  // The launch notice. A skill that was edited is ALSO in `updated` (the sync rewrote it),
  // so naming both lists put the same names twice in one sentence and announced
  // "nothing to do" immediately before saying something had been undone. The restore is
  // the news; everything else is a receipt, and the two are separate sentences.
  function launchNoticeText({ installed = [], updated = [], restored = [] } = {}) {
    const back = [...new Set(restored)].sort()
    const backSet = new Set(back)
    const routine = [...new Set([...installed.filter(s => s !== 'lib'), ...updated])]
      .filter(n => !backSet.has(n))
      .sort()
    const bits = []
    if (back.length) {
      const list = back.join(', ')
      bits.push(
        back.length === 1
          ? `${list} had been edited outside the app and was put back to this version.`
          : `${list} had been edited outside the app and were put back to this version.`)
      bits.push("These are the app's own skills — for different behaviour, copy one under another name.")
    }
    if (routine.length) {
      bits.push(back.length
        ? `Also updated: ${routine.join(', ')} — nothing to do.`
        : `Skills updated for this version: ${routine.join(', ')} — nothing to do.`)
    }
    return bits.join(' ')
  }

  return { syncResultText, launchNoticeText }
})
