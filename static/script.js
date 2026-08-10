/* =========================================================
   SoniScript ...script.js
   Tab 1: Upload & Transcribe (batch)
   Tab 2: LRC Editor (correct lyrics, preserve timestamps)
   ========================================================= */

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });

    document.getElementById(`tab-${name}`).classList.add('active');
    const panel = document.getElementById(`panel-${name}`);
    panel.style.display = 'flex';
    panel.classList.add('active');

    if (name === 'editor') loadLrcList();
    if (name === 'tester') {
        loadTesterLrcList();
        loadTesterMp3List();
    }
    if (name === 'tags') loadTagMp3List();
}

// ---------------------------------------------------------------------------
// Tab 1 ...Drop zone
// ---------------------------------------------------------------------------
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const queueCard = document.getElementById('queue-card');
const fileQueue = document.getElementById('file-queue');
const transcribeBtn = document.getElementById('transcribe-btn');

/** @type {File[]} */
let queuedFiles = [];

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    addFiles([...e.dataTransfer.files]);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => addFiles([...e.target.files]));

function addFiles(files) {
    const mp3s = files.filter(f => f.name.toLowerCase().endsWith('.mp3'));
    if (!mp3s.length) { alert('Please select MP3 files.'); return; }

    mp3s.forEach(f => {
        if (queuedFiles.find(q => q.name === f.name)) return; // skip duplicates
        queuedFiles.push(f);
        renderQueueItem(f, queuedFiles.length - 1);
    });

    queueCard.style.display = 'block';
    fileInput.value = '';
}

function renderQueueItem(file, index) {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.id = `qi-${index}`;
    div.innerHTML = `
        <span class="queue-item-icon">🎵</span>
        <span class="queue-item-name" title="${file.name}">${file.name}</span>
        <span class="status-badge status-waiting" id="qi-status-${index}">Waiting</span>
    `;
    fileQueue.appendChild(div);
}

function setFileStatus(index, cls, text) {
    const el = document.getElementById(`qi-status-${index}`);
    if (!el) return;
    el.className = `status-badge ${cls}`;
    el.textContent = text;
}

let usageRequest = null;

function formatUsageDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatResetCountdown(resetAt) {
    const milliseconds = new Date(resetAt).getTime() - Date.now();
    if (milliseconds <= 0) return 'Resetting now';
    const totalMinutes = Math.ceil(milliseconds / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `Resets in ${hours}h ${minutes}m (${new Date(resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
}

function renderUsage(data) {
    const usedPercent = data.limit ? Math.min(100, Math.round(data.used / data.limit * 100)) : 0;
    document.getElementById('usage-account-label').textContent = data.account_type === 'guest'
        ? 'Guest allowance · private to this browser session'
        : 'Signed-in allowance · private to your account';
    document.getElementById('usage-remaining').textContent = `${data.remaining} of ${data.limit}`;
    document.getElementById('usage-used').textContent = `${data.used} of ${data.limit}`;
    document.getElementById('usage-audio').textContent = formatUsageDuration(data.audio_seconds_today);
    document.getElementById('usage-max').textContent = formatUsageDuration(data.max_audio_seconds);
    document.getElementById('usage-progress-bar').style.width = `${usedPercent}%`;
    document.getElementById('usage-progress').setAttribute('aria-valuenow', String(usedPercent));
    document.getElementById('usage-reset').textContent = formatResetCountdown(data.reset_at);
    document.getElementById('usage-files').textContent = String(data.saved_files);
    document.getElementById('usage-storage').textContent = data.retention_days
        ? `Expires after ${data.retention_days} days`
        : 'Private · kept until deleted';
    if (data.next_expiry_at) {
        document.getElementById('usage-storage').textContent += ` · next ${new Date(data.next_expiry_at).toLocaleDateString()}`;
    }

    const shared = data.shared_service;
    const status = document.getElementById('usage-service-status');
    status.textContent = shared.status;
    status.className = `service-status ${shared.status === 'Busy' ? 'busy' : shared.status === 'Limit reached' ? 'limited' : ''}`;
    document.getElementById('usage-hour').textContent = `${shared.hourly_percent}%`;
    document.getElementById('usage-day').textContent = `${shared.daily_percent}%`;
    document.getElementById('usage-hour-bar').style.width = `${shared.hourly_percent}%`;
    document.getElementById('usage-day-bar').style.width = `${shared.daily_percent}%`;
    document.getElementById('usage-loading').hidden = true;
    document.getElementById('usage-error').hidden = true;
    document.getElementById('usage-content').hidden = false;
}

async function loadUsage() {
    if (usageRequest) return usageRequest;
    const refresh = document.getElementById('usage-refresh');
    const error = document.getElementById('usage-error');
    if (refresh) refresh.disabled = true;
    usageRequest = (async () => {
        try {
            const response = await fetch('/api/usage', { cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || 'Usage information is unavailable.');
            renderUsage(data);
        } catch (problem) {
            document.getElementById('usage-loading').hidden = true;
            error.textContent = problem.message;
            error.hidden = false;
        } finally {
            usageRequest = null;
            if (refresh) refresh.disabled = false;
        }
    })();
    return usageRequest;
}

window.loadUsage = loadUsage;
window.addEventListener('soniscript-auth-change', loadUsage);
if (window.authReady) window.authReady.then(loadUsage);

function clearQueue() {
    queuedFiles = [];
    fileQueue.innerHTML = '';
    queueCard.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Tab 1 ...Transcription loop
// ---------------------------------------------------------------------------
async function transcribeAll() {
    if (!queuedFiles.length) return;

    transcribeBtn.disabled = true;
    document.getElementById('clear-queue-btn').disabled = true;

    for (let i = 0; i < queuedFiles.length; i++) {
        const file = queuedFiles[i];
        setFileStatus(i, 'status-running', 'Transcribing...');

        try {
            const formData = new FormData();
            formData.append('audio_file', file);

            const res = await fetch('/transcribe', { method: 'POST', body: formData });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
                throw new Error(err.detail || 'Server error');
            }
            const data = await res.json();
            setFileStatus(i, 'status-done', `Saved ...(${data.lines_count} lines)`);
            loadUsage();
        } catch (err) {
            console.error(err);
            setFileStatus(i, 'status-error', `Error: ${err.message}`);
        }
    }

    transcribeBtn.disabled = false;
    document.getElementById('clear-queue-btn').disabled = false;
    loadUsage();
}

// ---------------------------------------------------------------------------
// Tab 2 ...LRC file list
// ---------------------------------------------------------------------------
const lrcListEl = document.getElementById('lrc-list');
let selectedLrcFile = null;

async function loadLrcList() {
    lrcListEl.innerHTML = '<p class="empty-state">Loading</p>';
    try {
        const res = await fetch('/list_lrc');
        const data = await res.json();
        renderLrcList(data.records || data.files || []);
    } catch (e) {
        lrcListEl.innerHTML = '<p class="empty-state" style="color:var(--red)">Failed to load files.</p>';
    }
}

// All loaded file names (for search/filter)
/** @type {(string|{id:string,filename:string})[]} */
let allLrcFiles = [];

const fileCountBadge = document.getElementById('file-count-badge');
const lrcSearchInput = document.getElementById('lrc-search');

function renderLrcList(files) {
    allLrcFiles = files;
    lrcListEl.innerHTML = '';
    lrcSearchInput.value = '';

    if (!files.length) {
        fileCountBadge.style.display = 'none';
        lrcListEl.innerHTML = '<p class="empty-state">No LRC files found.<br>Transcribe some MP3s first.</p>';
        return;
    }

    fileCountBadge.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
    fileCountBadge.style.display = '';

    files.forEach((file, idx) => {
        lrcListEl.appendChild(makeLrcBtn(file, idx + 1));
    });
}

function makeLrcBtn(file, num) {
    const name = typeof file === 'string' ? file : file.filename;
    const id = typeof file === 'string' ? file : file.id;
    const btn = document.createElement('button');
    btn.className = 'lrc-file-btn';
    btn.dataset.filename = name;
    btn.dataset.recordId = id;
    btn.title = name;
    btn.innerHTML = `<span class="lrc-file-num">${num}</span><span class="lrc-file-name">${escHtml(name)}</span>`;
    btn.onclick = () => openLrc(id, btn, name);
    return btn;
}

function filterLrcList(query) {
    const q = query.trim().toLowerCase();

    // Remove old no-results notice
    const noRes = lrcListEl.querySelector('.lrc-no-results');
    if (noRes) noRes.remove();

    let visible = 0;
    lrcListEl.querySelectorAll('.lrc-file-btn').forEach(btn => {
        const match = !q || btn.dataset.filename.toLowerCase().includes(q);
        btn.style.display = match ? '' : 'none';
        if (match) visible++;
    });

    // Update badge to show filtered / total
    if (allLrcFiles.length) {
        fileCountBadge.textContent = q
            ? `${visible} / ${allLrcFiles.length} file${allLrcFiles.length !== 1 ? 's' : ''}`
            : `${allLrcFiles.length} file${allLrcFiles.length !== 1 ? 's' : ''}`;
    }

    if (visible === 0 && allLrcFiles.length > 0) {
        const msg = document.createElement('p');
        msg.className = 'lrc-no-results';
        msg.textContent = 'No files match.';
        lrcListEl.appendChild(msg);
    }
}

// ---------------------------------------------------------------------------
// Tab 2 ...Open & display an LRC file
// ---------------------------------------------------------------------------
const editorEmpty = document.getElementById('editor-empty');
const editorContent = document.getElementById('editor-content');
const editorFilename = document.getElementById('editor-filename');
const timestampsPanel = document.getElementById('timestamps-panel');
const lyricsEditor = document.getElementById('lyrics-editor');
const lineCountHint = document.getElementById('line-count-hint');
const saveBtn = document.getElementById('save-btn');
const autoAlignBox = document.getElementById('auto-align-box');
const referenceLyrics = document.getElementById('reference-lyrics');
const alignmentReview = document.getElementById('alignment-review');
const alignmentReviewRows = document.getElementById('alignment-review-rows');
const alignmentSummary = document.getElementById('alignment-summary');
const generateReviewBtn = document.getElementById('generate-review-btn');

/** @type {{timestamp_str:string, text:string}[]} */
let currentLines = [];

async function openLrc(filename, btnEl, displayName = filename) {
    // Highlight selected
    document.querySelectorAll('.lrc-file-btn').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    selectedLrcFile = filename;

    editorEmpty.style.display = 'none';
    editorContent.style.display = 'flex';
    editorFilename.textContent = displayName;
    timestampsPanel.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">Loading</span>';
    lyricsEditor.value = '';
    saveBtn.disabled = true;
    closeAlignmentReview();
    autoAlignBox.style.display = 'none';
    referenceLyrics.value = '';

    try {
        const res = await fetch(`/get_lrc/${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error('Could not load file.');
        const data = await res.json();
        currentLines = data.lines;
        renderTimestampsPanel(currentLines);
        lyricsEditor.value = currentLines.map(l => l.text).join('\n');
        updateLineCount();
        saveBtn.disabled = false;
    } catch (e) {
        timestampsPanel.innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
    }
}

function renderTimestampsPanel(lines) {
    timestampsPanel.innerHTML = '';
    lines.forEach(({ timestamp_str, text }) => {
        const row = document.createElement('div');
        row.className = 'ts-row';
        row.innerHTML = `<span class="ts-stamp">${timestamp_str}</span><span class="ts-text">${escHtml(text)}</span>`;
        timestampsPanel.appendChild(row);
    });
}

// Keep timestamp panel and textarea scrolled in sync
lyricsEditor.addEventListener('scroll', () => {
    const ratio = lyricsEditor.scrollTop / (lyricsEditor.scrollHeight - lyricsEditor.clientHeight || 1);
    timestampsPanel.scrollTop = ratio * (timestampsPanel.scrollHeight - timestampsPanel.clientHeight);
});

lyricsEditor.addEventListener('input', updateLineCount);

function updateLineCount() {
    const entered = lyricsEditor.value.split('\n').length;
    const expected = currentLines.length;
    lineCountHint.textContent = `${entered} / ${expected} lines`;
    lineCountHint.className = 'line-count-hint' + (entered !== expected ? ' mismatch' : '');
    saveBtn.disabled = (entered !== expected);
}

function toggleAutoAlign(force) {
    const show = typeof force === 'boolean' ? force : autoAlignBox.style.display === 'none';
    autoAlignBox.style.display = show ? 'grid' : 'none';
    if (show) referenceLyrics.focus();
}

async function generateAlignmentReview() {
    if (!selectedLrcFile || !referenceLyrics.value.trim()) {
        alert('Paste the completed lyrics first.');
        return;
    }
    generateReviewBtn.disabled = true;
    generateReviewBtn.textContent = 'Aligning...';
    try {
        const formData = new FormData();
        formData.append('filename', selectedLrcFile);
        formData.append('reference_lyrics', referenceLyrics.value);
        const res = await fetch('/align_lyrics', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Alignment failed.');

        alignmentSummary.textContent = `Overall match: ${data.overall_confidence}% - ${data.lines.length} timestamps preserved`;
        alignmentReviewRows.innerHTML = '';
        data.lines.forEach((line, index) => {
            const level = line.confidence >= 70 ? 'high' : line.confidence >= 40 ? 'medium' : 'low';
            const row = document.createElement('div');
            row.className = `review-row confidence-${level}`;
            row.innerHTML = `
                <div class="review-meta"><span>${escHtml(line.timestamp_str)}</span><span class="confidence-pill">${line.confidence}%</span></div>
                <div class="review-original">${escHtml(line.original)}</div>
                <textarea class="review-proposed" data-review-index="${index}" spellcheck="false">${escHtml(line.proposed)}</textarea>`;
            alignmentReviewRows.appendChild(row);
        });
        alignmentReview.style.display = 'block';
        alignmentReview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        alert(e.message);
    } finally {
        generateReviewBtn.disabled = false;
        generateReviewBtn.textContent = 'Compare & Review';
    }
}

function closeAlignmentReview() {
    alignmentReview.style.display = 'none';
    alignmentReviewRows.innerHTML = '';
}

function applyAlignmentReview() {
    const proposals = [...alignmentReviewRows.querySelectorAll('.review-proposed')]
        .map(input => input.value.replace(/\r?\n/g, ' ').trim());
    if (proposals.length !== currentLines.length) {
        alert('The review no longer matches this LRC. Generate it again.');
        return;
    }
    lyricsEditor.value = proposals.join('\n');
    updateLineCount();
    closeAlignmentReview();
    autoAlignBox.style.display = 'none';
    lyricsEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------------------------------------------------------------------------
// Tab 2 ...Save modified
// ---------------------------------------------------------------------------
async function saveModified() {
    if (!selectedLrcFile) return;

    const correctedLyrics = lyricsEditor.value;
    const enteredLines = correctedLyrics.split('\n').length;
    if (enteredLines !== currentLines.length) {
        alert(`Line count mismatch!\nExpected ${currentLines.length} lines, got ${enteredLines}.`);
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = '💾 Saving...';

    try {
        const formData = new FormData();
        formData.append('filename', selectedLrcFile);
        formData.append('corrected_lyrics', correctedLyrics);

        const res = await fetch('/save_modified', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(err.detail || 'Server error');
        }
        const data = await res.json();

        // Reset editor state
        selectedLrcFile = null;
        currentLines = [];
        editorContent.style.display = 'none';
        editorEmpty.style.display = 'flex';

        // Refresh the list (modified file won't appear)
        await loadLrcList();

        alert(`✓ Saved as: ${data.saved_as}`);
    } catch (e) {
        alert(`Save failed: ${e.message}`);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save as Modified';
    }
}

async function downloadSelectedLrc() {
    if (!selectedLrcFile) return;
    const button = document.getElementById('download-btn');
    button.disabled = true;
    try {
        const res = await fetch(`/api/lrc/${encodeURIComponent(selectedLrcFile)}/download`);
        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.detail || `Download failed (${res.status}).`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = editorFilename.textContent || 'lyrics.lrc';
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        alert(`Download failed: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

async function deleteSelectedLrc() {
    if (!selectedLrcFile || !confirm(`Delete ${editorFilename.textContent}?`)) return;
    const res = await fetch(`/api/lrc/${encodeURIComponent(selectedLrcFile)}`, { method: 'DELETE' });
    if (!res.ok) return alert('Delete failed.');
    selectedLrcFile = null;
    currentLines = [];
    editorContent.style.display = 'none';
    editorEmpty.style.display = 'flex';
    await loadLrcList();
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Sidebar resize
// ---------------------------------------------------------------------------
(function setupSidebarResize() {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.getElementById('editor-sidebar');
    if (!resizer || !sidebar) return;

    let startX, startW;

    resizer.addEventListener('mousedown', e => {
        e.preventDefault();
        startX = e.clientX;
        startW = sidebar.getBoundingClientRect().width;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        function onMove(e) {
            const delta = e.clientX - startX;
            const newW = Math.max(300, Math.min(520, startW + delta));
            sidebar.style.flex = `0 0 ${newW}px`;
        }

        function onUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
})();

// ===========================================================================
// Tab 3 ...Sync Tester
// ===========================================================================

// DOM refs
const testerLrcSelect = document.getElementById('tester-lrc-select');
const customLrcInput = document.getElementById('custom-lrc-input');
const customLrcName = document.getElementById('custom-lrc-name');
const customLrcLabel = document.getElementById('custom-lrc-label');
const testerMp3Select = document.getElementById('tester-mp3-select');
const testerMp3Input = document.getElementById('tester-mp3-input');
const testerMp3Name = document.getElementById('tester-mp3-name');
const mp3Label = document.getElementById('mp3-label');
const testerLoadBtn = document.getElementById('tester-load-btn');
const testerStatus = document.getElementById('tester-status');
const testerEmpty = document.getElementById('tester-empty');
const testerPlayerContent = document.getElementById('tester-player-content');
const testerAudio = document.getElementById('tester-audio');
const testerLyricsWrap = document.getElementById('tester-lyrics-wrap');
const testerSongTitle = document.getElementById('tester-song-title');
const testerSongLrc = document.getElementById('tester-song-lrc');
const testerLineBadge = document.getElementById('tester-line-badge');
const globalOffsetVal = document.getElementById('global-offset-val');
const tapModeBtn = document.getElementById('tap-mode-btn');
const tapModeHint = document.getElementById('tap-mode-hint');
const testerSaveLrcBtn = document.getElementById('tester-save-lrc-btn');

/** @type {{timestamp_str:string, seconds:number, originalSeconds:number, text:string}[]} */
let testerLines = [];
let testerActiveIdx = -1;
/** @type {File|null} */
let testerMp3File = null;
/** @type {File|null} */
let testerCustomLrcFile = null;

let globalOffset = 0.0;
let tapMode = false;
let tapTargetIdx = -1;

// ---------------------------------------------------------------------------
// Load list of _modified LRC files into the select dropdown
// ---------------------------------------------------------------------------
async function loadTesterLrcList() {
    try {
        const res = await fetch('/list_modified_lrc');
        const data = await res.json();
        const files = data.records || data.files || [];

        // Clear existing options (keep placeholder)
        testerLrcSelect.innerHTML = '<option value="">...select a file </option>';
        files.forEach(file => {
            const name = typeof file === 'string' ? file : file.filename;
            const opt = document.createElement('option');
            opt.value = typeof file === 'string' ? file : file.id;
            opt.textContent = name;
            testerLrcSelect.appendChild(opt);
        });

        if (!files.length) {
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.textContent = 'No _modified files found';
            testerLrcSelect.appendChild(opt);
        }
    } catch (e) {
        console.error('Failed to load modified LRC list:', e);
    }
}

// ---------------------------------------------------------------------------
// File pick handlers
// ---------------------------------------------------------------------------
function onCustomLrcPicked(input) {
    const file = input.files[0];
    if (!file) return;
    testerCustomLrcFile = file;
    customLrcName.textContent = file.name;
    customLrcLabel.classList.add('has-file');
    // Clear the dropdown selection since custom file takes priority
    testerLrcSelect.value = '';
}

async function loadTesterMp3List() {
    try {
        const res = await fetch('/list_mp3');
        const data = await res.json();
        const files = data.files || [];

        // Clear existing options (keep placeholder)
        testerMp3Select.innerHTML = '<option value="">...select a file </option>';
        files.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            testerMp3Select.appendChild(opt);
        });

        if (!files.length) {
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.textContent = 'No MP3 files found';
            testerMp3Select.appendChild(opt);
        }
    } catch (e) {
        console.error('Failed to load MP3 list:', e);
    }
}

function onMp3Picked(input) {
    const file = input.files[0];
    if (!file) return;
    testerMp3File = file;
    testerMp3Name.textContent = file.name;
    mp3Label.classList.add('has-file');
    // Clear the dropdown selection since custom file takes priority
    testerMp3Select.value = '';
}

// ---------------------------------------------------------------------------
// LRC parser: "  [mm:ss.xx] text" ...[{timestamp_str, seconds, text}]
// ---------------------------------------------------------------------------
function parseLrcText(content) {
    const result = [];
    const re = /(\[\d+:\d+\.\d+\])(.*)/;
    content.split('\n').forEach(line => {
        const m = line.match(re);
        if (!m) return;
        const tsStr = m[1];  // e.g. "[01:23.45]"
        const text = m[2].trim();
        // Parse seconds
        const inner = tsStr.slice(1, -1); // "01:23.45"
        const [minPart, secPart] = inner.split(':');
        const seconds = parseInt(minPart, 10) * 60 + parseFloat(secPart);
        result.push({ timestamp_str: tsStr, seconds, originalSeconds: seconds, text });
    });
    return result;
}

// ---------------------------------------------------------------------------
// Render lyric lines into the display
// ---------------------------------------------------------------------------
function renderTesterLyrics(lines) {
    testerLyricsWrap.innerHTML = '';
    testerActiveIdx = -1;

    lines.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'lyric-line' + (tapMode ? ' interactive' : '');
        div.dataset.idx = i;
        div.innerHTML = `<span class="lyric-ts">${escHtml(line.timestamp_str)}</span><span class="lyric-text">${escHtml(line.text) || '<em style="opacity:0.4"></em>'}</span>`;
        if (tapMode) {
            div.onclick = () => setTapTarget(i);
        }
        testerLyricsWrap.appendChild(div);
    });
}

// ---------------------------------------------------------------------------
// Main: Load & Play
// ---------------------------------------------------------------------------
async function loadTesterFiles() {
    setTesterStatus('', '');

    // Validate MP3
    const useDropdownMp3 = !testerMp3File && testerMp3Select.value;
    if (!testerMp3File && !useDropdownMp3) {
        setTesterStatus('Please select or upload an MP3 file.', 'error');
        return;
    }

    // Determine LRC source: custom file takes priority over dropdown
    const useCustomLrc = !!testerCustomLrcFile;
    const useDropdownLrc = !useCustomLrc && testerLrcSelect.value;

    if (!useCustomLrc && !useDropdownLrc) {
        setTesterStatus('Please select or upload an LRC file.', 'error');
        return;
    }

    testerLoadBtn.disabled = true;
    
    let audioSrc = '';

    try {
        // 1 ...Setup Audio Stream (Upload custom MP3, or use local server endpoint)
        if (testerMp3File) {
            setTesterStatus('Uploading MP3...', '');
            const formData = new FormData();
            formData.append('audio_file', testerMp3File);
            const uploadRes = await fetch('/upload_audio', { method: 'POST', body: formData });
            if (!uploadRes.ok) {
                const err = await uploadRes.json().catch(() => ({ detail: 'Upload failed' }));
                throw new Error(err.detail);
            }
            const { token } = await uploadRes.json();
            audioSrc = `/stream_audio/${token}`;
        } else {
            // Using dropdown string directly
            audioSrc = `/stream_local_audio/${encodeURIComponent(testerMp3Select.value)}`;
        }

        // 2 ...Load LRC lines
        setTesterStatus('Loading LRC...', '');
        let lines;
        if (useCustomLrc) {
            // Read from local File object
            const text = await testerCustomLrcFile.text();
            lines = parseLrcText(text);
        } else {
            // Fetch parsed lines from backend
            const lrcRes = await fetch(`/get_modified_lrc/${encodeURIComponent(testerLrcSelect.value)}`);
            if (!lrcRes.ok) throw new Error('Failed to load LRC from server.');
            const lrcData = await lrcRes.json();
            lines = lrcData.lines.map(l => ({ ...l, originalSeconds: l.seconds }));
        }

        if (!lines || !lines.length) {
            throw new Error('LRC file has no timestamp lines.');
        }

        testerLines = lines;
        globalOffset = 0.0;
        updateGlobalOffsetDisplay();
        if (tapMode) setTapTarget(0);

        // 3 ...Build display
        const mp3Name = testerMp3File ? testerMp3File.name : testerMp3Select.value;
        const lrcName = useCustomLrc ? testerCustomLrcFile.name : testerLrcSelect.value;

        testerSongTitle.textContent = mp3Name.replace(/\.mp3$/i, '');
        testerSongLrc.textContent = lrcName;
        testerLineBadge.textContent = `Line .../ ${lines.length}`;

        renderTesterLyrics(lines);

        // 4 ...Wire audio
        testerAudio.src = audioSrc;
        testerAudio.load();

        // Show player
        testerEmpty.style.display = 'none';
        testerPlayerContent.style.display = 'flex';

        setTesterStatus(`✓ Loaded ${lines.length} lyric lines. Press play!`, 'success');
    } catch (e) {
        setTesterStatus(`Error: ${e.message}`, 'error');
    } finally {
        testerLoadBtn.disabled = false;
    }
}

// ---------------------------------------------------------------------------
// Audio timeupdate ...sync highlight
// ---------------------------------------------------------------------------
testerAudio.addEventListener('timeupdate', onTesterTimeUpdate);

function onTesterTimeUpdate() {
    if (!testerLines.length) return;
    const t = testerAudio.currentTime;

    // Binary search for the last line whose timestamp <= current time
    let lo = 0, hi = testerLines.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (testerLines[mid].seconds <= t) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    if (found === testerActiveIdx) return; // no change

    testerActiveIdx = found;

    // Update all line classes
    const allLines = testerLyricsWrap.querySelectorAll('.lyric-line');
    allLines.forEach((el, i) => {
        el.classList.remove('active', 'past');
        if (i < found) el.classList.add('past');
        else if (i === found) el.classList.add('active');
    });

    // Update badge
    if (found >= 0) {
        testerLineBadge.textContent = `Line ${found + 1} / ${testerLines.length}`;
    }

    // Scroll active line into center of the lyrics window
    if (found >= 0) {
        const activeLine = allLines[found];
        if (activeLine) {
            const wrapRect = testerLyricsWrap.getBoundingClientRect();
            const lineRect = activeLine.getBoundingClientRect();
            const offset = lineRect.top - wrapRect.top - wrapRect.height / 2 + lineRect.height / 2;
            testerLyricsWrap.scrollTop += offset;
        }
    }
}

// ---------------------------------------------------------------------------
// Utility: set status text
// ---------------------------------------------------------------------------
function setTesterStatus(msg, type) {
    testerStatus.textContent = msg;
    testerStatus.className = 'tester-status' + (type ? ` ${type}` : '');
}

// ---------------------------------------------------------------------------
// Tools: Global Offset
// ---------------------------------------------------------------------------
function secondsToLrcTimestamp(sec) {
    if (sec < 0) sec = 0;
    const minutes = Math.floor(sec / 60);
    const secs = sec % 60;
    const centiseconds = Math.floor((secs % 1) * 100);
    return `[${String(minutes).padStart(2, '0')}:${String(Math.floor(secs)).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
}

function updateGlobalOffsetDisplay() {
    globalOffsetVal.textContent = (globalOffset > 0 ? '+' : '') + globalOffset.toFixed(1) + 's';
}

function adjustGlobalOffset(delta) {
    if (!testerLines.length) return;
    
    globalOffset += delta;
    updateGlobalOffsetDisplay();

    testerLines.forEach(line => {
        let newSec = line.originalSeconds + globalOffset;
        if (newSec < 0) newSec = 0;
        line.seconds = newSec;
        line.timestamp_str = secondsToLrcTimestamp(newSec);
    });

    renderTesterLyrics(testerLines);
    if (tapMode && tapTargetIdx >= 0) {
        setTapTarget(tapTargetIdx);
    }
}

// ---------------------------------------------------------------------------
// Tools: Tap to Stamp
// ---------------------------------------------------------------------------
function toggleTapMode() {
    tapMode = !tapMode;
    tapModeHint.style.display = tapMode ? 'inline' : 'none';
    tapModeBtn.innerHTML = tapMode ? '<span class="btn-icon">🎯</span> On' : '<span class="btn-icon">🎯</span> Off';
    tapModeBtn.className = tapMode ? 'btn btn-primary' : 'btn btn-ghost';
    
    // Re-render to add/remove 'interactive' class and click listeners
    if (testerLines.length) {
        renderTesterLyrics(testerLines);
        if (tapMode) {
            setTapTarget(0); // target first line by default
        } else {
            tapTargetIdx = -1;
        }
    }
}

function setTapTarget(idx) {
    if (!tapMode || idx < 0 || idx >= testerLines.length) return;
    tapTargetIdx = idx;
    
    const allLines = testerLyricsWrap.querySelectorAll('.lyric-line');
    allLines.forEach((el, i) => {
        if (i === tapTargetIdx) {
            el.classList.add('target');
            // Scroll target into view if needed
            const wrapRect = testerLyricsWrap.getBoundingClientRect();
            const lineRect = el.getBoundingClientRect();
            if (lineRect.top < wrapRect.top || lineRect.bottom > wrapRect.bottom) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        } else {
            el.classList.remove('target');
        }
    });
}

document.addEventListener('keydown', (e) => {
    // If in tap mode and user pressed Enter (prevent default to avoid clicking focused buttons)
    if (tapMode && e.key === 'Enter') {
        e.preventDefault();
        
        if (testerLines.length === 0 || tapTargetIdx < 0 || tapTargetIdx >= testerLines.length) return;
        
        const currentTime = testerAudio.currentTime;
        const line = testerLines[tapTargetIdx];
        
        // Update the line's time
        line.seconds = currentTime;
        // Also update originalSeconds so global offset works correctly on top of this later if adjusting
        line.originalSeconds = currentTime - globalOffset; 
        line.timestamp_str = secondsToLrcTimestamp(currentTime);
        
        // Update the DOM for this specific line smoothly without full re-render
        const lineEl = testerLyricsWrap.querySelector(`.lyric-line[data-idx="${tapTargetIdx}"]`);
        if (lineEl) {
            lineEl.querySelector('.lyric-ts').textContent = line.timestamp_str;
            // flash highlight
            lineEl.style.backgroundColor = 'rgba(66, 230, 149, 0.4)';
            setTimeout(() => lineEl.style.backgroundColor = '', 300);
        }
        
        // Move to next target
        setTapTarget(tapTargetIdx + 1);
    }
});

// ---------------------------------------------------------------------------
// Tools: Save/Overwrite LRC
// ---------------------------------------------------------------------------
async function saveTesterLrc() {
    if (!testerLines.length) return;
    
    // Combine lines into LRC content
    const lrcContent = testerLines.map(l => `${l.timestamp_str} ${l.text}`).join('\n');
    let filenameToSave = testerLrcSelect.value;
    
    if (testerCustomLrcFile) {
        filenameToSave = testerCustomLrcFile.name;
    }
    
    if (!filenameToSave) {
        setTesterStatus('No filename available to save.', 'error');
        return;
    }

    testerSaveLrcBtn.disabled = true;
    testerSaveLrcBtn.textContent = '💾 Saving...';

    try {
        const formData = new FormData();
        formData.append('filename', filenameToSave);
        formData.append('lrc_content', lrcContent);

        const res = await fetch('/save_lrc', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Save failed' }));
            throw new Error(err.detail);
        }
        
        const data = await res.json();
        setTesterStatus(`✓ Saved ${data.saved_as} successfully.`, 'success');
    } catch (e) {
        setTesterStatus(`Error saving: ${e.message}`, 'error');
    } finally {
        testerSaveLrcBtn.disabled = false;
        testerSaveLrcBtn.textContent = '💾 Overwrite LRC';
    }
}

// Load list when tab opens
// (hooked into switchTab below ...see the patch in switchTab)


// ===========================================================================
// Tab 4 ...Tag Manager
// ===========================================================================

// --- State ---
let tagCurrentFile = null;    // filename currently loaded
let tagCurrentToken = null;   // private temporary cloud upload token
let tagDownloadName = null;
let tagUploadedData = null;
let tagCoverData   = '';      // base64 data-URL or '' if no new cover
let tagCoverRemoved = false;  // true if user clicked Remove
/** @type {Array<{filename,title,artist,album}>} */
let allTagFiles = [];

// --- DOM ---
const tagsMp3List    = document.getElementById('tags-mp3-list');
const tagsCountBadge = document.getElementById('tags-count-badge');
const tagsSearch     = document.getElementById('tags-search');
const tagsEmpty      = document.getElementById('tags-empty');
const tagsContent    = document.getElementById('tags-content');
const tagsFilename   = document.getElementById('tags-filename');
const tagsSaveBtn    = document.getElementById('tags-save-btn');
const tagsRenameBtn  = document.getElementById('tags-rename-btn');
const tagsStatus     = document.getElementById('tags-status');
const tagTitle       = document.getElementById('tag-title');
const tagArtist      = document.getElementById('tag-artist');
const tagAlbum       = document.getElementById('tag-album');
const tagYear        = document.getElementById('tag-year');
const tagGenre       = document.getElementById('tag-genre');
const coverArtImg    = document.getElementById('cover-art-img');
const coverPlaceholder = document.getElementById('cover-placeholder');
const coverRemoveBtn = document.getElementById('cover-remove-btn');
const coverFileInput = document.getElementById('cover-file-input');
const metaSearchInput = document.getElementById('meta-search-input');
const metaResults    = document.getElementById('meta-results');
const ytUrlInput     = document.getElementById('yt-url-input');
const ytStatus       = document.getElementById('yt-status');
const metaSearchBtn  = document.getElementById('meta-search-btn');
const ytFetchBtn     = document.getElementById('yt-fetch-btn');

// --- Load MP3 list ---
async function loadTagMp3List() {
    if (window.appConfig?.cloud) {
        if (!tagCurrentToken) {
            tagsMp3List.innerHTML = '<p class="empty-state">Choose an MP3 from your device above.</p>';
            tagsCountBadge.style.display = 'none';
        }
        return;
    }
    tagsMp3List.innerHTML = '<p class="empty-state">Loading</p>';
    tagsCountBadge.style.display = 'none';
    try {
        const res  = await fetch('/list_all_mp3');
        const data = await res.json();
        allTagFiles = data.files || [];
        renderTagMp3List(allTagFiles);
    } catch (e) {
        tagsMp3List.innerHTML = '<p class="empty-state" style="color:var(--red)">Failed to load MP3s.</p>';
    }
}

async function uploadTagMp3(input) {
    const file = input.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.mp3')) {
        input.value = '';
        return alert('Please choose an MP3 file.');
    }
    tagsMp3List.innerHTML = '<p class="empty-state">Uploading MP3...</p>';
    const formData = new FormData();
    formData.append('audio_file', file);
    try {
        const response = await fetch('/api/tag/upload', { method: 'POST', body: formData });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || 'Upload failed.');
        tagCurrentToken = data.token;
        tagCurrentFile = data.filename;
        tagDownloadName = data.filename;
        tagUploadedData = data;
        allTagFiles = [{ filename: data.filename, title: data.title || '', artist: data.artist || '', album: data.album || '' }];
        renderTagMp3List(allTagFiles);
        const button = tagsMp3List.querySelector('.tag-mp3-btn');
        applyTagData(data, button);
    } catch (error) {
        tagsMp3List.innerHTML = `<p class="empty-state" style="color:var(--red)">${escHtml(error.message)}</p>`;
    } finally {
        input.value = '';
    }
}

function renderTagMp3List(files) {
    tagsMp3List.innerHTML = '';
    // Preserved search field in renderTagMp3List
    if (!files.length) {
        tagsCountBadge.style.display = 'none';
        tagsMp3List.innerHTML = '<p class="empty-state">No MP3 files found in Music folder.</p>';
        return;
    }
    tagsCountBadge.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;
    tagsCountBadge.style.display = '';
    files.forEach((item, idx) => {
        const btn = makeTagMp3Btn(item, idx + 1);
        if (tagCurrentFile === item.filename) { btn.classList.add('selected'); }
        tagsMp3List.appendChild(btn);
    });
    if (tagsSearch && tagsSearch.value.trim()) { filterTagList(tagsSearch.value); }
}

function makeTagMp3Btn(item, num) {
    const btn = document.createElement('button');
    btn.className = 'lrc-file-btn tag-mp3-btn';
    btn.dataset.filename = item.filename;
    btn.title = item.filename;
    const displayTitle  = item.title  || item.filename.replace(/\.mp3$/i, '');
    const displayArtist = item.artist || '';
    btn.innerHTML = `
        <span class="lrc-file-num">${num}</span>
        <span class="lrc-file-name">
            <span class="tag-btn-title">${escHtml(displayTitle)}</span>
            ${displayArtist ? `<span class="tag-btn-artist">${escHtml(displayArtist)}</span>` : ''}
        </span>`;
    btn.onclick = () => tagCurrentToken && tagUploadedData
        ? applyTagData(tagUploadedData, btn)
        : openTagFile(item.filename, btn);
    return btn;
}

function filterTagList(query) {
    const q = query.trim().toLowerCase();
    let visible = 0;
    tagsMp3List.querySelectorAll('.tag-mp3-btn').forEach(btn => {
        const match = !q || btn.dataset.filename.toLowerCase().includes(q) ||
                      btn.textContent.toLowerCase().includes(q);
        btn.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    if (allTagFiles.length) {
        tagsCountBadge.textContent = q
            ? `${visible} / ${allTagFiles.length}`
            : `${allTagFiles.length} file${allTagFiles.length !== 1 ? 's' : ''}`;
    }
}

// --- Open & load a single file's tags ---
async function openTagFile(filename, btnEl) {
    document.querySelectorAll('.tag-mp3-btn').forEach(b => b.classList.remove('selected'));
    if (btnEl) btnEl.classList.add('selected');
    tagCurrentFile = filename;

    tagsEmpty.style.display   = 'none';
    tagsContent.style.display = 'flex';
    tagsFilename.textContent  = filename;
    setTagsStatus('Loading tags...', '');

    // Reset cover state
    tagCoverData    = '';
    tagCoverRemoved = false;
    resetCoverDisplay();

    try {
        const res  = await fetch(`/get_tags/${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error('Could not load tags.');
        const data = await res.json();

        tagTitle.value  = data.title  || '';
        tagArtist.value = data.artist || '';
        tagAlbum.value  = data.album  || '';
        tagYear.value   = data.year   || '';
        tagGenre.value  = data.genre  || '';

        if (data.cover_data) {
            showCover(data.cover_data);
        }

        // Pre-fill metadata search with artist + title
        const autoQ = [data.artist, data.title].filter(Boolean).join(' ');
        if (metaSearchInput && autoQ) metaSearchInput.value = autoQ;
        metaResults.innerHTML = '';
        setTagsStatus('', '');
    } catch (e) {
        setTagsStatus(`Error: ${e.message}`, 'error');
    }
}

function applyTagData(data, btnEl) {
    document.querySelectorAll('.tag-mp3-btn').forEach(button => button.classList.remove('selected'));
    if (btnEl) btnEl.classList.add('selected');
    tagsEmpty.style.display = 'none';
    tagsContent.style.display = 'flex';
    tagsFilename.textContent = data.filename;
    tagTitle.value = data.title || '';
    tagArtist.value = data.artist || '';
    tagAlbum.value = data.album || '';
    tagYear.value = data.year || '';
    tagGenre.value = data.genre || '';
    tagCoverData = '';
    tagCoverRemoved = false;
    resetCoverDisplay();
    if (data.cover_data) showCover(data.cover_data);
    const autoQuery = [data.artist, data.title].filter(Boolean).join(' ');
    if (metaSearchInput && autoQuery) metaSearchInput.value = autoQuery;
    metaResults.innerHTML = '';
    setTagsStatus('Ready to edit. Download the MP3 when finished.', 'success');
}

// --- Cover art helpers ---
function showCover(src) {
    coverArtImg.src     = src;
    coverArtImg.style.display  = '';
    coverPlaceholder.style.display = 'none';
    coverRemoveBtn.style.display   = '';
}

function resetCoverDisplay() {
    coverArtImg.src    = '';
    coverArtImg.style.display  = 'none';
    coverPlaceholder.style.display = '';
    coverRemoveBtn.style.display   = 'none';
    if (coverFileInput) coverFileInput.value = '';
}

function onCoverPicked(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            // Forcibly transcode any image format (AVIF, WebP, PNG) to extremely compatible JPEG
            tagCoverData = canvas.toDataURL('image/jpeg', 0.9);
            tagCoverRemoved = false;
            showCover(tagCoverData);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function removeCover() {
    tagCoverData    = '';
    tagCoverRemoved = true;
    resetCoverDisplay();
}

// --- Save Tags ---
async function saveTags() {
    if (!tagCurrentFile) return;
    tagsSaveBtn.disabled = true;
    tagsSaveBtn.textContent = '💾 Saving...';
    setTagsStatus('', '');
    try {
        const formData = new FormData();
        formData.append('filename', tagCurrentFile);
        formData.append('title',    tagTitle.value.trim());
        formData.append('artist',   tagArtist.value.trim());
        formData.append('album',    tagAlbum.value.trim());
        formData.append('year',     tagYear.value.trim());
        formData.append('genre',    tagGenre.value.trim());
        // Send cover data only if user explicitly changed it
        if (tagCoverData) {
            formData.append('cover_data', tagCoverData);
        }
        // If user removed cover, send special sentinel
        // (backend currently keeps existing cover if no cover_data provided)
        // so we send empty string to clear
        if (tagCoverRemoved) {
            formData.append('cover_data', '');
        }

        const endpoint = tagCurrentToken ? `/api/tag/${encodeURIComponent(tagCurrentToken)}` : '/update_tags';
        const res = await fetch(endpoint, { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(err.detail);
        }
        setTagsStatus('✓ Tags saved successfully!', 'success');
        if (tagCurrentToken && tagUploadedData) {
            Object.assign(tagUploadedData, {
                filename: tagCurrentFile,
                title: tagTitle.value.trim(), artist: tagArtist.value.trim(),
                album: tagAlbum.value.trim(), year: tagYear.value.trim(), genre: tagGenre.value.trim()
            });
        }
        // Refresh sidebar to reflect new title/artist
        if (!tagCurrentToken) loadTagMp3List();
    } catch (e) {
        setTagsStatus(`Error: ${e.message}`, 'error');
    } finally {
        tagsSaveBtn.disabled = false;
        tagsSaveBtn.textContent = '💾 Save Tags';
    }
}

// --- Rename File ---
async function renameTagFile() {
    if (!tagCurrentFile) return;
    const title = tagTitle.value.trim();
    if (!title) {
        alert('Please fill in the Title field before renaming.');
        setTagsStatus('Title is required for rename.', 'error');
        return;
    }

    // New name is just the title
    let newName = `${title}.mp3`;

    // Sanitize: remove characters illegal in Windows filenames
    newName = newName.replace(/[<>:"/\\|?*]/g, '_');

    if (!confirm(`Rename file to:\n"${newName}"?`)) return;

    if (tagCurrentToken) {
        tagDownloadName = newName;
        tagCurrentFile = newName;
        if (tagUploadedData) tagUploadedData.filename = newName;
        tagsFilename.textContent = newName;
        setTagsStatus(`Download filename changed to "${newName}".`, 'success');
        return;
    }

    tagsRenameBtn.disabled = true;
    try {
        const formData = new FormData();
        formData.append('filename', tagCurrentFile);
        formData.append('new_name', newName);
        const res = await fetch('/rename_mp3', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Rename failed' }));
            throw new Error(err.detail);
        }
        const data = await res.json();
        setTagsStatus(`\u2713 Renamed to "${data.new_name}"`, 'success');
        tagCurrentFile = data.new_name;
        tagsFilename.textContent = data.new_name;
        loadTagMp3List();
    } catch (e) {
        setTagsStatus(`Error: ${e.message}`, 'error');
    } finally {
        tagsRenameBtn.disabled = false;
    }
}

async function downloadTaggedMp3() {
    if (!tagCurrentToken) {
        return alert('Choose an MP3 from your device first.');
    }
    const button = document.getElementById('tags-download-btn');
    button.disabled = true;
    try {
        const filename = tagDownloadName || tagCurrentFile || 'tagged.mp3';
        const response = await fetch(`/api/tag/${encodeURIComponent(tagCurrentToken)}/download?filename=${encodeURIComponent(filename)}`);
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || 'Download failed.');
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        alert(`Download failed: ${error.message}`);
    } finally {
        button.disabled = false;
    }
}

// --- Metadata Search ---
async function searchTagMetadata() {
    const q = metaSearchInput.value.trim();
    if (!q) return;
    metaSearchBtn.disabled = true;
    metaSearchBtn.textContent = 'Searching...';
    metaResults.innerHTML = '<p class="empty-state" style="padding:0.75rem 0">Searching iTunes</p>';
    try {
        const res  = await fetch(`/search_metadata?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Search failed' }));
            throw new Error(err.detail);
        }
        const data = await res.json();
        renderMetaResults(data.results || []);
    } catch (e) {
        metaResults.innerHTML = `<p class="empty-state" style="color:var(--red)">${escHtml(e.message)}</p>`;
    } finally {
        metaSearchBtn.disabled = false;
        metaSearchBtn.textContent = 'Search';
    }
}

function renderMetaResults(results) {
    metaResults.innerHTML = '';
    if (!results.length) {
        metaResults.innerHTML = '<p class="empty-state" style="padding:0.75rem 0">No results found. Try a different search.</p>';
        return;
    }
    results.forEach(track => {
        const card = document.createElement('div');
        card.className = 'meta-result-card';
        card.innerHTML = `
            ${track.artwork_url
                ? `<img class="meta-thumb" src="${escHtml(track.artwork_url)}" alt="Cover" loading="lazy">`
                : `<div class="meta-thumb-placeholder">🎵</div>`}
            <div class="meta-info">
                <div class="meta-track">${escHtml(track.title)}</div>
                <div class="meta-artist">${escHtml(track.artist)}</div>
                <div class="meta-album">${escHtml(track.album)}${track.year ? ` · ${escHtml(track.year)}` : ''}</div>
            </div>
            <button class="btn btn-ghost meta-apply-btn">Apply</button>`;
        card.querySelector('.meta-apply-btn').onclick = () => applyMetaCandidate(track, card);
        metaResults.appendChild(card);
    });
}

async function applyMetaCandidate(track, cardEl) {
    // Highlight selected card
    document.querySelectorAll('.meta-result-card').forEach(c => c.classList.remove('selected'));
    cardEl.classList.add('selected');

    tagTitle.value  = track.title  || tagTitle.value;
    tagArtist.value = track.artist || tagArtist.value;
    tagAlbum.value  = track.album  || tagAlbum.value;
    if (track.year) tagYear.value = track.year;

    // Fetch the artwork and store as cover
    if (track.artwork_url) {
        try {
            const imgRes  = await fetch(track.artwork_url);
            const blob    = await imgRes.blob();
            const dataUrl = await blobToDataURL(blob);
            tagCoverData    = dataUrl;
            tagCoverRemoved = false;
            showCover(dataUrl);
        } catch (_) {
            // Artwork fetch failed ...skip silently
        }
    }

    setTagsStatus('✓ Metadata applied. Review and click Save Tags.', 'success');
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// --- YouTube metadata ---
async function fetchYoutubeMeta() {
    const url = ytUrlInput.value.trim();
    if (!url) return;
    ytFetchBtn.disabled = true;
    ytFetchBtn.textContent = 'Fetching...';
    setYtStatus('Contacting yt-dlp...', '');
    try {
        const formData = new FormData();
        formData.append('url', url);
        const res = await fetch('/fetch_youtube_meta', { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: 'Fetch failed' }));
            throw new Error(err.detail);
        }
        const data = await res.json();
        // Apply what we got
        if (data.title)  tagTitle.value  = data.title;
        if (data.artist) tagArtist.value = data.artist;
        if (data.album)  tagAlbum.value  = data.album;
        // Try to grab thumbnail as cover
        if (data.thumbnail) {
            try {
                const imgRes  = await fetch(data.thumbnail);
                const blob    = await imgRes.blob();
                const dataUrl = await blobToDataURL(blob);
                tagCoverData    = dataUrl;
                tagCoverRemoved = false;
                showCover(dataUrl);
            } catch (_) {}
        }
        const siteName = data.extractor || 'video';
        const channelInfo = data.channel ? ` (${data.channel})` : '';
        setYtStatus(`\u2713 Metadata fetched from ${siteName}${channelInfo}. Review and click Save Tags.`, 'success');
    } catch (e) {
        setYtStatus(`Error: ${e.message}`, 'error');
    } finally {
        ytFetchBtn.disabled = false;
        ytFetchBtn.textContent = 'Fetch';
    }
}

// --- Utility ---
function setTagsStatus(msg, type) {
    if (!tagsStatus) return;
    tagsStatus.textContent = msg;
    tagsStatus.className   = 'tester-status' + (type ? ` ${type}` : '');
}

function setYtStatus(msg, type) {
    if (!ytStatus) return;
    ytStatus.textContent = msg;
    ytStatus.className   = 'tester-status' + (type ? ` ${type}` : '');
}

// Setup resize for Tags sidebar
(function setupTagsSidebarResize() {
    const resizer = document.getElementById('tags-sidebar-resizer');
    const sidebar = document.getElementById('tags-sidebar');
    if (!resizer || !sidebar) return;
    let startX, startW;
    resizer.addEventListener('mousedown', e => {
        e.preventDefault();
        startX = e.clientX;
        startW = sidebar.getBoundingClientRect().width;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        function onMove(e) {
            const delta = e.clientX - startX;
            const newW = Math.max(260, Math.min(520, startW + delta));
            sidebar.style.flex = `0 0 ${newW}px`;
        }
        function onUp() {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
})();

// Bind Tab 4 Events
if (tagsSearch) { tagsSearch.addEventListener('input', e => filterTagList(e.target.value)); }
if (metaSearchInput) { metaSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchTagMetadata(); }); }
if (ytUrlInput) { ytUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchYoutubeMeta(); }); }
