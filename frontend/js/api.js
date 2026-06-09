// SaveBook API Client

// Direct to the deployed Worker — bypasses Pages /api/* routing issue
const API_BASE = 'https://savebook-worker.413012298.workers.dev';

// Stable session ID — persists across page reloads within this browser.
// Worker requires sessionId to associate conversions with a session.
function getSessionId() {
    let sid = localStorage.getItem('sb_sid');
    if (!sid) {
        sid = crypto.randomUUID();
        localStorage.setItem('sb_sid', sid);
    }
    return sid;
}

// ---- Helpers ----
async function apiRequest(method, path, body) {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        credentials: 'omit',
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);
    const data = await res.json().catch(() => ({ error: 'Invalid response' }));

    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

// ---- API calls ----
export async function convertPage({ url, format, pageSize, keepImages, removeAds, fontSize, lineSpacing }) {
    return apiRequest('POST', '/api/convert', {
        url,
        format: format || 'pdf',
        sessionId: getSessionId(),
        options: {
            pageSize: pageSize || 'Letter',
            keepImages: keepImages !== false,
            removeAds: removeAds !== false,
            fontSize: fontSize || 'medium',
            lineSpacing: lineSpacing || 'normal',
        },
    });
}

export async function getRecords() {
    return apiRequest('GET', '/api/records', null);
}

export async function deleteRecord(id) {
    return apiRequest('POST', '/api/delete-record', { id });
}

export async function sendToKindle({ email, filename }) {
    return apiRequest('POST', '/api/send-kindle', { email, filename });
}

export async function getStats() {
    return apiRequest('GET', '/api/stats', null);
}