const F = require('../renderer/lib/frame-probe')

describe('frame probe', () => {
  test('frame gaps become the numbers that tell smooth from janky', () => {
    // 10 frames at 16 ms, then one of 100 ms and one of 40 ms.
    const t = [0]; for (let i = 1; i <= 10; i++) t.push(i * 16); t.push(260, 300)
    const s = F.stats(t)
    expect(s.frames).toBe(12)
    expect(s.p50).toBe(16)
    expect(s.max).toBe(100)
    expect(s.over33).toBe(2)
    expect(s.over50).toBe(1)
    expect(s.fps).toBe(40)
  })

  test('the summary is one line to paste', () => {
    const line = F.summary(F.stats([0, 16, 32, 48]), { terminals: 3 })
    expect(line).toMatch(/^Scroll: 63 fps · p50 16 ms · p95 16 ms · max 16 ms · 0 frames over 33 ms · terminals 3$/)
  })

  test('too few frames says so instead of dividing by nothing', () => {
    expect(F.stats([5]).frames).toBe(0)
  })
})
