/**
 * Cloudflare Pages Function — proxies /api/* to the savebook-worker.
 *
 * The Worker is deployed at savebook-worker.413012298.workers.dev.
 * Pages itself serves static files (the frontend) from the frontend/ directory.
 * This function catches any /api/* request and forwards it to the Worker,
 * returning the Worker's response back to the browser.
 */
export async function onRequest({ request, env }) {
    const workerUrl = 'https://savebook-worker.413012298.workers.dev';

    // Strip the /api prefix and forward the rest to the Worker
    const url = new URL(request.url);
    const pathMatch = url.pathname.match(/^\/api(\/.*)$/);
    if (!pathMatch) {
        // Not an API route — let Pages handle it (static files)
        return fetch(request);
    }

    const targetPath = pathMatch[1]; // e.g. "/convert"
    const targetUrl = `${workerUrl}/api${targetPath}${url.search}`;

    const headers = new Headers(request.headers);
    // Ensure Origin is set correctly for the Worker to allow CORS
    headers.set('Origin', 'https://app.savebook.net');

    try {
        const response = await fetch(targetUrl, {
            method: request.method,
            headers,
            body: ['POST', 'PUT', 'PATCH'].includes(request.method)
                ? request.text()
                : undefined,
            redirect: 'follow',
        });

        // Clone the response so we can set CORS headers
        const clone = response.clone();
        const responseHeaders = new Headers(clone.headers);
        responseHeaders.set('Access-Control-Allow-Origin', 'https://app.savebook.net');
        responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type');

        return new Response(clone.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Worker unreachable: ' + err.message }), {
            status: 502,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': 'https://app.savebook.net',
            },
        });
    }
}