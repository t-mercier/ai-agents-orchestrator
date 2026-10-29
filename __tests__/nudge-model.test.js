const N = require('../renderer/lib/nudge-model')

const NOW = new Date(2026, 9, 13, 9, 0).getTime()   // Tue 13 Oct 2026, 09:00 local
const H = 3600_000, D = 24 * H
const S = (o) => ({ name: o.name, notesPath: `/w/${o.name}/notes.md`, state: 'active', status: 'idle',
  lastActivityAt: new Date(NOW - H).toISOString(), nextSteps: null, ticketStates: [], prLinks: [], ...o })

describe('hashLine / openSteps', () => {
  test('a line hash is stable and 8 hex chars', () => {
    expect(N.hashLine('- [ ] 👤 take the capture')).toBe(N.hashLine('- [ ] 👤 take the capture'))
    expect(N.hashLine('a')).toMatch(/^[0-9a-f]{8}$/)
    expect(N.hashLine('a')).not.toBe(N.hashLine('b'))
  })
  test('only unticked boxes count, in order', () => {
    expect(N.openSteps('- [ ] one\n- [x] done\n1. numbered\n- [ ]   two  \n')).toEqual(['one', 'two'])
    expect(N.openSteps(null)).toEqual([])
  })
})

describe('collect', () => {
  const base = { stale: [], prs: {}, triage: {}, now: NOW, staleDays: 3 }
  test('a waiting session is a fact keyed by its notes path', () => {
    const f = N.collect({ ...base, live: [S({ name: 'a', status: 'waiting' })] })
    expect(f.find(x => x.kind === 'waiting')).toMatchObject({ key: expect.stringMatching(/^waiting\|\/w\/a\/notes\.md\|/), session: 'a' })
  })
  test('a renamed session keeps its keys', () => {
    const a = N.collect({ ...base, live: [S({ name: 'a', status: 'waiting', nextSteps: '- [ ] 👤 x' })] }).map(x => x.key)
    const b = N.collect({ ...base, live: [S({ name: 'renamed', notesPath: '/w/a/notes.md', status: 'waiting', nextSteps: '- [ ] 👤 x' })] }).map(x => x.key)
    expect(b).toEqual(a)
  })
  test('👤 marks a task for you; other lines are untriaged unless triage says so', () => {
    const live = [S({ name: 'a', nextSteps: '- [ ] 👤 take the capture\n- [ ] refresh the permalink\n- [ ] check CI' })]
    const triage = { [N.hashLine('check CI')]: 'agent' }
    const tasks = N.collect({ ...base, live, triage }).filter(x => x.kind === 'task')
    expect(tasks.map(t => [t.text, t.owner])).toEqual([['👤 take the capture', 'you'], ['refresh the permalink', 'untriaged']])
  })
  test('a triaged "you" line counts as yours', () => {
    const live = [S({ name: 'a', nextSteps: '- [ ] answer the reviewer' })]
    const t = N.collect({ ...base, live, triage: { [N.hashLine('answer the reviewer')]: 'you' } }).find(x => x.kind === 'task')
    expect(t.owner).toBe('you')
  })
  test('a PR is keyed by its state; tickets are not facts', () => {
    const live = [S({ name: 'a', prLinks: ['https://g/o/r/pull/12'], ticketStates: ['FEAT-1: In Review'] })]
    const f = N.collect({ ...base, live, prs: { 'https://g/o/r/pull/12': { state: 'merged', title: 'fix' } } })
    expect(f.map(x => x.key)).toContain('pr|https://g/o/r/pull/12|merged')
    expect(f.filter(x => x.kind === 'ticket')).toEqual([])
  })
  test('stale: open and quiet for more than N days; a recent one is not', () => {
    const old = S({ name: 'old', state: 'stale', lastActivityAt: new Date(NOW - 4 * D).toISOString(), nextSteps: '- [ ] map headers' })
    const fresh = S({ name: 'fresh', state: 'stale', lastActivityAt: new Date(NOW - 2 * D).toISOString() })
    const f = N.collect({ ...base, live: [], stale: [old, fresh] }).filter(x => x.kind === 'stale')
    expect(f).toEqual([expect.objectContaining({ key: 'stale|/w/old/notes.md', text: 'map headers' })])
  })
  test('a busy session is a fact, so a finished turn can be seen', () => {
    expect(N.collect({ ...base, live: [S({ name: 'a', status: 'busy' })] }).some(x => x.kind === 'busy')).toBe(true)
  })
})

describe('momentFor', () => {
  test('first foreground of the day after 05:00 with 4 h away is the morning', () => {
    expect(N.momentFor({ now: NOW, lastVisit: NOW - 14 * H, lastBlur: NOW - 14 * H })).toBe('morning')
  })
  test('before 05:00 it is not the morning', () => {
    const night = new Date(2026, 9, 13, 4, 30).getTime()
    expect(N.momentFor({ now: night, lastVisit: night - 6 * H, lastBlur: night - 6 * H })).toBe('back')
  })
  test('30 min away is a pause; 10 min is nothing', () => {
    expect(N.momentFor({ now: NOW, lastVisit: NOW - 31 * 60_000, lastBlur: NOW - 31 * 60_000 })).toBe('back')
    expect(N.momentFor({ now: NOW, lastVisit: NOW - 10 * 60_000, lastBlur: NOW - 10 * 60_000 })).toBe(null)
  })
  test('the very first launch is the morning', () => {
    expect(N.momentFor({ now: NOW, lastVisit: null, lastBlur: null })).toBe('morning')
  })
  test('a last visit in the future (clock moved back) is no baseline, not a negative pause', () => {
    expect(N.momentFor({ now: NOW, lastVisit: NOW + 2 * H, lastBlur: NOW + 2 * H })).toBe('morning')
  })
})

describe('inQuiet', () => {
  const q = { from: '22:00', to: '07:00' }
  const at = (h, m) => new Date(2026, 9, 13, h, m).getTime()
  test('a window across midnight', () => {
    expect(N.inQuiet(at(23, 30), q)).toBe(true)
    expect(N.inQuiet(at(6, 59), q)).toBe(true)
    expect(N.inQuiet(at(7, 0), q)).toBe(false)
    expect(N.inQuiet(at(12, 0), q)).toBe(false)
  })
  test('a window within a day, and none', () => {
    expect(N.inQuiet(at(12, 30), { from: '12:00', to: '13:00' })).toBe(true)
    expect(N.inQuiet(at(12, 30), null)).toBe(false)
  })
})

describe('decide', () => {
  const on = { nudges: true, quietHours: null, staleDays: 3 }
  const facts = (live, stale = []) => N.collect({ live, stale, prs: {}, triage: {}, now: NOW, staleDays: 3 })
  const waitingA = S({ name: 'a', status: 'waiting', nextSteps: '- [ ] 👤 take the capture' })
  const old = S({ name: 'old', state: 'stale', lastActivityAt: new Date(NOW - 5 * D).toISOString() })

  test('morning: everything open, in order waiting → you → stale count', () => {
    const d = N.decide({ moment: 'morning', facts: facts([waitingA], [old]), previous: null, said: {}, now: NOW, settings: on })
    expect(d.items.map(i => i.kind)).toEqual(['waiting', 'task', 'staleCount'])
    expect(d.items[2]).toMatchObject({ count: 1, days: 3 })
  })
  test('back: only what changed; nothing changed → null', () => {
    const f = facts([waitingA])
    expect(N.decide({ moment: 'back', facts: f, previous: f, said: {}, now: NOW, settings: on })).toBe(null)
    const g = facts([waitingA, S({ name: 'b', status: 'waiting' })])
    expect(N.decide({ moment: 'back', facts: g, previous: f, said: {}, now: NOW, settings: on }).items.map(i => i.session)).toEqual(['b'])
  })
  test('back without a baseline takes the morning shape instead of calling everything new', () => {
    const d = N.decide({ moment: 'back', facts: facts([waitingA], [old]), previous: null, said: {}, now: NOW, settings: on })
    expect(d.items.map(i => i.kind)).toEqual(['waiting', 'task', 'staleCount'])
  })
  test('a fact already said is not said again on back or moved', () => {
    const prev = facts([])
    const f = facts([waitingA])
    const said = { [f.find(x => x.kind === 'waiting').key]: '2026-10-13', [f.find(x => x.kind === 'task').key]: '2026-10-13' }
    expect(N.decide({ moment: 'moved', facts: f, previous: prev, said, now: NOW, settings: on })).toBe(null)
  })
  test('morning repeats a still-true fact once a day, not twice', () => {
    const f = facts([waitingA])
    const wk = f.find(x => x.kind === 'waiting').key
    const yesterday = { [wk]: '2026-10-12' }
    expect(N.decide({ moment: 'morning', facts: f, previous: f, said: yesterday, now: NOW, settings: on }).items[0].kind).toBe('waiting')
    const today = { [wk]: '2026-10-13' }
    expect(N.decide({ moment: 'morning', facts: f, previous: f, said: today, now: NOW, settings: on }).items.map(i => i.kind)).not.toContain('waiting')
  })
  test('a ticked task drops out: it is no longer a fact', () => {
    const f = facts([S({ name: 'a', nextSteps: '- [x] 👤 take the capture' })])
    expect(f.some(x => x.kind === 'task')).toBe(false)
  })
  test('busy → idle is a finished turn: on a moved case it waits for later, back from a pause it is said', () => {
    const prev = facts([S({ name: 'a', status: 'busy' })])
    const d = N.decide({ moment: 'moved', facts: facts([S({ name: 'a', status: 'idle' })]), previous: prev, said: {}, now: NOW, settings: on })
    expect(d.items).toEqual([])
    expect(d.later).toEqual([expect.objectContaining({ kind: 'finished', session: 'a' })])
    expect(d.keys).toEqual([])
  })
  test('a finished turn kept for later is due after an hour, unless its session was visited or runs again', () => {
    const q = [{ key: 'finished|/a|1', kind: 'finished', session: 'a', notesPath: '/a', since: 0 },
      { key: 'finished|/b|1', kind: 'finished', session: 'b', notesPath: '/b', since: 0 },
      { key: 'finished|/c|1', kind: 'finished', session: 'c', notesPath: '/c', since: 0 }]
    const early = N.dueLater(q, { now: N.LATER_MS - 1 })
    expect(early.due).toEqual([]); expect(early.keep).toHaveLength(3)
    const r = N.dueLater(q, { visits: { '/b': 10 }, facts: [{ kind: 'busy', notesPath: '/c' }], now: N.LATER_MS })
    expect(r.due.map(i => i.session)).toEqual(['a'])
    expect(r.due[0].later).toBe(true)
    expect(r.keep).toEqual([])
    expect(N.template(r.due)).toBe('By the way, [[session:a]] finished its turn.')
    expect(N.template(r.due, 0, 'fr')).toBe('Au fait, [[session:a]] a fini son tour.')
  })
  test('a merged PR is news; an open one is not', () => {
    const live = [S({ name: 'a', prLinks: ['u'] })]
    const prev = N.collect({ live, prs: { u: { state: 'open' } }, triage: {}, now: NOW, staleDays: 3 })
    const cur = N.collect({ live, prs: { u: { state: 'merged', title: 'fix' } }, triage: {}, now: NOW, staleDays: 3 })
    expect(N.decide({ moment: 'moved', facts: cur, previous: prev, said: {}, now: NOW, settings: on }).items[0]).toMatchObject({ kind: 'pr', state: 'merged' })
    expect(N.decide({ moment: 'moved', facts: prev, previous: [], said: {}, now: NOW, settings: on })).toBe(null)
  })
  // A ticket status copied into notes.md can be days old, and a merged PR in a session that
  // still has open PRs asks nothing of the person: neither is said.
  test('a merged PR is news only when it is the last of its session to land', () => {
    const live = [S({ name: 'a', prLinks: ['u', 'v'], nextSteps: '- [ ] 👤 check it' })]
    const prev = N.collect({ live, prs: { u: { state: 'open' }, v: { state: 'draft' } }, triage: {}, now: NOW, staleDays: 3 })
    const half = N.collect({ live, prs: { u: { state: 'merged' }, v: { state: 'draft' } }, triage: {}, now: NOW, staleDays: 3 })
    expect(N.decide({ moment: 'moved', facts: half, previous: prev, said: {}, now: NOW, settings: on })).toBe(null)
    const all = N.collect({ live, prs: { u: { state: 'merged' }, v: { state: 'closed' } }, triage: {}, now: NOW, staleDays: 3 })
    const d = N.decide({ moment: 'moved', facts: all, previous: half, said: {}, now: NOW, settings: on })
    expect(d.items.map(i => i.key)).toEqual(['pr|v|closed'])
    expect(N.template(d.items)).toBe('Moved in [[session:a]]: PR "" closed, ready to close.')
  })
  // A link attached today to a PR merged two weeks ago is not news: only a state the
  // baseline saw change is.
  test('a PR seen for the first time is not news', () => {
    const before = N.collect({ live: [S({ name: 'a' })], prs: {}, triage: {}, now: NOW, staleDays: 3 })
    const live = [S({ name: 'a', prLinks: ['https://g/o/r/pull/12'] })]
    const cur = N.collect({ live, prs: { 'https://g/o/r/pull/12': { state: 'merged', title: 'old' } }, triage: {}, now: NOW, staleDays: 3 })
    expect(N.decide({ moment: 'moved', facts: cur, previous: before, said: {}, now: NOW, settings: on })).toBe(null)
    expect(N.decide({ moment: 'morning', facts: cur, previous: before, said: {}, now: NOW, settings: on })).toBe(null)
  })
  test('nudges off, or quiet hours, say nothing', () => {
    const f = facts([waitingA])
    expect(N.decide({ moment: 'morning', facts: f, previous: null, said: {}, now: NOW, settings: { ...on, nudges: false } })).toBe(null)
    expect(N.decide({ moment: 'morning', facts: f, previous: null, said: {}, now: NOW, settings: { ...on, quietHours: { from: '08:00', to: '10:00' } } })).toBe(null)
  })
  test('every waiting agent is said, the steps stop at the cap, the rest is counted', () => {
    const steps = Array.from({ length: 8 }, (_, i) => `- [ ] 👤 step ${i}`).join('\n')
    const f = facts([S({ name: 'a', status: 'waiting', nextSteps: steps }), S({ name: 'b', status: 'waiting' })])
    const d = N.decide({ moment: 'morning', facts: f, previous: null, said: {}, now: NOW, settings: on })
    expect(d.items.filter(i => i.kind === 'waiting')).toHaveLength(2)
    expect(d.items.filter(i => i.kind === 'task')).toHaveLength(N.MAX_TASKS)
    expect(d.more).toBe(8 - N.MAX_TASKS)
    expect(d.keys).toEqual(d.items.map(i => i.key))
    expect(d.keys).toHaveLength(2 + N.MAX_TASKS)
  })
  test('the steps named rotate: the next morning names the ones left out first', () => {
    const steps = Array.from({ length: 8 }, (_, i) => `- [ ] 👤 step ${i}`).join('\n')
    const f = facts([S({ name: 'a', nextSteps: steps })])
    const day1 = N.decide({ moment: 'morning', facts: f, previous: null, said: {}, now: NOW, settings: on })
    const said = Object.fromEntries(day1.keys.map(k => [k, '2026-10-12']))
    const day2 = N.decide({ moment: 'morning', facts: f, previous: f, said, now: NOW, settings: on })
    expect(day2.items.filter(i => i.kind === 'task')).toHaveLength(N.MAX_TASKS)
    const older = { ...said }; for (const k of day1.keys.slice(0, 2)) older[k] = '2026-10-10'
    const day3 = N.decide({ moment: 'morning', facts: f, previous: f, said: older, now: NOW, settings: on })
    expect(day3.items.map(i => i.text)).toEqual(expect.arrayContaining(['👤 step 0', '👤 step 1']))
    expect(day2.items.filter(i => i.kind === 'task').map(i => i.text)).toEqual(expect.arrayContaining(['👤 step 5', '👤 step 6', '👤 step 7']))
  })
  test('a session is named once even when its steps are not next to each other', () => {
    const t = N.template([{ kind: 'task', session: 'a', notesPath: '/a', text: 'one' }, { kind: 'task', session: 'b', notesPath: '/b', text: 'two' },
      { kind: 'task', session: 'a', notesPath: '/a', text: 'three' }, { kind: 'task', session: 'a', notesPath: '/other', text: 'four' }])
    expect(t.split('\n')).toEqual(['For [[session:a]]:', '- one', '- three', 'For [[session:b]]:', '- two', 'For [[session:a]]:', '- four'])
  })
  test('on a moved case, the session open in front is recorded as said but not shown', () => {
    const prev = facts([S({ name: 'a', status: 'busy' }), S({ name: 'b', status: 'busy' })])
    const cur = facts([S({ name: 'a', status: 'waiting' }), S({ name: 'b', status: 'waiting' })])
    const hereA = prev.find(f => f.session === 'a').notesPath
    const d = N.decide({ moment: 'moved', facts: cur, previous: prev, said: {}, now: NOW, settings: on, here: hereA })
    expect(d.items.map(i => i.session)).toEqual(['b'])
    expect(d.keys.some(k => k.includes(hereA))).toBe(true)
    const only = N.decide({ moment: 'moved', facts: facts([S({ name: 'a', status: 'waiting' })]), previous: facts([S({ name: 'a', status: 'busy' })]), said: {}, now: NOW, settings: on, here: hereA })
    expect(only.items).toEqual([])
    expect(only.keys).toHaveLength(1)
  })
  test('the morning recap still names the session left selected', () => {
    const f = facts([waitingA])
    const d = N.decide({ moment: 'morning', facts: f, previous: null, said: {}, now: NOW, settings: on, here: f[0].notesPath })
    expect(d.items.map(i => i.kind)).toContain('waiting')
  })
  test('untriaged lines travel beside the items, not as items', () => {
    const d = N.decide({ moment: 'morning', facts: facts([S({ name: 'a', status: 'waiting', nextSteps: '- [ ] check CI' })]), previous: null, said: {}, now: NOW, settings: on })
    expect(d.items.map(i => i.kind)).toEqual(['waiting'])
    expect(d.untriaged.map(u => u.text)).toEqual(['check CI'])
  })
})

describe('wording', () => {
  test('the template names sessions as chips and counts untriaged lines', () => {
    const t = N.template([{ kind: 'waiting', session: 'a' }, { kind: 'task', session: 'a', text: '👤 take the capture' },
      { kind: 'staleCount', count: 6, days: 3 }], 2)
    expect(t).toContain('[[session:a]] is waiting on your answer.')
    expect(t).toContain('take the capture')
    expect(t).not.toContain('👤')
    expect(t).toContain('6 sessions have not moved for more than 3 days')
    expect(t).toContain('and 2 other open steps')
  })
  test('the steps sit under their session, named once, each cut to one line', () => {
    const long = 'decide with the owner whether the overlay keeps its own layer or moves into the shared style sheet'
    const t = N.template([{ kind: 'task', session: 'a', text: 'one' }, { kind: 'task', session: 'a', text: long },
      { kind: 'task', session: 'b', text: 'two' }])
    expect(t.split('\n')).toEqual(['For [[session:a]]:', '- one', `- ${N.short(long)}`, 'For [[session:b]]:', '- two'])
    expect(N.short(long).length).toBeLessThanOrEqual(70)
    expect(N.short(long).endsWith('…')).toBe(true)
    expect(N.short('short enough')).toBe('short enough')
  })
  test('the steps left out and the untriaged lines are one count', () => {
    expect(N.template([{ kind: 'waiting', session: 'a' }], 2, 'en', 3).split('\n').pop()).toBe('… and 5 other open steps.')
  })
  test('preview keeps three lines and says how many more', () => {
    expect(N.preview('1\n2\n3\n4\n5')).toBe('1\n2\n3\n… and 2 more things')
    expect(N.preview('1\n2')).toBe('1\n2')
    expect(N.preview('x\nFor a:\n- s1\n- s2', 2)).toBe('x\n… and 3 more things')
  })
  test('a message naming a session that is not in the facts is refused', () => {
    const f = [{ kind: 'waiting', session: 'a' }]
    expect(N.validMessage('[[session:a]] waits.', f)).toBe(true)
    expect(N.validMessage('[[session:ghost]] waits.', f)).toBe(false)
    expect(N.validMessage('', f)).toBe(false)
  })
  test('recap and reply stay under the cap, the recap cut first', () => {
    const out = N.withRecap('r'.repeat(9000), 'why is X waiting?', 8000)
    expect(out.length).toBeLessThanOrEqual(8000)
    expect(out.endsWith('why is X waiting?')).toBe(true)
  })
  test('the stale list is oldest first with its first step', () => {
    const l = N.staleList([{ kind: 'stale', session: 'b', at: 2, text: 's2' }, { kind: 'stale', session: 'a', at: 1, text: 's1' }])
    expect(l).toEqual([{ session: 'a', at: 1, step: 's1', shipped: false }, { session: 'b', at: 2, step: 's2', shipped: false }])
  })
  test('the payload caps untriaged lines at 40', () => {
    const u = Array.from({ length: 50 }, (_, i) => ({ hash: String(i).padStart(8, '0'), text: `l${i}`, session: 's' }))
    expect(N.payload({ moment: 'morning', items: [], untriaged: u, sample: '', name: 'Brutus', staleDays: 3 }).untriaged).toHaveLength(40)
    expect(N.payload({ moment: 'morning', items: [], untriaged: [], sample: '', name: 'Brutus', staleDays: 3, more: 4 }).more).toBe(4)
  })
})

// 2026-10-13, her decision: the fallback speaks the language Brutus uses with her.
describe('language of the fallback', () => {
  test('a French last message gives French; English or nothing gives the fallback', () => {
    expect(N.langOf('tu peux me dire qui attend ?')).toBe('fr')
    expect(N.langOf('Déjà fini ?')).toBe('fr')
    expect(N.langOf('what is waiting on me?')).toBe('en')
    expect(N.langOf('', 'fr')).toBe('fr')
    expect(N.langOf('', 'en')).toBe('en')
  })
  test('the French template keeps the chips and the counts', () => {
    const t = N.template([{ kind: 'waiting', session: 'a' }, { kind: 'task', session: 'a', text: '👤 faire la capture' },
      { kind: 'staleCount', count: 6, days: 3 }], 2, 'fr')
    expect(t).toContain('[[session:a]] attend ta réponse.')
    expect(t).toContain('faire la capture')
    expect(t).not.toContain('👤')
    expect(t).toContain('6 sessions n’ont pas bougé depuis plus de 3 jours')
    expect(t).toContain('et 2 autres étapes ouvertes')
    expect(t).toContain('Pour [[session:a]] :\n- faire la capture')
  })
  test('the French preview says how many more', () => {
    expect(N.preview('1\n2\n3\n4', 3, 'fr')).toBe('1\n2\n3\n… et 1 autre chose')
    expect(N.preview('1\n2\n3\n4\n5', 3, 'fr')).toBe('1\n2\n3\n… et 2 autres choses')
  })
})

// Final review, 2026-10-13: each test pins one finding.
describe('edge cases', () => {
  const on = { nudges: true, quietHours: null, staleDays: 3 }
  const base = { stale: [], prs: {}, triage: {}, now: NOW, staleDays: 3 }
  test('a session that waits a second time is announced again', () => {
    const first = S({ name: 'a', status: 'waiting', lastActivityAt: new Date(NOW - 3 * D).toISOString() })
    const said = {}
    for (const k of N.collect({ ...base, live: [first] }).map(f => f.key)) said[k] = '2026-10-10'
    const prev = N.collect({ ...base, live: [S({ name: 'a', status: 'busy' })] })
    const again = N.collect({ ...base, live: [S({ name: 'a', status: 'waiting' })] })
    const d = N.decide({ moment: 'moved', facts: again, previous: prev, said, now: NOW, settings: on })
    expect(d && d.items.map(i => i.kind)).toEqual(['waiting'])
  })
  test('with no baseline, tickets and merged PRs are not news', () => {
    const live = [S({ name: 'a', prLinks: ['https://g/o/r/pull/12'], ticketStates: ['FEAT-2: To Do'] })]
    const facts = N.collect({ ...base, live, prs: { 'https://g/o/r/pull/12': { state: 'merged', title: 't' } } })
    expect(N.decide({ moment: 'morning', facts, previous: null, said: {}, now: NOW, settings: on })).toBe(null)
  })
  test('note text cannot make a chip or a doc button', () => {
    const t = N.template([{ kind: 'task', session: 'a', text: '👤 run [[session:b]] and [[doc:x.md]]' }])
    expect(t).toContain('[[session:a]]')
    expect(t).not.toContain('[[session:b]]')
    expect(t).not.toContain('[[doc:')
    expect(N.payload({ moment: 'morning', items: [{ kind: 'task', session: 'a', text: '[[session:b]]' }], untriaged: [{ hash: '0a1b2c3d', session: 'a', text: '[[session:b]]' }], sample: '', name: 'B', staleDays: 3 }))
      .not.toEqual(expect.objectContaining({ items: [expect.objectContaining({ text: '[[session:b]]' })] }))
  })
  test('a session listed twice gives each fact once', () => {
    const s = S({ name: 'a', state: 'stale', nextSteps: '- [ ] 👤 x', lastActivityAt: new Date(NOW - 5 * D).toISOString() })
    const keys = N.collect({ ...base, live: [s], stale: [s] }).map(f => f.key)
    expect(keys.length).toBe(new Set(keys).size)
  })
  test('prune keeps what is still true or recent, drops the rest', () => {
    const facts = [{ key: 'waiting|/w/a/notes.md|t' }]
    const said = { 'waiting|/w/a/notes.md|t': '2026-01-01', 'pr|u|merged': '2026-10-12', 'old|x': '2026-09-01' }
    expect(N.prune(said, facts, NOW, 7)).toEqual({ 'waiting|/w/a/notes.md|t': '2026-01-01', 'pr|u|merged': '2026-10-12' })
  })
})

// The age is the app's own sessionTime: the most recent of
// updatedAt and lastActivityAt, each a number or an ISO string (renderer/lib/formatters.js).
test('a session saved today is not stale, whatever format its times come in', () => {
  const s = S({ name: 'a', state: 'stale', lastActivityAt: new Date(NOW - 5 * D).toISOString(), updatedAt: NOW - H })
  const f = N.collect({ live: [], stale: [s], prs: {}, triage: {}, now: NOW, staleDays: 3 })
  expect(f.some(x => x.kind === 'stale')).toBe(false)
  const n = S({ name: 'b', state: 'stale', lastActivityAt: NOW - 5 * D })
  expect(N.collect({ live: [], stale: [n], prs: {}, triage: {}, now: NOW, staleDays: 3 }).some(x => x.kind === 'stale')).toBe(true)
})

describe('wording of every kind', () => {
  const pr = { kind: 'pr', session: 'a', url: 'https://g/o/r/pull/12', text: 'Fix it', state: 'merged' }
  const ticket = { kind: 'ticket', session: 'a', text: 'FEAT-2', state: 'Done' }
  const finished = { kind: 'finished', session: 'a' }
  test('English', () => {
    expect(N.template([pr, ticket, finished]).split('\n')).toEqual([
      '[[session:a]] finished its turn.', 'Moved in [[session:a]]: PR #12 merged, FEAT-2 Done.'])
  })
  test('a PR URL without a number is named by its title', () => {
    expect(N.template([{ kind: 'pr', session: 'a', url: 'https://g/o/r/pull/12/', text: 'Fix it', state: 'merged' },
      { kind: 'pr', session: 'b', url: 'https://g/o/r', text: 'Other', state: 'closed' }])).toBe(
      'Moved in [[session:a]]: PR #12 merged.\nMoved in [[session:b]]: PR "Other" closed.')
  })
  test('French', () => {
    expect(N.template([pr, ticket, finished], 0, 'fr').split('\n')).toEqual([
      '[[session:a]] a fini son tour.', 'Ça a bougé dans [[session:a]] : PR #12 mergée, FEAT-2 en Done.'])
  })
})

describe('decide, the rarer paths', () => {
  const on = { nudges: true, quietHours: null, staleDays: 3 }
  const base = { stale: [], prs: {}, triage: {}, now: NOW, staleDays: 3 }
  test('a moved batch with no baseline says nothing', () => {
    const facts = N.collect({ ...base, live: [S({ name: 'a', status: 'waiting' })] })
    expect(N.decide({ moment: 'moved', facts, previous: null, said: {}, now: NOW, settings: on })).toBe(null)
  })
  test('the stale count is said once a day', () => {
    const old = S({ name: 'old', state: 'stale', lastActivityAt: new Date(NOW - 5 * D).toISOString() })
    const facts = N.collect({ ...base, stale: [old] })
    const first = N.decide({ moment: 'morning', facts, previous: null, said: {}, now: NOW, settings: on })
    expect(first.keys).toEqual(['stale-count|2026-10-13'])
    expect(N.decide({ moment: 'morning', facts, previous: null, said: { 'stale-count|2026-10-13': '2026-10-13' }, now: NOW, settings: on })).toBe(null)
  })
  test('the stale count uses the default number of days when settings give none', () => {
    const old = S({ name: 'old', state: 'stale', lastActivityAt: new Date(NOW - 5 * D).toISOString() })
    const d = N.decide({ moment: 'morning', facts: N.collect({ ...base, stale: [old] }), previous: null, said: {}, now: NOW, settings: { nudges: true } })
    expect(d.items[0].days).toBe(N.STALE_DAYS)
  })
  test('a slim baseline still shows a finished turn and what changed', () => {
    const busy = N.collect({ ...base, live: [S({ name: 'a', status: 'busy', nextSteps: '- [ ] 👤 x' })] })
    const slim = N.baseline(busy)
    expect(slim.every(f => !('text' in f))).toBe(true)
    const idle = N.collect({ ...base, live: [S({ name: 'a', nextSteps: '- [ ] 👤 x' })] })
    const d = N.decide({ moment: 'moved', facts: idle, previous: slim, said: {}, now: NOW, settings: on })
    expect(d.later.map(i => i.kind)).toEqual(['finished'])
    expect(N.decide({ moment: 'back', facts: idle, previous: slim, said: {}, now: NOW, settings: on }).items.map(i => i.kind)).toEqual(['finished'])
  })
  test('the baseline is capped', () => {
    const many = Array.from({ length: N.MAX_FACTS + 50 }, (_, i) => ({ key: `task|n|${i}`, kind: 'task', text: 'x' }))
    expect(N.baseline(many).length).toBe(N.MAX_FACTS)
  })
})

describe('what the model may write', () => {
  const facts = [{ session: 'a' }]
  test('a doc button or any other link kind in its message is refused', () => {
    expect(N.validMessage('[[session:a]] waits.', facts)).toBe(true)
    expect(N.validMessage('[[session:a]] see [[doc:notes.md]]', facts)).toBe(false)
    expect(N.validMessage('[[ session:a]] [[x:y]]', facts)).toBe(false)
  })
  test('a message over the cap is refused', () => {
    expect(N.validMessage('a'.repeat(N.MAX_MESSAGE + 1), facts)).toBe(false)
  })
})

describe('a session whose PRs all shipped', () => {
  const NOW2 = Date.now()
  const old = (o) => ({ state: 'stale', status: 'idle', notesPath: `/w/${o.name}/notes.md`, lastActivityAt: new Date(NOW2 - 5 * 86400_000).toISOString(), ...o })
  const merged = { 'https://github.com/o/r/pull/1': { state: 'merged' }, 'https://github.com/o/r/pull/2': { state: 'open' } }
  test('its steps are not said, and the stale list offers to close it', () => {
    const f = N.collect({ live: [], stale: [old({ name: 'done', prLinks: ['https://github.com/o/r/pull/1'], nextSteps: '- [ ] 👤 verify on the phone' })], prs: merged, triage: {}, now: NOW2 })
    expect(f.some(x => x.kind === 'task')).toBe(false)
    const l = N.staleList(f)
    expect(l[0]).toMatchObject({ step: '', shipped: true })
    expect(N.staleLines(l, 'en', () => 'd')).toBe('- [[session:done]], last active d, PR merged, ready to close')
    expect(N.staleLines(l, 'fr', () => 'd')).toBe('- [[session:done]], actif le d, PR mergée, prête à fermer')
  })
  test('one PR still open, or a state not known, keeps the steps', () => {
    for (const links of [['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/2'], ['https://github.com/o/r/pull/9']]) {
      const f = N.collect({ live: [], stale: [old({ name: 'wip', prLinks: links, nextSteps: '- [ ] 👤 verify on the phone' })], prs: merged, triage: {}, now: NOW2 })
      expect(f.some(x => x.kind === 'task')).toBe(true)
      expect(N.staleList(f)[0].shipped).toBe(false)
    }
  })
})

describe('the stale list', () => {
  const fmt = () => '10/10/2026'
  test('one line per session, with the step defanged, in the language of the nudge', () => {
    const stale = [{ session: 'old', at: 1, step: 'run [[session:b]]' }, { session: 'none', at: null, step: '' }]
    expect(N.staleLines(stale, 'en', fmt)).toBe('- [[session:old]], last active 10/10/2026, next: run [​[session:b]]\n- [[session:none]], no activity recorded')
    expect(N.staleLines(stale, 'fr', fmt)).toBe('- [[session:old]], actif le 10/10/2026, ensuite : run [​[session:b]]\n- [[session:none]], aucune activité')
  })
  test('the labels around a nudge come from the same words', () => {
    expect(N.words('fr')).toEqual(expect.objectContaining({ listAsk: 'Je te les liste ?', open: 'Ouvrir', later: 'OK' }))
    expect(N.words('xx').open).toBe('Open')
  })
})
