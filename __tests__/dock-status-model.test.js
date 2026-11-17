const { decide } = require('../renderer/lib/dock-status-model')

const live = (status) => ({ state: 'active', status })

describe('dock status decision', () => {
  test('no sessions means no badge', () => {
    expect(decide([])).toEqual({ kind: 'none', count: 0 })
    expect(decide(undefined)).toEqual({ kind: 'none', count: 0 })
  })

  test('idle sessions alone mean no badge', () => {
    expect(decide([live('idle'), live('idle')])).toEqual({ kind: 'none', count: 0 })
  })

  test('only busy sessions show the busy count', () => {
    expect(decide([live('busy'), live('idle'), live('busy')])).toEqual({ kind: 'busy', count: 2 })
  })

  test('only waiting sessions show the waiting count', () => {
    expect(decide([live('waiting')])).toEqual({ kind: 'waiting', count: 1 })
  })

  test('waiting wins over busy and shows the waiting count only', () => {
    expect(decide([live('busy'), live('waiting'), live('busy'), live('waiting')])).toEqual({ kind: 'waiting', count: 2 })
  })

  test('stale, closed and archived sessions are ignored, whatever their status', () => {
    const sessions = [
      { state: 'stale', status: 'waiting' },
      { state: 'stale', status: 'busy' },
      { state: 'closed', status: 'waiting' },
      { state: 'archived', status: 'busy' },
      live('idle'),
    ]
    expect(decide(sessions)).toEqual({ kind: 'none', count: 0 })
    expect(decide([...sessions, live('busy')])).toEqual({ kind: 'busy', count: 1 })
  })

  test('counts above 99 are passed through; the label cap is the backend\'s job', () => {
    const many = Array.from({ length: 120 }, () => live('busy'))
    expect(decide(many)).toEqual({ kind: 'busy', count: 120 })
    const waiting = Array.from({ length: 101 }, () => live('waiting'))
    expect(decide(waiting)).toEqual({ kind: 'waiting', count: 101 })
  })

  test('a session with no state or no status is not counted', () => {
    expect(decide([{ status: 'waiting' }, null, { state: 'active' }])).toEqual({ kind: 'none', count: 0 })
  })
})
