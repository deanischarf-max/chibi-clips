const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    minimize: () => ipcRenderer.invoke('win-minimize'),
    maximize: () => ipcRenderer.invoke('win-maximize'),
    close: () => ipcRenderer.invoke('win-close'),
    getSources: () => ipcRenderer.invoke('get-sources'),
    getClipsDir: () => ipcRenderer.invoke('get-clips-dir'),
    saveClip: (buffer, name) => ipcRenderer.invoke('save-clip', buffer, name),
    getClips: () => ipcRenderer.invoke('get-clips'),
    deleteClip: (name) => ipcRenderer.invoke('delete-clip', name),
    openClipsFolder: () => ipcRenderer.invoke('open-clips-folder'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    importClip: () => ipcRenderer.invoke('import-clip'),
    onSaveClip: (cb) => ipcRenderer.on('save-clip', () => cb()),
    setHotkey: (key) => ipcRenderer.invoke('set-hotkey', key),
    getHotkey: () => ipcRenderer.invoke('get-hotkey'),
    // Auto-Update
    checkUpdate: () => ipcRenderer.invoke('check-update'),
    downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
    // YouTube
    ytGetStatus: () => ipcRenderer.invoke('yt-get-status'),
    ytConnect: () => ipcRenderer.invoke('yt-connect'),
    ytDisconnect: () => ipcRenderer.invoke('yt-disconnect'),
    ytUpload: (clip, title, desc, privacy) => ipcRenderer.invoke('yt-upload', clip, title, desc, privacy),
    onYtProgress: (cb) => ipcRenderer.on('yt-upload-progress', (_, d) => cb(d)),
});
