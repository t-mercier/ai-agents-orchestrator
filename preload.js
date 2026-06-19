const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  getHistoricalSessions: (status) => ipcRenderer.invoke('get-historical-sessions', status),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  openInIterm: (cwd, sessionId) => ipcRenderer.invoke('open-in-iterm', { cwd, sessionId }),
  detachSession: (key) => ipcRenderer.invoke('detach-session', key),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  startSession: (opts) => ipcRenderer.invoke('start-session', opts),
  restoreSession: (slug, sessionId) => ipcRenderer.invoke('restore-session', { slug, sessionId }),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (cfg) => ipcRenderer.invoke('set-config', cfg),
  // PTY
  ptySpawn:  (sessionId, cwd)        => ipcRenderer.invoke('pty-spawn',  { sessionId, cwd }),
  ptyInput:  (sessionId, data)       => ipcRenderer.invoke('pty-input',  { sessionId, data }),
  ptyResize: (sessionId, cols, rows) => ipcRenderer.invoke('pty-resize', { sessionId, cols, rows }),
  ptyKill:   (sessionId)             => ipcRenderer.invoke('pty-kill',   sessionId),
  onPtyData: (cb) => ipcRenderer.on('pty-data', (_, sid, data) => cb(sid, data)),
  onPtyExit: (cb) => ipcRenderer.on('pty-exit', (_, sid) => cb(sid)),
})
