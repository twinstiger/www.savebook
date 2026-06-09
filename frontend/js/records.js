// SaveBook Records Page

import { getRecords, deleteRecord } from './api.js';

const PAGE_SIZE = 10;
let currentPage = 1;
let records = [];

function getSessionId() {
    return localStorage.getItem('sb_sid') || '';
}

function formatBytes(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleString();
    } catch {
        return dateStr;
    }
}

function renderRecords() {
    const list = document.getElementById('records-list');
    const empty = document.getElementById('records-empty');
    const loading = document.getElementById('records-loading');
    const pagination = document.getElementById('records-pagination');
    const errorEl = document.getElementById('records-error');

    if (!list) return;
    loading?.classList.add('hidden');

    if (!records || records.length === 0) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        pagination?.classList.add('hidden');
        return;
    }

    empty?.classList.add('hidden');

    const start = (currentPage - 1) * PAGE_SIZE;
    const page = records.slice(start, start + PAGE_SIZE);

    list.innerHTML = page.map(r => `
        <div class="record-item" data-id="${r.id || r.conversionId || ''}">
            <div class="record-info">
                <div class="record-title">${escapeHtml(r.title || 'Untitled')}</div>
                <div class="record-meta">
                    <span>${r.format?.toUpperCase() || 'FILE'}</span> ·
                    <span>${formatBytes(r.file_size || r.fileSize)}</span> ·
                    <span>${formatDate(r.created_at || r.createdAt)}</span>
                </div>
                <div class="record-url">${escapeHtml(truncateUrl(r.url || r.source_url || '', 60))}</div>
            </div>
            <div class="record-actions">
                ${r.download_url || r.url ? `<a href="${r.download_url || r.url}" class="btn btn-soft btn-sm" download>Download</a>` : ''}
                <button class="btn btn-soft btn-sm record-delete" data-id="${r.id || r.conversionId || ''}">Delete</button>
            </div>
        </div>
    `).join('');

    // Delete handlers
    list.querySelectorAll('.record-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (!id) return;
            btn.disabled = true;
            try {
                await deleteRecord(id);
                records = records.filter(r => (r.id || r.conversionId || '') !== id);
                renderRecords();
            } catch (err) {
                if (errorEl) {
                    errorEl.classList.remove('hidden');
                    errorEl.textContent = err.message || 'Delete failed';
                }
            } finally {
                btn.disabled = false;
            }
        });
    });

    // Pagination
    const totalPages = Math.ceil(records.length / PAGE_SIZE);
    if (totalPages > 1) {
        pagination?.classList.remove('hidden');
        const indicator = document.getElementById('page-indicator');
        if (indicator) indicator.textContent = `Page ${currentPage} of ${totalPages}`;
        const prevBtn = document.getElementById('prev-page-btn');
        const nextBtn = document.getElementById('next-page-btn');
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    } else {
        pagination?.classList.add('hidden');
    }
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function truncateUrl(url, n) {
    if (!url) return '';
    try {
        const u = new URL(url);
        const display = u.hostname + u.pathname;
        return display.length > n ? display.substring(0, n) + '…' : display;
    } catch {
        return url.length > n ? url.substring(0, n) + '…' : url;
    }
}

async function loadRecords() {
    const sessionId = getSessionId();
    if (!sessionId) {
        renderRecords();
        return;
    }

    const loading = document.getElementById('records-loading');
    const errorEl = document.getElementById('records-error');

    try {
        const data = await getRecords();
        records = data.records || data || [];
        currentPage = 1;
        renderRecords();
    } catch (err) {
        if (loading) loading.classList.add('hidden');
        if (errorEl) {
            errorEl.classList.remove('hidden');
            errorEl.textContent = err.message || 'Failed to load records';
        }
    }
}

// Pagination buttons
document.addEventListener('DOMContentLoaded', () => {
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderRecords();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(records.length / PAGE_SIZE);
            if (currentPage < totalPages) {
                currentPage++;
                renderRecords();
            }
        });
    }

    loadRecords();
});