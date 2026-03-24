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
    importClip: () => ipcRenderer.invoke('import-clip'),
    onSaveClip: (cb) => ipcRenderer.on('save-clip', () => cb()),
    setHotkey: (key) => ipcRenderer.invoke('set-hotkey', key),
    getHotkey: () => ipcRenderer.invoke('get-hotkey'),
});
