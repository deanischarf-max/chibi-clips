const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let mainWindow;
const CLIPS_DIR = path.join(app.getPath('videos'), 'ChibiClips');
const APP_VERSION = require('./package.json').version;

// ── YouTube OAuth Config ──
// To enable YouTube upload, create a Google Cloud project:
// 1. Go to https://console.cloud.google.com
// 2. Create project → Enable YouTube Data API v3
// 3. Create OAuth 2.0 Client ID (Desktop App)
// 4. Put your Client ID and Secret here:
const YT_CLIENT_ID = '';  // Your Google OAuth Client ID
const YT_CLIENT_SECRET = '';  // Your Google OAuth Client Secret
const YT_REDIRECT = 'http://localhost:8976/callback';
let ytAccessToken = null;
let ytRefreshToken = null;
let ytChannelName = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1300, height: 850, minWidth: 1000, minHeight: 700,
        title: 'B&M Clips',
        backgroundColor: '#f5f5f8',
        frame: false,
        icon: path.join(__dirname, 'src', 'icon.png'),
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
    loadSettings();
    registerHotkey(currentHotkey);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

// ── Settings ──
let currentHotkey = 'F9';
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
    try {
        const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        currentHotkey = s.hotkey || 'F9';
        ytRefreshToken = s.ytRefreshToken || null;
        ytChannelName = s.ytChannelName || null;
    } catch(e) {}
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
            hotkey: currentHotkey,
            ytRefreshToken,
            ytChannelName,
        }));
    } catch(e) {}
}

function registerHotkey(key) {
    globalShortcut.unregisterAll();
    try {
        globalShortcut.register(key, () => { if (mainWindow) mainWindow.webContents.send('save-clip'); });
    } catch(e) {}
}

ipcMain.handle('set-hotkey', (ev, key) => { currentHotkey = key; saveSettings(); registerHotkey(key); return true; });
ipcMain.handle('get-hotkey', () => currentHotkey);

// ── Window controls ──
ipcMain.handle('win-minimize', () => mainWindow.minimize());
ipcMain.handle('win-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('win-close', () => mainWindow.close());

// ── Recording ──
ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
});

ipcMain.handle('get-clips-dir', () => CLIPS_DIR);

ipcMain.handle('save-clip', (ev, buffer, filename) => {
    try {
        const filePath = path.join(CLIPS_DIR, filename);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true, path: filePath };
    } catch(e) { return { success: false, error: e.message }; }
});

ipcMain.handle('get-clips', () => {
    try {
        return fs.readdirSync(CLIPS_DIR)
            .filter(f => f.endsWith('.webm') || f.endsWith('.mp4'))
            .map(f => {
                const stat = fs.statSync(path.join(CLIPS_DIR, f));
                return { name: f, path: path.join(CLIPS_DIR, f), size: stat.size, date: stat.mtime.getTime() };
            })
            .sort((a, b) => b.date - a.date);
    } catch(e) { return []; }
});

ipcMain.handle('delete-clip', (ev, name) => {
    try { fs.unlinkSync(path.join(CLIPS_DIR, name)); return true; } catch(e) { return false; }
});

ipcMain.handle('open-clips-folder', () => shell.openPath(CLIPS_DIR));
ipcMain.handle('open-external', (ev, url) => shell.openExternal(url));

ipcMain.handle('import-clip', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'avi', 'mkv', 'mov'] }],
        properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    const imported = [];
    for (const fp of result.filePaths) {
        const name = path.basename(fp);
        const dest = path.join(CLIPS_DIR, name);
        if (!fs.existsSync(dest)) { fs.copyFileSync(fp, dest); imported.push(name); }
    }
    return imported;
});

// ── Auto-Update (GitHub Releases check) ──
ipcMain.handle('check-update', async () => {
    try {
        const data = await httpGet('api.github.com', '/repos/deanischarf-max/chibi-clips/releases/latest');
        const latest = (data.tag_name || '').replace(/^v/, '');
        if (!latest) return { update: false, current: APP_VERSION };
        const cur = APP_VERSION.split('.').map(Number);
        const lat = latest.split('.').map(Number);
        let isNewer = false;
        for (let i = 0; i < 3; i++) {
            if ((lat[i]||0) > (cur[i]||0)) { isNewer = true; break; }
            if ((lat[i]||0) < (cur[i]||0)) break;
        }
        const exe = (data.assets || []).find(a => a.name.endsWith('.exe'));
        return { update: isNewer, current: APP_VERSION, latest, url: exe ? exe.browser_download_url : null };
    } catch(e) { return { update: false, current: APP_VERSION, error: e.message }; }
});

ipcMain.handle('download-update', async (ev, url) => {
    try {
        const tmpPath = path.join(app.getPath('temp'), 'BMClips-Update.exe');
        await downloadToFile(url, tmpPath);
        require('child_process').exec(`"${tmpPath}"`, { detached: true, stdio: 'ignore' });
        setTimeout(() => app.quit(), 1000);
        return { success: true };
    } catch(e) { return { success: false, error: e.message }; }
});

// ── YouTube OAuth ──
ipcMain.handle('yt-get-status', () => {
    return { connected: !!ytAccessToken, channel: ytChannelName, hasKeys: !!(YT_CLIENT_ID && YT_CLIENT_SECRET) };
});

ipcMain.handle('yt-connect', async () => {
    if (!YT_CLIENT_ID || !YT_CLIENT_SECRET) {
        return { success: false, error: 'YouTube API Keys sind noch nicht eingerichtet. Der Entwickler muss Google API Keys erstellen.' };
    }

    try {
        // Start local server for OAuth callback
        const http = require('http');
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${YT_CLIENT_ID}&redirect_uri=${encodeURIComponent(YT_REDIRECT)}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload+https://www.googleapis.com/auth/youtube.readonly&access_type=offline&prompt=consent`;

        const code = await new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                const url = new URL(req.url, 'http://localhost:8976');
                const c = url.searchParams.get('code');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body style="background:#f5f5f8;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Arial"><h1>Verbunden! Du kannst dieses Fenster schliessen.</h1></body></html>');
                server.close();
                if (c) resolve(c); else reject(new Error('Kein Code'));
            });
            server.listen(8976, () => {
                shell.openExternal(authUrl);
            });
            setTimeout(() => { server.close(); reject(new Error('Timeout')); }, 120000);
        });

        // Exchange code for tokens
        const tokenData = await httpPost('oauth2.googleapis.com', '/token',
            `code=${code}&client_id=${YT_CLIENT_ID}&client_secret=${YT_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(YT_REDIRECT)}&grant_type=authorization_code`);

        ytAccessToken = tokenData.access_token;
        ytRefreshToken = tokenData.refresh_token || ytRefreshToken;

        // Get channel name
        const channelData = await httpGetAuth('www.googleapis.com', '/youtube/v3/channels?part=snippet&mine=true', ytAccessToken);
        ytChannelName = channelData.items && channelData.items[0] ? channelData.items[0].snippet.title : 'YouTube';

        saveSettings();
        return { success: true, channel: ytChannelName };
    } catch(e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('yt-disconnect', () => {
    ytAccessToken = null; ytRefreshToken = null; ytChannelName = null;
    saveSettings();
    return true;
});

ipcMain.handle('yt-upload', async (ev, clipName, title, description, privacy) => {
    if (!ytAccessToken) return { success: false, error: 'Nicht mit YouTube verbunden' };

    try {
        const filePath = path.join(CLIPS_DIR, clipName);
        if (!fs.existsSync(filePath)) return { success: false, error: 'Clip nicht gefunden' };

        const fileSize = fs.statSync(filePath).size;
        const metadata = JSON.stringify({
            snippet: { title: title || clipName, description: description || 'Uploaded with B&M Clips' },
            status: { privacyStatus: privacy || 'unlisted' }
        });

        // Step 1: Initiate resumable upload
        const initRes = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'www.googleapis.com',
                path: '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + ytAccessToken,
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Length': fileSize,
                    'X-Upload-Content-Type': 'video/webm',
                }
            }, res => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: d }));
            });
            req.on('error', reject);
            req.write(metadata);
            req.end();
        });

        if (!initRes.location) {
            return { success: false, error: 'Upload Init fehlgeschlagen: ' + initRes.body };
        }

        // Step 2: Upload video file
        const uploadUrl = new URL(initRes.location);
        await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: uploadUrl.hostname,
                path: uploadUrl.pathname + uploadUrl.search,
                method: 'PUT',
                headers: {
                    'Content-Length': fileSize,
                    'Content-Type': 'video/webm',
                }
            }, res => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => {
                    if (res.statusCode === 200 || res.statusCode === 201) resolve(d);
                    else reject(new Error('Upload fehlgeschlagen: HTTP ' + res.statusCode));
                });
            });
            req.on('error', reject);

            const stream = fs.createReadStream(filePath);
            let uploaded = 0;
            stream.on('data', (chunk) => {
                uploaded += chunk.length;
                if (mainWindow) mainWindow.webContents.send('yt-upload-progress', Math.round((uploaded / fileSize) * 100));
            });
            stream.pipe(req);
        });

        return { success: true };
    } catch(e) {
        return { success: false, error: e.message };
    }
});

// ── HTTP Helpers ──
function httpGet(host, urlPath) {
    return new Promise((resolve, reject) => {
        https.get({ host, path: urlPath, headers: { 'User-Agent': 'BMClips/' + APP_VERSION, Accept: 'application/json' } }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        }).on('error', reject);
    });
}

function httpGetAuth(host, urlPath, token) {
    return new Promise((resolve, reject) => {
        https.get({ host, path: urlPath, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        }).on('error', reject);
    });
}

function httpPost(host, urlPath, body) {
    return new Promise((resolve, reject) => {
        const req = https.request({ host, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}

function downloadToFile(url, dest) {
    return new Promise((resolve, reject) => {
        const doReq = (u) => {
            https.get(u, { headers: { 'User-Agent': 'BMClips' } }, res => {
                if (res.statusCode === 301 || res.statusCode === 302) { res.resume(); doReq(res.headers.location); return; }
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
            }).on('error', reject);
        };
        doReq(url);
    });
}
