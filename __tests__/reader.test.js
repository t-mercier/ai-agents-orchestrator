const path = require('path')
const reader = require('../data/reader')

const FIXTURES_DIR = path.join(__dirname, 'fixtures')

describe('readSessions', () => {
  it('returns an array of session objects from a directory', () => {
    const sessions = reader.readSessions(path.join(FIXTURES_DIR, 'sessions'))
    expect(sessions).toHaveLength(2)
  })

  it('parses all required fields', () => {
    const sessions = reader.readSessions(path.join(FIXTURES_DIR, 'sessions'))
    const s = sessions.find(s => s.sessionId === 'abc123')
    expect(s).toMatchObject({
      sessionId: 'abc123',
      name: 'FEAT | my-feature',
      cwd: '/Users/fixture/my-project',
      pid: 12345,
      status: 'busy',
      updatedAt: '2026-06-01T10:00:00.000Z',
    })
  })

  it('returns empty array if directory does not exist', () => {
    const sessions = reader.readSessions('/nonexistent/dir')
    expect(sessions).toEqual([])
  })

  it('excludes Claude Code background jobs (kind:"bg")', () => {
    // bgjob.json is a --bg-pty-host fork; it must not surface as a session.
    const sessions = reader.readSessions(path.join(FIXTURES_DIR, 'sessions'))
    expect(sessions.find(s => s.sessionId === 'bgjob789')).toBeUndefined()
    expect(sessions.every(s => s.sessionId !== 'bgjob789')).toBe(true)
  })
})

describe('readActiveSessions', () => {
  it('returns a map of sessionId to metadata', () => {
    const active = reader.readActiveSessions(path.join(FIXTURES_DIR, 'active-sessions.json'))
    expect(active['abc123']).toMatchObject({
      category: 'FEAT',
      ticket: 'PROJ-1234',
    })
  })

  it('returns empty object if file does not exist', () => {
    expect(reader.readActiveSessions('/nonexistent.json')).toEqual({})
  })
})

describe('readNotesGoal', () => {
  it('extracts the Goal section', () => {
    const result = reader.readNotesGoal(path.join(FIXTURES_DIR, 'notes.md'))
    expect(result.goal).toBe('Fix the compile error in CI test TC8.')
  })

  it('extracts the Next steps section', () => {
    const result = reader.readNotesGoal(path.join(FIXTURES_DIR, 'notes.md'))
    expect(result.nextSteps).toContain('Run the tests locally.')
  })

  it('returns nulls if file does not exist', () => {
    expect(reader.readNotesGoal('/nonexistent.md')).toEqual({ goal: null, nextSteps: null })
  })
})

describe('readJsonl', () => {
  it('returns lastActivity text from the last assistant message', () => {
    const result = reader.readJsonl('/Users/fixture/my-project', 'abc123', path.join(FIXTURES_DIR, 'projects'))
    expect(result.lastActivity).toBe('Fix applied. Running tests now.')
  })

  it('returns gitBranch from the last event that has it', () => {
    const result = reader.readJsonl('/Users/fixture/my-project', 'abc123', path.join(FIXTURES_DIR, 'projects'))
    expect(result.gitBranch).toBe('feat/PROJ-1234-my-feature')
  })

  it('returns prLink from the last event that has it', () => {
    const result = reader.readJsonl('/Users/fixture/my-project', 'abc123', path.join(FIXTURES_DIR, 'projects'))
    expect(result.prLink).toBe('https://github.com/org/repo/pull/4892')
  })

  it('returns nulls if .jsonl file does not exist', () => {
    const result = reader.readJsonl('/nonexistent', 'nope', path.join(FIXTURES_DIR, 'projects'))
    expect(result).toEqual({ lastActivity: null, lastActivityAt: null, gitBranch: null, prLink: null })
  })
})

describe('getAllSessionData', () => {
  it('merges all sources into a unified session array', () => {
    const sessions = reader.getAllSessionData({
      sessionsDir: path.join(FIXTURES_DIR, 'sessions'),
      activeSessionsFile: path.join(FIXTURES_DIR, 'active-sessions.json'),
      projectsDir: path.join(FIXTURES_DIR, 'projects'),
      isAlive: () => true,
    })
    const abc = sessions.find(s => s.sessionId === 'abc123')
    expect(abc.status).toBe('busy')
    expect(abc.gitBranch).toBe('feat/PROJ-1234-my-feature')
    expect(abc.prLink).toBe('https://github.com/org/repo/pull/4892')
    expect(abc.ticket).toBe('PROJ-1234')
  })

  it('includes sessions not in active-sessions with null enrichment fields', () => {
    const sessions = reader.getAllSessionData({
      sessionsDir: path.join(FIXTURES_DIR, 'sessions'),
      activeSessionsFile: path.join(FIXTURES_DIR, 'active-sessions.json'),
      projectsDir: path.join(FIXTURES_DIR, 'projects'),
      isAlive: () => true,
    })
    const def = sessions.find(s => s.sessionId === 'def456')
    expect(def.ticket).toBeNull()
    expect(def.goal).toBeNull()
  })

  it('excludes sessions whose process is no longer alive', () => {
    const sessions = reader.getAllSessionData({
      sessionsDir: path.join(FIXTURES_DIR, 'sessions'),
      activeSessionsFile: path.join(FIXTURES_DIR, 'active-sessions.json'),
      projectsDir: path.join(FIXTURES_DIR, 'projects'),
      isAlive: (pid) => pid === 12345,  // only abc123 is "alive"
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('abc123')
  })
})

describe('scanAllNotesMd', () => {
  const SCAN_DIRS = [
    { base: path.join(FIXTURES_DIR, 'Work', 'FEAT'), category: 'FEAT' },
    { base: path.join(FIXTURES_DIR, 'PERSO'), category: 'PERSO' },
  ]

  it('finds all notes.md files across scan dirs', () => {
    const results = reader.scanAllNotesMd(SCAN_DIRS)
    expect(results).toHaveLength(2)
  })

  it('defaults its scan dirs from the shared config (no args → array, no throw)', () => {
    // Derivation correctness is covered in config.test.js; this asserts the wiring.
    expect(Array.isArray(reader.scanAllNotesMd())).toBe(true)
  })

  it('parses frontmatter fields correctly', () => {
    const results = reader.scanAllNotesMd(SCAN_DIRS)
    const closed = results.find(s => s.sessionId === 'closed001')
    expect(closed).toMatchObject({
      sessionId: 'closed001',
      category: 'FEAT',
      ticket: 'PROJ-9999',
      name: 'my-closed-feature',
    })
  })

  it('detects closed status (session history present, no ARCHIVED)', () => {
    const results = reader.scanAllNotesMd(SCAN_DIRS)
    const closed = results.find(s => s.sessionId === 'closed001')
    expect(closed.historyStatus).toBe('closed')
  })

  it('detects archived status (ARCHIVED in session history)', () => {
    const results = reader.scanAllNotesMd(SCAN_DIRS)
    const archived = results.find(s => s.sessionId === 'archived001')
    expect(archived.historyStatus).toBe('archived')
  })

  it('extracts the close date (last history entry) and archive date (ARCHIVED line)', () => {
    const results = reader.scanAllNotesMd(SCAN_DIRS)
    expect(results.find(s => s.sessionId === 'closed001').historyDate).toBe('2026-05-01 09:00')
    expect(results.find(s => s.sessionId === 'archived001').historyDate).toBe('2026-04-20 14:00')
  })

  it('returns empty array if scan dir does not exist', () => {
    const results = reader.scanAllNotesMd([{ base: '/nonexistent', category: 'FEAT' }])
    expect(results).toEqual([])
  })
})

describe('getHistoricalSessions', () => {
  const SCAN_DIRS = [
    { base: path.join(FIXTURES_DIR, 'Work', 'FEAT'), category: 'FEAT' },
    { base: path.join(FIXTURES_DIR, 'PERSO'), category: 'PERSO' },
  ]
  const RUNNING_IDS = new Set(['abc123', 'def456'])

  it('returns only closed sessions when status=closed', () => {
    const sessions = reader.getHistoricalSessions('closed', { scanDirs: SCAN_DIRS, runningIds: RUNNING_IDS })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('closed001')
  })

  it('returns only archived sessions when status=archived', () => {
    const sessions = reader.getHistoricalSessions('archived', { scanDirs: SCAN_DIRS, runningIds: RUNNING_IDS })
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('archived001')
  })

  it('surfaces a started-but-never-closed (open) session in the Closed tab', () => {
    // A session whose terminal was closed without /close has an empty Session
    // history (status "open") — it must still be findable, not vanish.
    const scanDirs = [{ base: path.join(FIXTURES_DIR, 'Work', 'TEST'), category: 'TEST' }]
    const closed = reader.getHistoricalSessions('closed', { scanDirs, runningIds: RUNNING_IDS })
    expect(closed.map(s => s.sessionId)).toContain('open999')
    // …but not in Archived
    const archived = reader.getHistoricalSessions('archived', { scanDirs, runningIds: RUNNING_IDS })
    expect(archived.map(s => s.sessionId)).not.toContain('open999')
  })

  it('still excludes an open session that is currently running', () => {
    const scanDirs = [{ base: path.join(FIXTURES_DIR, 'Work', 'TEST'), category: 'TEST' }]
    const closed = reader.getHistoricalSessions('closed', { scanDirs, runningIds: new Set(['open999']) })
    expect(closed.map(s => s.sessionId)).not.toContain('open999')
  })

  it('excludes sessions that are currently running', () => {
    const runningAll = new Set(['closed001', 'archived001'])
    const sessions = reader.getHistoricalSessions('closed', { scanDirs: SCAN_DIRS, runningIds: runningAll })
    expect(sessions).toHaveLength(0)
  })

  it('excludes sessions whose notesPath is in active-sessions (session_id mismatch after restart)', () => {
    const closedNotesPath = path.join(FIXTURES_DIR, 'Work', 'FEAT', 'my-closed-feature', 'notes.md')
    const activeNotePaths = new Set([closedNotesPath])
    const sessions = reader.getHistoricalSessions('closed', { scanDirs: SCAN_DIRS, runningIds: RUNNING_IDS, activeNotePaths })
    expect(sessions).toHaveLength(0)
  })
})
