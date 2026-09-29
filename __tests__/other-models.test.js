const M = require('../renderer/lib/other-models')

const CLAUDE_MODELS = [['', ''], ['opus[1m]', 'Opus 5 (1M context)'], ['opus', 'Opus 5'], ['haiku', 'Haiku 4.5']]

describe('other models', () => {
  test('each invitee is named by its model first', () => {
    expect(M.label('codex', '')).toBe('GPT (Codex)')
    expect(M.label('codex', 'gpt-5.4')).toBe('GPT · gpt-5.4 (Codex)')
    expect(M.label('copilot', '')).toBe('Copilot')
    expect(M.label('copilot', 'auto')).toBe('Copilot')
    expect(M.label('copilot', 'gpt-5.4')).toBe('Copilot · gpt-5.4')
    expect(M.label('claude', 'opus[1m]', CLAUDE_MODELS)).toBe('Claude · Opus 5 (1M context)')
    expect(M.label('claude', 'sonnet', CLAUDE_MODELS)).toBe('Claude · sonnet')
    expect(M.label('claude', '', CLAUDE_MODELS)).toBe('Claude')
  })

  test('ids are unique, the same CLI twice gets a suffix', () => {
    const inv = M.withIds([{ cli: 'copilot', model: '' }, { cli: 'copilot', model: 'gpt-5.4' }, { cli: 'codex', model: '' }, { cli: 'claude', model: 'opus[1m]' }], CLAUDE_MODELS)
    expect(inv.map(i => i.id)).toEqual(['copilot', 'copilot-2', 'gpt', 'claude-opus-1m'])
    expect(inv[1].label).toBe('Copilot · gpt-5.4')
    expect(inv[0].model).toBe('')
  })

  test('auto is Copilot choosing, so it is sent as no model at all', () => {
    expect(M.withIds([{ cli: 'copilot', model: 'auto' }])[0].model).toBe('')
  })

  test('a model name must start with a letter or digit', () => {
    expect(M.validModel('opus[1m]')).toBe(true)
    expect(M.validModel('gpt-5.4')).toBe(true)
    expect(M.validModel('-x')).toBe(false)
    expect(M.validModel('a;rm')).toBe(false)
    expect(M.validModel('')).toBe(true)
  })

  test('the chip names the models, short and without repeats', () => {
    expect(M.chip([])).toBe('')
    expect(M.chip(M.withIds([{ cli: 'codex' }, { cli: 'copilot' }]))).toBe('+ GPT, Copilot')
    expect(M.chip(M.withIds([{ cli: 'copilot' }, { cli: 'copilot', model: 'x' }, { cli: 'codex' }, { cli: 'claude', model: 'opus' }, { cli: 'claude', model: 'haiku' }]))).toBe('+ Copilot, GPT, Claude')
  })

  test('the invite line names every invitee and the guide, with the path quoted', () => {
    const line = M.inviteLine(M.withIds([{ cli: 'codex' }, { cli: 'copilot', model: 'gpt-5.4' }]), "/w/it's/notes.md")
    expect(line).toContain('GPT (Codex), Copilot · gpt-5.4')
    expect(line).toContain("ao_ask.py guide --session '/w/it'\\''s/notes.md'")
    expect(line).not.toContain('\n')
  })

  test('the line is pasted, then Enter is pressed apart', () => {
    expect(M.pasteThenEnter('hi')).toEqual(['\x1b[200~hi\x1b[201~', '\r'])
  })

  test('the latest two entries are open, older ones folded', () => {
    const e = M.entriesForDisplay({ entries: [1, 2, 3, 4].map(n => ({ id: 'j' + n, heading: '14:0' + n + ' · GPT', question: 'q', answer: 'a', state: 'done' })) })
    expect(e.map(x => x.folded)).toEqual([true, true, false, false])
    expect(M.entriesForDisplay(null)).toEqual([])
  })
})
