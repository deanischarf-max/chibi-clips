// ═══════════════════════════════════════════
// CHIBI CLIPS - Gaming Clip Manager
// ═══════════════════════════════════════════

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let selectedSource = null;
let recordingStream = null;
let recordTimer = null;
let recordSeconds = 0;

// ── Nav ──
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
        document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
        if (btn.dataset.tab === 'clips') loadClips();
        if (btn.dataset.tab === 'record') loadSources();
        if (btn.dataset.tab === 'upload') loadUploadClips();
    };
});

// ── Clips Tab ──
async function loadClips() {
    const clips = await window.api.getClips();
    const grid = document.getElementById('clipsGrid');
    const empty = document.getElementById('emptyClips');

    if (!clips || clips.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    grid.innerHTML = clips.map(c => {
        const size = c.size > 1048576 ? (c.size / 1048576).toFixed(1) + ' MB' : (c.size / 1024).toFixed(0) + ' KB';
        const date = new Date(c.date);
        const dateStr = date.toLocaleDateString('de-DE') + ' ' + date.toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'});
        return `<div class="clip-card" onclick="playClip('${esc(c.name)}','${esc(c.path)}')">
            <div class="clip-thumb">
                <video src="file://${esc(c.path)}" preload="metadata" muted></video>
                <div class="play-overlay">&#9654;</div>
            </div>
            <div class="clip-info">
                <div class="clip-name">${esc(c.name)}</div>
                <div class="clip-meta">
                    <span>${dateStr}</span>
                    <span>${size}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function playClip(name, filePath) {
    document.getElementById('playerTitle').textContent = name;
    const video = document.getElementById('playerVideo');
    video.src = 'file://' + filePath;
    document.getElementById('playerModal').classList.remove('hidden');
    video.play();

    document.getElementById('btnDeleteClip').onclick = async () => {
        if (confirm('Clip "' + name + '" wirklich loeschen?')) {
            video.pause(); video.src = '';
            await window.api.deleteClip(name);
            closePlayer();
            loadClips();
            toast('Clip geloescht');
        }
    };
}

function closePlayer() {
    const video = document.getElementById('playerVideo');
    video.pause(); video.src = '';
    document.getElementById('playerModal').classList.add('hidden');
}

// Close modal on backdrop click
document.getElementById('playerModal').onclick = (e) => {
    if (e.target.classList.contains('modal')) closePlayer();
};

// Import & Folder buttons
document.getElementById('btnImport').onclick = async () => {
    const imported = await window.api.importClip();
    if (imported.length > 0) {
        toast(imported.length + ' Clip(s) importiert!');
        loadClips();
    }
};
document.getElementById('btnFolder').onclick = () => window.api.openClipsFolder();

// ── Record Tab ──
async function loadSources() {
    const sources = await window.api.getSources();
    const grid = document.getElementById('sourceGrid');
    grid.innerHTML = sources.map(s => `
        <div class="source-card ${selectedSource === s.id ? 'selected' : ''}" onclick="selectSource('${s.id}','${esc(s.name)}')">
            <img src="${s.thumb}" alt="">
            <div class="source-name">${esc(s.name)}</div>
        </div>
    `).join('');
}

function selectSource(id, name) {
    selectedSource = id;
    document.getElementById('recSource').textContent = name;
    loadSources(); // refresh selection
}

document.getElementById('recBtn').onclick = () => {
    if (isRecording) stopRecording();
    else startRecording();
};

async function startRecording() {
    if (!selectedSource) { toast('Waehle zuerst eine Quelle!'); return; }

    const quality = document.getElementById('qualitySelect').value;
    const constraints = {
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: selectedSource,
                maxWidth: quality === 'high' ? 1920 : quality === 'medium' ? 1280 : 854,
                maxHeight: quality === 'high' ? 1080 : quality === 'medium' ? 720 : 480,
                maxFrameRate: 30,
            }
        }
    };

    try {
        recordingStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch(e) {
        toast('Aufnahme fehlgeschlagen: ' + e.message);
        return;
    }

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(recordingStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: quality === 'high' ? 5000000 : quality === 'medium' ? 2500000 : 1000000,
    });

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        // Stream aufräumen
    };

    mediaRecorder.start(1000); // chunk every second
    isRecording = true;
    recordSeconds = 0;

    document.getElementById('recBtn').classList.add('recording');
    document.getElementById('recDot').classList.add('active');
    document.getElementById('recLabel').textContent = 'Aufnahme...';

    recordTimer = setInterval(() => {
        recordSeconds++;
        const min = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
        const sec = String(recordSeconds % 60).padStart(2, '0');
        document.getElementById('recTime').textContent = min + ':' + sec;
    }, 1000);
}

async function stopRecording() {
    if (!mediaRecorder) return;

    mediaRecorder.stop();
    isRecording = false;
    clearInterval(recordTimer);

    document.getElementById('recBtn').classList.remove('recording');
    document.getElementById('recDot').classList.remove('active');
    document.getElementById('recLabel').textContent = 'Speichern...';

    // Wait for last chunks
    await new Promise(r => setTimeout(r, 500));

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const buffer = await blob.arrayBuffer();
    const now = new Date();
    const filename = 'Clip_' + now.toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.webm';

    const result = await window.api.saveClip(buffer, filename);
    if (result.success) {
        toast('Clip gespeichert: ' + filename);
    } else {
        toast('Fehler: ' + result.error);
    }

    // Stop stream
    if (recordingStream) {
        recordingStream.getTracks().forEach(t => t.stop());
        recordingStream = null;
    }

    document.getElementById('recLabel').textContent = 'Bereit';
    document.getElementById('recTime').textContent = '00:00';
    recordedChunks = [];
}

// F9 Hotkey from main process
window.api.onSaveClip(async () => {
    if (isRecording) {
        // Save last N seconds
        const clipLen = parseInt(document.getElementById('clipLength').value) || 30;
        stopRecording();
        toast('Clip der letzten ' + clipLen + ' Sekunden gespeichert!');
    } else {
        toast('Druecke zuerst Aufnahme starten!');
    }
});

// ── Upload Tab ──
async function loadUploadClips() {
    const clips = await window.api.getClips();
    const options = clips.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
    const ytSelect = document.getElementById('ytClipSelect');
    const shareSelect = document.getElementById('shareClipSelect');
    if (ytSelect) ytSelect.innerHTML = options || '<option>Keine Clips</option>';
    if (shareSelect) shareSelect.innerHTML = options || '<option>Keine Clips</option>';
}

// YouTube Connect
document.getElementById('btnYtConnect').onclick = async () => {
    const status = await window.api.ytGetStatus();
    if (status.connected) {
        // Disconnect
        await window.api.ytDisconnect();
        document.getElementById('ytStatus').textContent = 'Nicht verbunden';
        document.getElementById('btnYtConnect').textContent = 'Verbinden';
        document.getElementById('ytUploadSection').classList.add('hidden');
        toast('YouTube getrennt');
        return;
    }
    if (!status.hasKeys) {
        toast('YouTube API Keys werden noch eingerichtet. Kommt bald!');
        return;
    }
    document.getElementById('btnYtConnect').textContent = 'Anmelden...';
    document.getElementById('btnYtConnect').disabled = true;
    const result = await window.api.ytConnect();
    document.getElementById('btnYtConnect').disabled = false;
    if (result.success) {
        document.getElementById('ytStatus').textContent = 'Verbunden: ' + result.channel;
        document.getElementById('btnYtConnect').textContent = 'Trennen';
        document.getElementById('ytUploadSection').classList.remove('hidden');
        loadUploadClips();
        toast('Mit YouTube verbunden: ' + result.channel);
    } else {
        document.getElementById('btnYtConnect').textContent = 'Verbinden';
        toast('Fehler: ' + result.error);
    }
};

// YouTube Upload
document.getElementById('btnYtUpload').onclick = async () => {
    const clip = document.getElementById('ytClipSelect').value;
    const title = document.getElementById('ytTitle').value || clip;
    const desc = document.getElementById('ytDesc').value;
    const privacy = document.getElementById('ytPrivacy').value;
    if (!clip) { toast('Waehle einen Clip!'); return; }

    document.getElementById('btnYtUpload').textContent = 'Wird hochgeladen...';
    document.getElementById('btnYtUpload').disabled = true;
    document.getElementById('ytProgress').classList.remove('hidden');

    window.api.onYtProgress((pct) => {
        document.getElementById('ytProgressFill').style.width = pct + '%';
        document.getElementById('ytProgressText').textContent = pct + '%';
    });

    const result = await window.api.ytUpload(clip, title, desc, privacy);
    document.getElementById('btnYtUpload').textContent = '📤 Auf YouTube hochladen';
    document.getElementById('btnYtUpload').disabled = false;

    if (result.success) {
        toast('Video erfolgreich auf YouTube hochgeladen!');
        document.getElementById('ytProgressText').textContent = 'Fertig!';
    } else {
        toast('Upload fehlgeschlagen: ' + result.error);
        document.getElementById('ytProgress').classList.add('hidden');
    }
};

// Check YouTube status on load
(async () => {
    const status = await window.api.ytGetStatus();
    if (status.connected) {
        document.getElementById('ytStatus').textContent = 'Verbunden: ' + status.channel;
        document.getElementById('btnYtConnect').textContent = 'Trennen';
        document.getElementById('ytUploadSection').classList.remove('hidden');
    }
})();

// Share - Copy path
document.getElementById('btnCopyPath').onclick = async () => {
    const clips = await window.api.getClips();
    const name = document.getElementById('shareClipSelect').value;
    const clip = clips.find(c => c.name === name);
    if (clip) {
        navigator.clipboard.writeText(clip.path);
        toast('Pfad kopiert: ' + clip.path);
    }
};

// Share - Open in explorer
document.getElementById('btnOpenFile').onclick = () => {
    window.api.openClipsFolder();
};


// ── Settings ──
let capturingHotkey = false;

function startHotkeyCapture() {
    const input = document.getElementById('hotkeyInput');
    input.value = 'Drueck eine Taste...';
    input.style.borderColor = '#e94560';
    capturingHotkey = true;
}

function resetHotkey() {
    document.getElementById('hotkeyInput').value = 'F9';
    document.getElementById('hotkeyInput').style.borderColor = '';
    capturingHotkey = false;
    window.api.setHotkey('F9');
    toast('Hotkey auf F9 zurueckgesetzt');
}

document.addEventListener('keydown', (e) => {
    if (!capturingHotkey) return;
    e.preventDefault();
    capturingHotkey = false;
    const input = document.getElementById('hotkeyInput');
    input.style.borderColor = '';

    // Build key name
    let key = '';
    if (e.ctrlKey) key += 'Ctrl+';
    if (e.shiftKey) key += 'Shift+';
    if (e.altKey) key += 'Alt+';

    // Map key code to Electron accelerator format
    const keyMap = {
        'F1':'F1','F2':'F2','F3':'F3','F4':'F4','F5':'F5','F6':'F6',
        'F7':'F7','F8':'F8','F9':'F9','F10':'F10','F11':'F11','F12':'F12',
    };
    const finalKey = keyMap[e.key] || e.key.toUpperCase();
    key += finalKey;

    input.value = key;
    window.api.setHotkey(key);
    toast('Hotkey auf ' + key + ' gesetzt!');
});

(async () => {
    const dir = await window.api.getClipsDir();
    document.getElementById('clipsDirLabel').textContent = dir;
    // Load saved hotkey
    const savedKey = await window.api.getHotkey();
    if (savedKey) document.getElementById('hotkeyInput').value = savedKey;
})();

// ── Utils ──
function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,"&#39;").replace(/\\/g,'\\\\');
}

// ── Auto-Update ──
async function checkForUpdate() {
    try {
        const r = await window.api.checkUpdate();
        if (r.update && r.url) {
            toast('Update v' + r.latest + ' wird heruntergeladen...');
            const result = await window.api.downloadUpdate(r.url);
            if (!result.success) toast('Update fehlgeschlagen: ' + result.error);
        }
    } catch(e) {}
}

// Init
loadClips();
checkForUpdate();
