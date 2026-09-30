// How smooth the app is while you scroll: ⌥⌘P records the gap between frames for ten
// seconds, then says it in one line (and copies it) to paste into a bug report. Chromium
// numbers are not WKWebView's, so this runs in the real app. The pure part is here; UMD like
// the other lib/ models: window.CSMFrameProbe in the renderer, require() in jest.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMFrameProbe = api
})(typeof self !== 'undefined' ? self : this, function () {
  /** Frame timestamps (ms) → the gaps between them, summarised. */
  function stats(times) {
    const gaps = []
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1])
    if (!gaps.length) return { frames: 0, fps: 0, p50: 0, p95: 0, max: 0, over33: 0, over50: 0 }
    const sorted = gaps.slice().sort((a, b) => a - b)
    const at = (q) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))])
    const span = times[times.length - 1] - times[0]
    return {
      frames: gaps.length,
      fps: span > 0 ? Math.round(gaps.length / span * 1000) : 0,
      p50: at(0.5), p95: at(0.95), max: Math.round(sorted[sorted.length - 1]),
      over33: gaps.filter(g => g > 33).length,
      over50: gaps.filter(g => g > 50).length,
    }
  }

  function summary(s, ctx) {
    const extra = ctx && ctx.terminals != null ? ` · terminals ${ctx.terminals}` : ''
    return `Scroll: ${s.fps} fps · p50 ${s.p50} ms · p95 ${s.p95} ms · max ${s.max} ms · ${s.over33} frames over 33 ms${extra}`
  }

  /** Record for `ms`, then resolve with the timestamps. */
  function record(ms) {
    return new Promise(resolve => {
      const times = []
      const start = performance.now()
      const tick = (t) => { times.push(t); if (t - start < ms) requestAnimationFrame(tick); else resolve(times) }
      requestAnimationFrame(tick)
    })
  }

  return { stats, summary, record }
})
