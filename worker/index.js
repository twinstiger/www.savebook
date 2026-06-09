// SaveBook Worker - Main Entry
// Cloudflare Worker backend for SaveBook web-to-ebook converter
// Handles: web scraping, content cleaning, PDF/EPUB generation, R2 storage, D1 persistence, Kindle push

import { convertToPDF, convertToEPUB, convertToTXT, convertToMarkdown, cleanHTML, validatePageSize } from './src/convert.js';
import { uploadToR2, deleteFromR2 } from './src/r2.js';
import { saveConversion, getConversions, updateStats } from './src/d1.js';
import { sendToKindle } from './src/kindle.js';

// CORS allowlist. Order matters for matching; production origins come first.
// `*` is intentionally not used so that we can be deliberate about which
// frontends can call this API. Add new origins explicitly.
const ALLOWED_ORIGINS = [
    'https://app.savebook.net',
    'https://www.app.savebook.net',
    // Bare root domain (in case you want to serve the app at savebook.net later)
    'https://savebook.net',
    'https://www.savebook.net',
    // Preview / dev surfaces — keep while iterating
    'https://savebook-pdf.pages.dev',
    'https://525303b6.savebook-pdf.pages.dev',
    'https://c643ee69.savebook-pdf.pages.dev',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
];

// Legacy wildcard headers object (kept for the OPTIONS preflight and for
// routes that don't pass `request` through to corsHeadersFor). The actual
// allowed origin is decided by `corsHeadersFor()` for normal responses.
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, X-Savebook-Session, Authorization',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition',
    'Access-Control-Max-Age': '86400',
};

// Return CORS headers for a specific request — echoes the request Origin
// only if it's in the allowlist. For disallowed origins we still return the
// headers but with the FIRST allowed origin, so the browser will see a
// mismatch and reject the response (which is the secure default).
function corsHeadersFor(request) {
    const requestOrigin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(requestOrigin)
        ? requestOrigin
        : ALLOWED_ORIGINS[0];

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, X-Savebook-Session, Authorization',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition',
        'Access-Control-Max-Age': '86400',
    };
}

function jsonResponse(data, status = 200, request) {
    const headers = { 'Content-Type': 'application/json', ...CORS_HEADERS };
    if (request) Object.assign(headers, corsHeadersFor(request));
    return new Response(JSON.stringify(data), { status, headers });
}

function sanitizeFilename(title) {
    return title.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').substring(0, 50) || 'document';
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Handle CORS preflight (always)
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeadersFor(request) });
        }

        try {
            // Route: GET /api/download/* — Worker proxy that streams R2 objects
            // with correct Content-Type and Content-Disposition. We proxy
            // because R2's r2.dev public URLs serve ALL files as
            // application/octet-stream, which breaks in-browser rendering
            // of PDFs/EPUBs (browser shows "InternalError").
            if (path.startsWith('/api/download/') && request.method === 'GET') {
                return await handleDownload(request, env, path);
            }

            // Route: POST /api/convert
            if (path === '/api/convert' && request.method === 'POST') {
                return await handleConvert(request, env);
            }

            // Route: GET /api/records
            if (path === '/api/records' && request.method === 'GET') {
                return await handleGetRecords(request, env);
            }

            // Route: POST /api/delete-record
            if (path === '/api/delete-record' && request.method === 'POST') {
                return await handleDeleteRecord(request, env);
            }

            // Route: POST /api/send-kindle
            if (path === '/api/send-kindle' && request.method === 'POST') {
                return await handleSendKindle(request, env);
            }

            // Route: GET /api/stats
            if (path === '/api/stats' && request.method === 'GET') {
                return await handleGetStats(request, env);
            }

            // Diagnostic endpoint — echoes CORS / request info to help debug
            if (path === '/_test' || path === '/_debug') {
                return new Response(
                    JSON.stringify({
                        status: 'ok',
                        method: request.method,
                        origin: request.headers.get('Origin'),
                        userAgent: request.headers.get('User-Agent'),
                        referer: request.headers.get('Referer'),
                        // Add the requesting origin to the allowed list explicitly
                        corsAllowed: true,
                    }, null, 2),
                    {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            ...corsHeadersFor(request),
                        },
                    }
                );
            }

            // TEMP: probe whether the edge can reach various reader services.
            // GET /_probe?url=...  -> { status, length, contentType, body[0..200] }
            // GET /_probe?url=...&full=1  -> full body (debug only)
            if (path === '/_probe' && request.method === 'GET') {
                const target = url.searchParams.get('url');
                if (!target) return jsonResponse({ error: 'url param required' }, 400, request);
                const full = url.searchParams.get('full') === '1';
                const t0 = Date.now();
                try {
                    const r = await fetch(target, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SaveBook-Edge-Probe)' },
                        redirect: 'follow',
                    });
                    const text = await r.text();
                    const body = full ? text : { preview: text.slice(0, 300) };
                    return new Response(JSON.stringify({
                        status: r.status,
                        contentType: r.headers.get('content-type'),
                        length: text.length,
                        ms: Date.now() - t0,
                        body: body,
                    }, null, 2), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) },
                    });
                } catch (e) {
                    return new Response(JSON.stringify({
                        error: e.message, ms: Date.now() - t0,
                    }, null, 2), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) },
                    });
                }
            }

            // Health check
            if (path === '/' || path === '/health') {
                return new Response(
                    JSON.stringify({ status: 'ok', service: 'savebook-worker' }),
                    { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...corsHeadersFor(request) } }
                );
            }

            return jsonResponse({ error: 'Not found' }, 404, request);
        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({ error: error.message || 'Internal error' }, 500, request);
        }
    },
};

// === Route Handlers ===

async function handleConvert(request, env) {
    const body = await request.json();
    const { url: pageUrl, format, options = {}, sessionId } = body;

    // Validation
    if (!pageUrl || !format) {
        return jsonResponse({ error: 'Missing required fields: url, format' }, 400);
    }
    if (!['pdf', 'epub', 'txt', 'md'].includes(format)) {
        return jsonResponse({ error: 'Invalid format. Must be pdf, epub, txt, or md' }, 400);
    }
    if (!sessionId) {
        return jsonResponse({ error: 'Missing sessionId' }, 400);
    }

    // URL validation
    let parsedUrl;
    try {
        parsedUrl = new URL(pageUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('Only http/https URLs are allowed');
        }
    } catch (e) {
        return jsonResponse({ error: `Invalid URL: ${e.message}` }, 400);
    }

    // Fetch the target webpage
    let html, title;
    try {
        const response = await fetch(pageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'follow',
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('xml')) {
            throw new Error(`Unsupported content type: ${contentType}`);
        }

        html = await response.text();
    } catch (error) {
        return jsonResponse({ error: `Failed to fetch page: ${error.message}` }, 400);
    }

    // Reject oversize pages before any expensive heuristic extraction.
    // The MVP regex extractor is O(n²) on page size and triggers Worker
    // 1102 on large SSR pages. Returning 413 with an actionable message
    // is much friendlier than letting the user see a cryptic 1102.
    try {
        validatePageSize(html);
    } catch (e) {
        if (e && e.code === 'PAGE_TOO_LARGE') {
            return jsonResponse({
                error: e.message,
                code: 'PAGE_TOO_LARGE',
                size: e.size,
                limit: e.limit,
            }, 413, request);
        }
        throw e;
    }

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    title = titleMatch ? titleMatch[1].trim() : 'Untitled';

    // Clean content
    html = cleanHTML(html, pageUrl, options);

    // Generate the file
    let fileBuffer, filename, contentType;
    const timestamp = Date.now();
    const safeTitle = sanitizeFilename(title);

    try {
        if (format === 'pdf') {
            fileBuffer = await convertToPDF(html, pageUrl, options);
            filename = `${safeTitle}_${timestamp}.pdf`;
            contentType = 'application/pdf';
        } else if (format === 'epub') {
            fileBuffer = await convertToEPUB(html, title, pageUrl, options);
            filename = `${safeTitle}_${timestamp}.epub`;
            contentType = 'application/epub+zip';
        } else if (format === 'txt') {
            fileBuffer = convertToTXT(html, pageUrl, options);
            filename = `${safeTitle}_${timestamp}.txt`;
            contentType = 'text/plain; charset=utf-8';
        } else if (format === 'md') {
            fileBuffer = convertToMarkdown(html, pageUrl, options);
            filename = `${safeTitle}_${timestamp}.md`;
            contentType = 'text/markdown; charset=utf-8';
        }
    } catch (error) {
        return jsonResponse({ error: `Conversion failed: ${error.message}` }, 500);
    }

    // Upload to R2
    const r2Path = `conversions/${sessionId}/${filename}`;
    try {
        await uploadToR2(env.BUCKET, r2Path, fileBuffer, contentType);
    } catch (error) {
        return jsonResponse({ error: `Storage failed: ${error.message}` }, 500);
    }

    // Always serve downloads through the Worker proxy. The proxy sets the
    // correct Content-Type (PDF / EPUB), which R2's r2.dev URL strips.
    // Format: {origin}/api/download/{r2Path}
    const downloadUrl = `${new URL(request.url).origin}/api/download/${r2Path}`;

    // Save to D1
    let conversionId;
    try {
        conversionId = await saveConversion(env.DB, {
            sessionId,
            url: pageUrl,
            title,
            filename,
            format,
            fileSize: fileBuffer.length,
            r2Path,
        });
    } catch (error) {
        console.error('D1 save failed (non-blocking):', error);
    }

    // Update stats
    try {
        await updateStats(env.DB, format);
    } catch (error) {
        console.error('Stats update failed (non-blocking):', error);
    }

    return jsonResponse({
        success: true,
        conversionId,
        filename,
        size: fileBuffer.length,
        url: downloadUrl,
        title,
    });
}

async function handleGetRecords(request, env) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 10, 50);

    if (!sessionId) {
        return jsonResponse({ error: 'Session ID required' }, 400);
    }

    const records = await getConversions(env.DB, sessionId, page, limit);

    // Build proxy download URLs so the browser receives the right
    // Content-Type. R2's r2.dev URL strips content-type, so the proxy is
    // the only path that works for inline rendering.
    const origin = new URL(request.url).origin;
    for (const record of records) {
        if (record.r2_path) {
            record.downloadUrl = `${origin}/api/download/${record.r2_path}`;
        } else {
            record.downloadUrl = null;
        }
    }

    return jsonResponse({ records, page, limit });
}

async function handleDeleteRecord(request, env) {
    const { id, r2Path } = await request.json();

    if (!id || !r2Path) {
        return jsonResponse({ error: 'Missing id or r2Path' }, 400);
    }

    // Delete from R2
    try {
        await deleteFromR2(env.BUCKET, r2Path);
    } catch (error) {
        console.error('R2 delete failed (continuing):', error);
    }

    // Delete from D1
    await env.DB.prepare('DELETE FROM conversions WHERE id = ?').bind(id).run();

    return jsonResponse({ success: true });
}

async function handleSendKindle(request, env) {
    const { fileUrl, email, filename } = await request.json();

    if (!fileUrl || !email || !filename) {
        return jsonResponse({ error: 'Missing fileUrl, email, or filename' }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse({ error: 'Invalid email address' }, 400);
    }

    // Download the file
    const response = await fetch(fileUrl);
    if (!response.ok) {
        return jsonResponse({ error: 'Failed to fetch file for Kindle send' }, 400);
    }
    const fileBuffer = await response.arrayBuffer();

    // Send via SMTP
    await sendToKindle(env, fileBuffer, filename, email);

    return jsonResponse({ success: true });
}

async function handleGetStats(request, env) {
    const result = await env.DB.prepare(
        'SELECT total_conversions, total_pdf, total_epub, updated_at FROM site_stats WHERE id = 1'
    ).first();

    return jsonResponse(result || { total_conversions: 0, total_pdf: 0, total_epub: 0 });
}

// === Download proxy ===
//
// Streams an R2 object through the Worker so the browser receives the
// correct Content-Type and Content-Disposition headers. R2's r2.dev public
// URLs ignore the content-type set at upload time and force-serve
// application/octet-stream, which makes browsers refuse to render PDFs
// and EPUBs inline ("InternalError" in Chrome).
//
// Path format: /api/download/conversions/{sessionId}/{filename}
async function handleDownload(request, env, path) {
    // Strip the /api/download/ prefix to get the R2 key
    const key = decodeURIComponent(path.slice('/api/download/'.length));

    if (!key || key.includes('..')) {
        return jsonResponse({ error: 'Invalid key' }, 400, request);
    }

    // Fetch from R2
    let object;
    try {
        object = await env.BUCKET.get(key);
    } catch (e) {
        return jsonResponse({ error: `R2 fetch failed: ${e.message}` }, 500, request);
    }

    if (!object) {
        return jsonResponse({ error: 'Object not found' }, 404, request);
    }

    // Determine content type from extension (R2's r2.dev public URL strips
    // the upload-time content type, so we can't trust object.httpMetadata
    // reliably — derive it ourselves)
    const lowerKey = key.toLowerCase();
    let contentType = 'application/octet-stream';
    if (lowerKey.endsWith('.pdf')) {
        contentType = 'application/pdf';
    } else if (lowerKey.endsWith('.epub')) {
        contentType = 'application/epub+zip';
    } else if (lowerKey.endsWith('.mobi')) {
        contentType = 'application/x-mobipocket-ebook';
    } else if (lowerKey.endsWith('.txt')) {
        contentType = 'text/plain; charset=utf-8';
    } else if (lowerKey.endsWith('.md')) {
        contentType = 'text/markdown; charset=utf-8';
    } else if (object.httpMetadata && object.httpMetadata.contentType) {
        contentType = object.httpMetadata.contentType;
    }

    // Filename for the download prompt (just the basename, no path)
    const filename = key.split('/').pop() || 'download';
    const encodedFilename = encodeURIComponent(filename);

    const headers = {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodedFilename}`,
        'Content-Length': String(object.size),
        'Cache-Control': 'public, max-age=3600',
        ...corsHeadersFor(request),
    };

    return new Response(object.body, { status: 200, headers });
}
