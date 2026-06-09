// SaveBook Frontend — UI Logic

import { convertPage, getRecords, deleteRecord, sendToKindle, getStats } from './api.js';

// ---- DOM refs ----
const convertForm = document.getElementById('convert-form');
const urlInput = document.getElementById('url-input');
const convertBtn = document.getElementById('convert-btn');
const progressArea = document.getElementById('progress-area');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');
const progressBar = document.getElementById('progress-bar');
const resultArea = document.getElementById('result-area');
const resultTitle = document.getElementById('result-title');
const resultFilename = document.getElementById('result-filename');
const resultSize = document.getElementById('result-size');
const resultFormat = document.getElementById('result-format');
const downloadBtn = document.getElementById('download-btn');
const kindleBtn = document.getElementById('kindle-btn');
const saveRecordBtn = document.getElementById('save-record-btn');
const kindleEmailArea = document.getElementById('kindle-email-area');
const kindleEmail = document.getElementById('kindle-email');
const sendKindleBtn = document.getElementById('send-kindle-btn');
const errorArea = document.getElementById('error-area');
const errorMessage = document.getElementById('error-message');

// Stats
const statTotal = document.getElementById('stat-total');
const statPdf = document.getElementById('stat-pdf');
const statEpub = document.getElementById('stat-epub');

// ---- State ----
let currentFile = null;

// ---- Mobile menu ----
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const navLinks = document.getElementById('nav-links');
if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener('click', () => {
        navLinks.classList.toggle('open');
    });
}

// ---- Helpers ----
function formatBytes(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function setProgress(pct, text) {
    if (progressArea) progressArea.classList.remove('hidden');
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressPercent) progressPercent.textContent = pct + '%';
    if (progressText) progressText.textContent = text || '';
}

function showError(msg) {
    if (errorArea) {
        errorArea.classList.remove('hidden');
        if (errorMessage) errorMessage.textContent = msg;
    }
}

function hideError() {
    if (errorArea) errorArea.classList.add('hidden');
}

function showResult(title, filename, size, format) {
    if (resultArea) resultArea.classList.remove('hidden');
    if (resultTitle) resultTitle.textContent = title;
    if (resultFilename) resultFilename.textContent = filename;
    if (resultSize) resultSize.textContent = formatBytes(size);
    if (resultFormat) resultFormat.textContent = format.toUpperCase();
}

function hideResult() {
    if (resultArea) resultArea.classList.add('hidden');
    if (kindleEmailArea) kindleEmailArea.classList.add('hidden');
}

// ---- Convert form ----
if (convertForm) {
    convertForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();
        hideResult();

        const url = urlInput ? urlInput.value.trim() : '';
        if (!url) return;

        const format = document.querySelector('input[name="format"]:checked')?.value || 'pdf';
        const pageSize = document.getElementById('page-size')?.value || 'Letter';
        const keepImages = document.getElementById('keep-images')?.checked !== false;
        const removeAds = document.getElementById('remove-ads')?.checked !== false;

        if (convertBtn) {
            convertBtn.disabled = true;
            convertBtn.textContent = 'Converting…';
        }

        setProgress(10, 'Fetching page…');

        try {
            const result = await convertPage({ url, format, pageSize, keepImages, removeAds });

            setProgress(100, 'Done!');

            currentFile = {
                filename: result.filename,
                url: result.url,
                size: result.size,
            };

            const title = new URL(url).hostname;
            showResult(title, result.filename, result.size, format);

        } catch (err) {
            setProgress(0, 'Error');
            showError(err.message || 'Conversion failed');
        } finally {
            if (convertBtn) {
                convertBtn.disabled = false;
                convertBtn.textContent = 'Convert to e-book';
            }
        }
    });
}

// ---- Download ----
if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
        if (currentFile?.url) {
            window.location.href = currentFile.url;
        }
    });
}

// ---- Kindle ----
if (kindleBtn) {
    kindleBtn.addEventListener('click', () => {
        if (kindleEmailArea) {
            kindleEmailArea.classList.toggle('hidden');
        }
    });
}

if (sendKindleBtn) {
    sendKindleBtn.addEventListener('click', async () => {
        const email = kindleEmail ? kindleEmail.value.trim() : '';
        if (!email) return;

        sendKindleBtn.disabled = true;
        sendKindleBtn.textContent = 'Sending…';

        try {
            await sendToKindle({ email, filename: currentFile?.filename });
            sendKindleBtn.textContent = 'Sent!';
            setTimeout(() => {
                if (kindleEmailArea) kindleEmailArea.classList.add('hidden');
                sendKindleBtn.textContent = 'Send now';
                sendKindleBtn.disabled = false;
            }, 2000);
        } catch (err) {
            showError(err.message || 'Failed to send to Kindle');
            sendKindleBtn.disabled = false;
            sendKindleBtn.textContent = 'Send now';
        }
    });
}

// ---- Stats ----
async function loadStats() {
    try {
        const stats = await getStats();
        if (statTotal) statTotal.textContent = stats.total?.toLocaleString() ?? '—';
        if (statPdf) statPdf.textContent = stats.pdf?.toLocaleString() ?? '—';
        if (statEpub) statEpub.textContent = stats.epub?.toLocaleString() ?? '—';
    } catch (_) {
        // Stats are non-critical
    }
}

// ---- Init ----
loadStats();