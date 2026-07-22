// Pointer-event drag for the List view (WKWebView's HTML5 DnD is unreliable).
// A floating ghost follows the cursor; the drop target is resolved via
// elementFromPoint reading data-* attributes. Draggable elements carry
// [data-drag-kind] + [data-drag-id]; drop containers carry [data-drop-key]
// (+ [data-drop-accept] listing accepted kinds, space-separated). A 5px
// threshold preserves plain clicks. UMD: window.CSMDragList.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMDragList = api
})(typeof self !== 'undefined' ? self : this, function () {
  let insEl = null
  let mergeEl = null
  function clearIns() { if (insEl) insEl.style.display = 'none' }
  function clearMerge() { if (mergeEl) { mergeEl.classList.remove('dl-merge'); mergeEl = null } }
  function showIns(container, items, index) {
    if (!insEl) { insEl = document.createElement('div'); insEl.className = 'dl-ins'; document.body.appendChild(insEl) }
    const br = container.getBoundingClientRect()
    let y
    if (items[index]) y = items[index].getBoundingClientRect().top - 3
    else if (items.length) y = items[items.length - 1].getBoundingClientRect().bottom + 3
    else y = br.top + 4
    insEl.style.left = `${br.left + 4}px`; insEl.style.width = `${br.width - 8}px`
    insEl.style.top = `${Math.round(y)}px`; insEl.style.display = 'block'
  }

  function init(opts) {
    const root = opts.root, onReorder = opts.onReorder
    let drag = null
    root.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const handle = e.target.closest('[data-drag-kind]')
      if (!handle) return
      // Never start from interactive controls inside a draggable (buttons/inputs/links).
      if (e.target.closest('button, input, a, .path-link, [data-nodrag]')) return
      e.preventDefault()
      drag = { kind: handle.dataset.dragKind, id: handle.dataset.dragId, el: handle, x: e.clientX, y: e.clientY, active: false, ghost: null, drop: null }
      // Capture the source container for same-category guard on session drops.
      const src = handle.closest('[data-drop-key]')
      drag.srcKey = src ? src.dataset.dropKey : null
    })
    document.addEventListener('mousemove', (e) => {
      if (!drag) return
      if (!drag.active) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) return
        drag.active = true; window._listDragging = true
        drag.el.classList.add('dl-dragging')
        const r = drag.el.getBoundingClientRect()
        drag.offX = e.clientX - r.left; drag.offY = e.clientY - r.top
        const ghost = drag.el.cloneNode(true); ghost.classList.add('dl-ghost'); ghost.style.width = `${r.width}px`
        drag.ghost = ghost; document.body.appendChild(ghost); document.body.classList.add('dl-drag-active')
      }
      drag.ghost.style.left = `${e.clientX - drag.offX}px`; drag.ghost.style.top = `${e.clientY - drag.offY}px`
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const container = el && el.closest ? el.closest('[data-drop-key]') : null
      drag.drop = null; drag.merge = null; clearIns(); clearMerge()
      if (!container) return
      const accept = (container.dataset.dropAccept || '').split(/\s+/)
      if (!accept.includes(drag.kind)) return           // cross-container / wrong kind → no-op
      const catOf = (key) => {
        if (!key) return ''
        if (key.startsWith('grp:')) return key.slice(4, key.lastIndexOf(':'))
        return key.replace(/^cat:/, '')
      }
      if (drag.kind === 'session') {
        if (catOf(drag.srcKey) !== catOf(container.dataset.dropKey)) return   // same-category only
        // Merge detection: only in cat: containers (not grp: bodies), check middle band of session cards
        if (container.dataset.dropKey.startsWith('cat:')) {
          const card = el && el.closest ? el.closest('.list-drag-item[data-drag-kind="session"]') : null
          if (card && card !== drag.el && !card.classList.contains('dl-dragging')) {
            const r = card.getBoundingClientRect()
            const rel = (e.clientY - r.top) / r.height
            if (rel > 0.28 && rel < 0.72) {
              // Merge target found
              clearMerge()
              mergeEl = card
              mergeEl.classList.add('dl-merge')
              drag.merge = { targetId: card.dataset.dragId, category: catOf(container.dataset.dropKey) }
              return
            }
          }
        }
      }
      const items = [...container.querySelectorAll(':scope > [data-drag-kind]')].filter(c => c !== drag.el && !c.classList.contains('dl-dragging'))
      let index = items.length
      for (let k = 0; k < items.length; k++) { const r = items[k].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { index = k; break } }
      showIns(container, items, index)
      drag.drop = { containerKey: container.dataset.dropKey, index }
    })
    document.addEventListener('mouseup', () => {
      if (!drag) return
      const d = drag; drag = null
      if (d.ghost) d.ghost.remove()
      if (d.el) d.el.classList.remove('dl-dragging')
      document.body.classList.remove('dl-drag-active'); clearIns(); clearMerge()
      window._listDragging = false
      if (d.active && d.merge) {
        onReorder({ kind: d.kind, id: d.id, action: 'merge', targetId: d.merge.targetId, containerKey: 'cat:' + d.merge.category })
      } else if (d.active && d.drop) {
        onReorder({ kind: d.kind, id: d.id, containerKey: d.drop.containerKey, index: d.drop.index })
      }
    })
  }
  return { init }
})
