const fs = require('fs')
const path = require('path')
const os = require('os')

const HOME = os.homedir()
const SESSIONS_DIR = path.join(HOME, '.claude', 'sessions')
const ACTIVE_SESSIONS_FILE = path.join(HOME, '.claude', 'active-sessions.json')
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects')

function readSessions(sessionsDir = SESSIONS_DIR) {
  if (!fs.existsSync(sessionsDir)) return []
  return fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.json'))
    .flatMap(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'))
        if (!data.sessionId) return []
        // Skip Claude Code background jobs / forked sub-sessions (kind:"bg",
        // spawned via --bg-pty-host/--fork-session). They aren't user-managed
        // sessions and would otherwise show as phantom cards (no active-sessions
        // entry → uncategorized). Sessions without `kind` (older CLI) are kept.
        if (data.kind === 'bg') return []
        return [{
          sessionId: data.sessionId,
          name: data.name || '',
          cwd: data.cwd || '',
          pid: data.pid || null,
          status: data.status || 'idle',
          updatedAt: data.updatedAt || null,
        }]
      } catch {
        return []
      }
    })
}

function readActiveSessions(activeSessionsFile = ACTIVE_SESSIONS_FILE) {
  if (!fs.existsSync(activeSessionsFile)) return {}
  try {
    return JSON.parse(fs.readFileSync(activeSessionsFile, 'utf8'))
  } catch {
    return {}
  }
}

function readNotesGoal(notesPath) {
  if (!notesPath || !fs.existsSync(notesPath)) return { goal: null, nextSteps: null }
  try {
    const content = fs.readFileSync(notesPath, 'utf8')
    return {
      goal: extractSection(content, 'Goal'),
      nextSteps: extractSection(content, 'Next steps'),
    }
  } catch {
    return { goal: null, nextSteps: null }
  }
}

function extractSection(content, heading) {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`)
  const match = content.match(regex)
  if (!match) return null
  return match[1].trim() || null
}

function cwdToProjectKey(cwd) {
  return cwd.replace(/\//g, '-')
}

function readJsonl(cwd, sessionId, projectsDir = PROJECTS_DIR) {
  const jsonlPath = path.join(projectsDir, cwdToProjectKey(cwd), `${sessionId}.jsonl`)
  if (!fs.existsSync(jsonlPath)) {
    return { lastActivity: null, lastActivityAt: null, gitBranch: null, prLink: null }
  }
  try {
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').filter(Boolean)
    let lastActivity = null
    let lastActivityAt = null
    let gitBranch = null
    let prLink = null

    for (const line of lines) {
      try {
        const event = JSON.parse(line)
        if (event.gitBranch) gitBranch = event.gitBranch
        if (event.prLink) prLink = event.prLink
        if (event.type === 'assistant') {
          const content = event.message?.content
          if (Array.isArray(content)) {
            const textBlock = content.find(c => c.type === 'text')
            if (textBlock?.text) {
              lastActivity = textBlock.text.slice(0, 200)
              lastActivityAt = event.timestamp || null
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    }
    return { lastActivity, lastActivityAt, gitBranch, prLink }
  } catch {
    return { lastActivity: null, lastActivityAt: null, gitBranch: null, prLink: null }
  }
}

function isProcessAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM = process exists but we lack permission (still alive); ESRCH = no such process
    return e.code === 'EPERM'
  }
}

function getRunningSessions({ sessionsDir, isAlive = isProcessAlive } = {}) {
  return readSessions(sessionsDir).filter(s => isAlive(s.pid))
}

// Find a session's working directory by locating its transcript and reading the
// `cwd` field. Works for running AND closed sessions (notes.md has no cwd).
// The project folder name encodes cwd lossily (. and / both → -), so we read
// the jsonl content instead of decoding the folder name.
function resolveSessionCwd(sessionId, projectsDir = PROJECTS_DIR) {
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId) || !fs.existsSync(projectsDir)) return null
  let folders
  try { folders = fs.readdirSync(projectsDir) } catch { return null }
  for (const folder of folders) {
    const jsonlPath = path.join(projectsDir, folder, `${sessionId}.jsonl`)
    if (!fs.existsSync(jsonlPath)) continue
    try {
      const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n')
      for (const line of lines) {
        if (!line) continue
        try { const e = JSON.parse(line); if (e.cwd) return e.cwd } catch { /* skip */ }
      }
    } catch { /* unreadable */ }
    return null
  }
  return null
}

function getAllSessionData({ sessionsDir, activeSessionsFile, projectsDir, isAlive = isProcessAlive } = {}) {
  const sessions = readSessions(sessionsDir).filter(s => isAlive(s.pid))
  const activeSessions = readActiveSessions(activeSessionsFile)

  return sessions.map(session => {
    const activeEntry = activeSessions[session.sessionId] || {}
    const notesPath = activeEntry.notes_path || null
    const { goal, nextSteps } = notesPath ? readNotesGoal(notesPath) : { goal: null, nextSteps: null }
    const jsonlData = readJsonl(session.cwd, session.sessionId, projectsDir)
    return {
      ...session,
      notesPath,
      category: activeEntry.category || null,
      ticket: activeEntry.ticket || null,
      goal,
      nextSteps,
      ...jsonlData,
    }
  })
}

// Scan dirs come from the shared config (categories → base dirs), resolved at
// call time so a Settings change is picked up on the next poll without restart.
const config = require('./config')
function defaultScanDirs() {
  return config.load().scanDirs
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    // Strip surrounding quotes/backslashes (e.g. a stray `ticket: ""` → null)
    const val = line.slice(colonIdx + 1).trim().replace(/^["'\\]+|["'\\]+$/g, '').trim()
    if (key) result[key] = val || null
  }
  return result
}

// Returns { status, date }: status is open|closed|archived; date is the close
// timestamp (last history entry) or the ARCHIVED line's timestamp.
function getSessionHistoryInfo(content) {
  const match = content.match(/## Session history\n([\s\S]*?)(?=\n## |$)/)
  if (!match) return { status: 'open', date: null }
  const history = match[1].trim()
  if (!history) return { status: 'open', date: null }

  const lines = history.split('\n').filter(l => l.trim().startsWith('-'))
  const leadingDate = (l) => {
    const m = l && l.match(/(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/)
    return m ? m[1] : null
  }
  const archivedLine = lines.find(l => /ARCHIVED/i.test(l))
  if (archivedLine) return { status: 'archived', date: leadingDate(archivedLine) }
  const lastLine = lines[lines.length - 1]
  return { status: 'closed', date: leadingDate(lastLine) }
}

function scanAllNotesMd(scanDirs = defaultScanDirs()) {
  const results = []
  for (const { base, category } of scanDirs) {
    if (!fs.existsSync(base)) continue
    let entries
    try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const notesPath = path.join(base, entry.name, 'notes.md')
      if (!fs.existsSync(notesPath)) continue
      try {
        const content = fs.readFileSync(notesPath, 'utf8')
        const fm = parseFrontmatter(content)
        const history = getSessionHistoryInfo(content)
        let mtimeMs = null
        try { mtimeMs = fs.statSync(notesPath).mtimeMs } catch { /* ignore */ }
        results.push({
          notesPath,
          sessionId: fm.session_id || null,
          category: fm.category || category,
          ticket: fm.ticket || null,
          name: fm.name || entry.name,
          branch: fm.branch || null,
          startedAt: fm.started_at || null,
          updatedAt: mtimeMs,  // notes.md last-write time = last /close or /save
          historyStatus: history.status,
          historyDate: history.date,
          goal: extractSection(content, 'Goal'),
          nextSteps: extractSection(content, 'Next steps'),
        })
      } catch {
        // skip unreadable files
      }
    }
  }
  return results
}

// Map sessionId → transcript jsonl mtime (ms). The transcript is appended on every
// interaction, so its mtime is the true "last activity" — unlike notes.md mtime,
// which only changes on /save or /close.
function buildTranscriptMtimeIndex(projectsDir = PROJECTS_DIR) {
  const index = new Map()
  if (!fs.existsSync(projectsDir)) return index
  let folders
  try { folders = fs.readdirSync(projectsDir) } catch { return index }
  for (const folder of folders) {
    const dir = path.join(projectsDir, folder)
    let files
    try { files = fs.readdirSync(dir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const sid = f.slice(0, -'.jsonl'.length)
      try {
        const m = fs.statSync(path.join(dir, f)).mtimeMs
        if (!index.has(sid) || m > index.get(sid)) index.set(sid, m)
      } catch { /* ignore */ }
    }
  }
  return index
}

function getHistoricalSessions(status, { scanDirs, runningIds = new Set(), activeNotePaths = new Set(), projectsDir } = {}) {
  const mtimeIndex = buildTranscriptMtimeIndex(projectsDir)
  // "Closed" surfaces every dormant session that isn't archived — including ones
  // started but never /close'd (empty Session history → 'open'). Otherwise a
  // session whose terminal was just closed would vanish from all tabs.
  const statusMatch = status === 'closed'
    ? (s => s.historyStatus === 'closed' || s.historyStatus === 'open')
    : (s => s.historyStatus === status)
  return scanAllNotesMd(scanDirs)
    .filter(statusMatch)
    .filter(s => !s.sessionId || !runningIds.has(s.sessionId))
    .filter(s => !activeNotePaths.has(s.notesPath))
    .map(s => {
      // Prefer real last-activity (transcript mtime) over notes.md mtime
      const t = s.sessionId ? mtimeIndex.get(s.sessionId) : null
      return t ? { ...s, updatedAt: t } : s
    })
}

module.exports = {
  readSessions, readActiveSessions, readNotesGoal, readJsonl,
  getAllSessionData, scanAllNotesMd, getHistoricalSessions,
  getRunningSessions, isProcessAlive, resolveSessionCwd,
}
