const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const CLIPS_DIR = path.join(app.getPath('videos'), 'ChibiClips');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1300, height: 850, minWidth: 1000, minHeight: 700,
        title: 'Chibi Clips',
        backgroundColor: '#0a0a12',
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'src', 'preload.js'),
            contextIsolation: true, nodeIntegration: false,
        },
        autoHideMenuBar: true,
    });
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
    createWindow();

    // Global hotkey F9 = save clip
    try { globalShortcut.register('F9', () => { if (mainWindow) mainWindow.webContents.send('save-clip'); }); } catch(e) {}
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

// Window controls
ipcMain.handle('win-minimize', () => mainWindow.minimize());
ipcMain.handle('win-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('win-close', () => mainWindow.close());

// Get screen sources for recording
ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
});

// Get clips directory
ipcMain.handle('get-clips-dir', () => CLIPS_DIR);

// Save clip buffer
ipcMain.handle('save-clip', (ev, buffer, filename) => {
    try {
        const filePath = path.join(CLIPS_DIR, filename);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true, path: filePath };
    } catch(e) { return { success: false, error: e.message }; }
});

// Get all clips
ipcMain.handle('get-clips', () => {
    try {
        const files = fs.readdirSync(CLIPS_DIR)
            .filter(f => f.endsWith('.webm') || f.endsWith('.mp4'))
            .map(f => {
                const stat = fs.statSync(path.join(CLIPS_DIR, f));
                return { name: f, path: path.join(CLIPS_DIR, f), size: stat.size, date: stat.mtime.getTime() };
            })
            .sort((a, b) => b.date - a.date);
        return files;
    } catch(e) { return []; }
});

// Delete clip
ipcMain.handle('delete-clip', (ev, name) => {
    try { fs.unlinkSync(path.join(CLIPS_DIR, name)); return true; } catch(e) { return false; }
});

// Open clips folder
ipcMain.handle('open-clips-folder', () => shell.openPath(CLIPS_DIR));

// Import clip from file picker
ipcMain.handle('import-clip', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'avi', 'mkv', 'mov'] }],
        properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    const imported = [];
    for (const filePath of result.filePaths) {
        const name = path.basename(filePath);
        const dest = path.join(CLIPS_DIR, name);
        if (!fs.existsSync(dest)) {
            fs.copyFileSync(filePath, dest);
            imported.push(name);
        }
    }
    return imported;
});
