// SaveBook API Client

const API_BASE = '';

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
export async function convertPage({ url, format, pageSize, keepImages, removeAds }) {
    return apiRequest('POST', '/api/convert', {
        url,
        format: format || 'pdf',
        pageSize: pageSize || 'Letter',
        keepImages: keepImages !== false,
        removeAds: removeAds !== false,
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