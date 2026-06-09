// SaveBook Conversion Engine
// Handles: HTML cleaning (Mozilla Readability + regex fallback), PDF generation (PDFKit), EPUB generation (fflate-based)
//
// IMPORTANT NOTES:
// - Content extraction is delegated to Mozilla's Readability (the same library
//   Firefox Reader View uses), fed a linkedom-parsed document. Readability is
//   fast (linear), well-tested across many site layouts, and works in Workers
//   because it accepts a custom DOM implementation — no JSDOM needed.
// - When Readability can't extract anything (very minimal pages, weird markup,
//   throws on bad input), we fall back to a regex heuristic that ranks
//   candidate <div>s by <p>-text density.
// - PDF generation uses pdf-lib (pure JS). No CSS support — PDF output is
//   plain styled text only.
// - EPUB is generated in-house via fflate (pure JS ZIP).

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { ROBOTO_REGULAR_B64, ROBOTO_BOLD_B64, ROBOTO_ITALIC_B64 } from './fonts.js';

// ============================================================
// Page size guard
// ============================================================
//
// The MVP uses a regex-based heuristic extractor (`extractMainContent`).
// On very large SSR pages that regex pass is O(n²) and reliably triggers
// a Cloudflare Worker 1102 (or just runs out of CPU budget). Rather than
// letting users stare at a cryptic 1102, we reject oversize pages up
// front with an actionable message.
//
// 2 MB is the order of magnitude where 1102 has been observed. Lower
// it if testing shows the threshold is still too generous.

export const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB

// Throws an Error with `code = 'PAGE_TOO_LARGE'` if `html` is larger than
// MAX_HTML_BYTES. Call this *after* fetching the page body and *before*
// any extraction work.
export function validatePageSize(html) {
    if (typeof html === 'string' && html.length > MAX_HTML_BYTES) {
        const err = new Error(
            '页面过大，请尝试分块或使用浏览器的"阅读模式"再次尝试。'
        );
        err.code = 'PAGE_TOO_LARGE';
        err.size = html.length;
        err.limit = MAX_HTML_BYTES;
        throw err;
    }
}

// ============================================================
// linkedom helpers
// ============================================================

function parseFreshDocument(html) {
    const { document } = parseHTML(html);
    return document;
}

function serializeDocument(document) {
    return '<!DOCTYPE html>' + (document.documentElement?.outerHTML || '');
}

// ============================================================
// HTML Cleaning (Readability + regex fallback)
// ============================================================
export function cleanHTML(html, baseUrl, options = {}) {
    // 1) Collect any external stylesheet links from the original <head>.
    //    Most modern sites (toolsbase.net, etc.) put their CSS in /css/...
    //    files rather than inline, so the body alone loses them. Pull the
    //    <link> tags out of the head so they survive into the cleanDoc,
    //    where convertToEPUB will fetch and inline them.
    const stylesheetLinks = [];
    const linkRe = /<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/gi;
    for (const m of html.match(linkRe) || []) {
        const hrefMatch = m.match(/\bhref=["']?([^"'\s>]+)["']?/i);
        if (hrefMatch) stylesheetLinks.push(hrefMatch[1]);
    }

    // 2) Extract main content. Try Readability first (Mozilla's Firefox
    //    Reader View algorithm); fall back to a regex heuristic when it
    //    can't find anything or throws on weird input.
    let articleTitle = '';
    let content = '';
    let usedReadability = false;
    try {
        const srcDoc = parseFreshDocument(html);
        const reader = new Readability(srcDoc, {
            charThreshold: 100,    // default 500; lower so short posts still get extracted
            keepClasses: false,
        });
        const article = reader.parse();
        if (article && typeof article.content === 'string' && article.content.length > 50) {
            articleTitle = article.title || '';
            content = article.content;
            usedReadability = true;
        }
    } catch (e) {
        // Readability threw on weird HTML; fall through to heuristic
    }
    if (!content) {
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        articleTitle = articleTitle || (titleMatch ? titleMatch[1].trim() : '') || 'Untitled';
        content = extractMainContent(html, options);
    }

    // 3) Wrap in a fresh document and clean. Put a <base> tag in the head so
    //    that any relative URLs in the body resolve against the original page.
    const linksHtml = stylesheetLinks
        .map((h) => `<link rel="stylesheet" href="${escapeHtml(h)}"/>`)
        .join('');
    const cleanDoc = parseFreshDocument(
        `<!DOCTYPE html><html><head><meta charset="utf-8"/><base href="${escapeHtml(baseUrl)}"/><title>${escapeHtml(articleTitle)}</title>${linksHtml}</head><body>${content}</body></html>`
    );

    // Remove ads
    if (options.removeAds !== false) {
        removeAds(cleanDoc);
    }

    // Image handling
    const images = cleanDoc.querySelectorAll('img');
    if (options.keepImages === false) {
        images.forEach((img) => img.remove());
    } else {
        images.forEach((img) => {
            const src = img.getAttribute('src');
            if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('//')) {
                try {
                    img.setAttribute('src', new URL(src, baseUrl).href);
                } catch (e) {
                    img.remove();
                }
            }
            if (img.dataset && img.dataset.src) {
                img.setAttribute('src', img.dataset.src);
            }
        });
    }

    // Inject reader-friendly CSS
    const style = cleanDoc.createElement('style');
    style.textContent = `
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
               line-height: 1.7; max-width: 720px; margin: 0 auto; padding: 24px; color: #1a1a1a; }
        h1, h2, h3, h4 { line-height: 1.3; margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
        h1 { font-size: 1.9em; }
        h2 { font-size: 1.5em; }
        h3 { font-size: 1.25em; }
        p { margin-bottom: 1em; }
        img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
        pre, code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
        pre { padding: 1em; overflow-x: auto; }
        blockquote { border-left: 4px solid #ccc; padding-left: 1em; color: #555; margin: 1em 0; }
        a { color: #0066cc; text-decoration: none; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #ddd; padding: 0.5em 0.75em; }
    `;
    if (cleanDoc.head) {
        cleanDoc.head.appendChild(style);
    }

    if (options.debug) {
        const wordCount = (cleanDoc.body?.textContent || '').trim().split(/\s+/).filter(Boolean).length;
        console.log(`[cleanHTML] extractor=${usedReadability ? 'readability' : 'regex-fallback'} title="${articleTitle}" words=${wordCount}`);
    }

    return serializeDocument(cleanDoc);
}

// Heuristic main-content extractor. We rank candidate containers by text density
// (length of <p> text inside) and pick the highest-scoring one. Falls back to
// <body> if nothing scores well.
function extractMainContent(html, options = {}) {
    // Priority 1: explicit semantic tags
    const semanticPatterns = [
        /<article\b[^>]*>([\s\S]*?)<\/article>/i,
        /<main\b[^>]*>([\s\S]*?)<\/main>/i,
        /<div[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/i,
    ];
    for (const pattern of semanticPatterns) {
        const m = html.match(pattern);
        if (m && m[1].length > 200) return m[1];
    }

    // Priority 2: find the <div> with the highest density of <p> text
    // We score each <div> by total length of <p> text it contains.
    const divRegex = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;
    let bestDiv = null;
    let bestScore = 0;
    let m;
    while ((m = divRegex.exec(html)) !== null) {
        const inner = m[1];
        const pMatches = inner.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || [];
        const score = pMatches.reduce((s, p) => s + (p.replace(/<[^>]+>/g, '').length), 0);
        if (score > bestScore) {
            bestScore = score;
            bestDiv = inner;
        }
    }
    if (bestDiv && bestScore > 200) return bestDiv;

    // Priority 3: all <p> concatenated
    const allP = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi);
    if (allP && allP.join('').length > 200) return allP.join('');

    // Fallback: body
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    return bodyMatch ? bodyMatch[1] : html;
}

function removeAds(doc) {
    const adSelectors = [
        '[class*="ad-"]', '[class*="-ad"]', '[class*="Ad-"]', '[class*="-Ad"]',
        '[class*="advert"]', '[class*="banner"]', '[class*="promo"]',
        '[class*="sponsor"]', '[class*="sidebar"]', '[class*="newsletter"]',
        '[id*="ad-"]', '[id*="-ad"]', '[id*="banner"]',
        'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
        '.advertisement', '.ads', '.ad-container', '.sponsored',
    ];
    adSelectors.forEach((selector) => {
        try {
            doc.querySelectorAll(selector).forEach((el) => el.remove());
        } catch (e) {
            // Invalid selector; skip
        }
    });

    doc.querySelectorAll('script, noscript, iframe[src*="ads"]').forEach((el) => el.remove());
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ============================================================
// Image embedding
// ============================================================
//
// Walks the document, finds every <img> and <source srcset=...> URL,
// fetches each unique URL, and returns a map of {originalUrl -> {filename, data, mime}}.
// Also rewrites the <img>/<source> tags in-place to use the local filename
// (relative path inside the EPUB, e.g. "images/img1.webp") so the chapter
// can reference the embedded image without needing network access at read time.
//
// Returns: { images: Map, skipped: number }
//   - `images` keys are the *original* URLs (or resolved absolute URLs for
//     srcset entries); values have `{filename, data, mime}`.
//   - `skipped` is the count of images that couldn't be fetched.
//
// `maxImages` caps how many images we fetch — protects against pathological
// pages and keeps the EPUB a reasonable size.
async function embedImages(document, baseUrl, { maxImages = 25, maxBytes = 5 * 1024 * 1024, userAgent } = {}) {
    const ua = userAgent || 'Mozilla/5.0 (compatible; SaveBook/1.0)';
    const images = new Map(); // originalUrl -> { filename, data, mime }
    let skipped = 0;
    let count = 0;

    // 1) Collect unique URLs to fetch. We keep the FIRST <img src> and each
    //    unique srcset candidate. We resolve relative URLs to absolute before
    //    dedup so e.g. `/x.jpg` (in srcset) and `https://example.com/x.jpg`
    //    (in src) only get fetched once.
    const urls = new Set();
    const elements = document.querySelectorAll('img, source');
    const resolveUrl = (u) => {
        if (!u) return null;
        try { return new URL(u, baseUrl).href; } catch { return null; }
    };
    for (const el of elements) {
        const src = el.getAttribute('src');
        const absSrc = resolveUrl(src);
        if (absSrc) urls.add(absSrc);
        const srcset = el.getAttribute('srcset');
        if (srcset) {
            for (const candidate of srcset.split(',')) {
                const u = candidate.trim().split(/\s+/)[0];
                const absU = resolveUrl(u);
                if (absU) urls.add(absU);
            }
        }
    }

    // 2) Fetch each unique URL. Resolve relative to baseUrl first.
    for (const rawUrl of urls) {
        if (count >= maxImages) { skipped++; continue; }
        if (rawUrl.startsWith('data:') || rawUrl.startsWith('about:')) continue;

        let absUrl;
        try {
            absUrl = new URL(rawUrl, baseUrl).href;
        } catch {
            skipped++;
            continue;
        }

        try {
            const r = await fetch(absUrl, { headers: { 'User-Agent': ua }, redirect: 'follow' });
            if (!r.ok) { skipped++; continue; }
            const buf = new Uint8Array(await r.arrayBuffer());
            if (buf.byteLength > maxBytes) { skipped++; continue; }
            if (buf.byteLength === 0) { skipped++; continue; }

            // Detect MIME from Content-Type or extension
            const ct = (r.headers.get('content-type') || '').split(';')[0].trim();
            const ext = inferImageExt(absUrl, ct);
            const mime = ct || mimeFromExt(ext);
            if (!mime) { skipped++; continue; }

            count++;
            const filename = `images/img${count}.${ext}`;
            images.set(rawUrl, { filename, data: buf, mime, absUrl });
        } catch {
            skipped++;
        }
    }

    // 3) Rewrite <img>/<source> src and srcset to use local filenames.
    //    The `images` map is keyed by absolute URL (after dedup). For
    //    rewriting, we need to look up by whatever the attribute currently
    //    contains — which can be the original (possibly relative) URL OR
    //    the absolute URL (cleanHTML normalizes `src` but not `srcset`).
    //    Build a lookup that accepts either form.
    const rewriteMap = new Map();
    for (const [absUrl, entry] of images) {
        rewriteMap.set(absUrl, entry.filename);
        // Also allow lookup by the relative form so srcset values that were
        // never normalized still resolve.
        try {
            const rel = new URL(absUrl).pathname;
            if (rel && rel !== absUrl) rewriteMap.set(rel, entry.filename);
        } catch {}
    }

    for (const el of elements) {
        const src = el.getAttribute('src');
        if (src && rewriteMap.has(src)) {
            el.setAttribute('src', rewriteMap.get(src));
        }
        const srcset = el.getAttribute('srcset');
        if (srcset) {
            const rewritten = srcset.split(',').map(part => {
                const [u, ...desc] = part.trim().split(/\s+/);
                if (u && rewriteMap.has(u)) {
                    return [rewriteMap.get(u), ...desc].join(' ');
                }
                return part.trim();
            }).join(', ');
            el.setAttribute('srcset', rewritten);
        }
    }

    return { images, skipped, found: urls.size };
}

function inferImageExt(url, contentType) {
    if (contentType) {
        const m = contentType.match(/^image\/(jpeg|jpg|png|gif|webp|svg\+xml|avif)$/i);
        if (m) {
            return m[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        }
    }
    // Fallback: guess from URL path
    try {
        const path = new URL(url, 'http://x').pathname.toLowerCase();
        const m = path.match(/\.(jpg|jpeg|png|gif|webp|svg|avif)(?:\?|$)/);
        if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
    } catch {}
    return 'jpg';
}

function mimeFromExt(ext) {
    return ({
        jpg:  'image/jpeg',
        jpeg: 'image/jpeg',
        png:  'image/png',
        gif:  'image/gif',
        webp: 'image/webp',
        svg:  'image/svg+xml',
        avif: 'image/avif',
    })[ext] || 'image/jpeg';
}

// ============================================================
// PDF Generation (pdf-lib — pure JS, no filesystem deps)
// ============================================================

// Page size in PDF points (1pt = 1/72 inch)
const PAGE_SIZES = {
    A4:    { w: 595.28, h: 841.89 },
    LETTER: { w: 612,    h: 792    },
};

export async function convertToPDF(html, url, options = {}) {
    const document = parseFreshDocument(html);
    const title = (document.querySelector('title')?.textContent || 'Document').trim();

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(options.title || title || 'SaveBook Document');
    pdfDoc.setAuthor('SaveBook');
    pdfDoc.setCreator('SaveBook Cloud Converter');
    pdfDoc.setProducer('SaveBook (pdf-lib)');

    // Register fontkit so pdf-lib can read our embedded woff2 fonts
    pdfDoc.registerFontkit(fontkit);

    const helvetica      = await pdfDoc.embedFont(Buffer.from(ROBOTO_REGULAR_B64, 'base64'), { fontkit });
    const helveticaBold  = await pdfDoc.embedFont(Buffer.from(ROBOTO_BOLD_B64, 'base64'),    { fontkit });
    // pdf-lib has no built-in monospace; reuse the regular font for code blocks — won't align
    // but won't crash on unsupported glyphs.
    const courier        = helvetica;

    // Typography options
    const fontSizes  = { small: 10, medium: 12, large: 14 };
    const spacings   = { compact: 1.2, normal: 1.5, spacious: 2.0 };
    const margins    = { narrow: 36, normal: 50, wide: 72 };

    const pageSize   = PAGE_SIZES[options.pageSize === 'A4' ? 'A4' : 'LETTER'];
    const baseSize   = fontSizes[options.fontSize] || 12;
    const lineMult   = spacings[options.lineSpacing] || 1.5;
    const margin     = margins[options.margin] || 50;
    const maxWidth   = pageSize.w - 2 * margin;

    // ---------- Title page ----------
    const titlePage = pdfDoc.addPage([pageSize.w, pageSize.h]);
    const titleSize = 22;
    const titleWidth = helveticaBold.widthOfTextAtSize(title, titleSize);
    titlePage.drawText(title, {
        x: Math.max(margin, (pageSize.w - titleWidth) / 2),
        y: pageSize.h - 220,
        size: titleSize,
        font: helveticaBold,
        color: rgb(0, 0, 0),
    });
    const sourceText = `Source: ${truncate(url, 80)}`;
    const sourceSize = 10;
    const sourceWidth = helvetica.widthOfTextAtSize(sourceText, sourceSize);
    titlePage.drawText(sourceText, {
        x: (pageSize.w - sourceWidth) / 2,
        y: pageSize.h - 270,
        size: sourceSize,
        font: helvetica,
        color: rgb(0.4, 0.4, 0.4),
    });
    const dateText = `Generated: ${new Date().toISOString().split('T')[0]}`;
    const dateWidth = helvetica.widthOfTextAtSize(dateText, sourceSize);
    titlePage.drawText(dateText, {
        x: (pageSize.w - dateWidth) / 2,
        y: pageSize.h - 290,
        size: sourceSize,
        font: helvetica,
        color: rgb(0.4, 0.4, 0.4),
    });

    // ---------- Content pages ----------
    const ctx = {
        pdfDoc,
        page: pdfDoc.addPage([pageSize.w, pageSize.h]),
        y: pageSize.h - margin,
        pageSize,
        margin,
        maxWidth,
        helvetica,
        helveticaBold,
        courier,
        options,
        baseSize,   // typography: body font size in pt
        lineMult,   // typography: line-height multiplier
    };

    walkNodes(document.body, ctx);

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
}

// Render a text block. Wraps long lines; auto-paginates when Y goes below margin.
function drawTextBlock(ctx, text, opts = {}) {
    const size    = opts.size    || ctx.baseSize || 12;
    const font    = opts.font    || ctx.helvetica;
    const color   = opts.color   || rgb(0, 0, 0);
    const leading = opts.leading || (size * (ctx.lineMult || 1.35));
    const indent  = opts.indent  || 0;
    const textWidth = ctx.maxWidth - indent;

    const lines = wrapText(text, font, size, textWidth);
    for (const line of lines) {
        // Pagination
        if (ctx.y - size < ctx.margin) {
            ctx.page = ctx.pdfDoc.addPage([ctx.pageSize.w, ctx.pageSize.h]);
            ctx.y = ctx.pageSize.h - ctx.margin;
        }
        ctx.page.drawText(line, {
            x: ctx.margin + indent,
            y: ctx.y - size,
            size,
            font,
            color,
        });
        ctx.y -= leading;
    }
}

// Wrap text to fit maxWidth using the given font/size. Hard-breaks long
// words (no hyphenation) — good enough for a reader-friendly PDF.
function wrapText(text, font, size, maxWidth) {
    const paragraphs = String(text).split(/\n/);
    const out = [];
    for (const para of paragraphs) {
        if (!para) { out.push(''); continue; }
        const words = para.split(/\s+/);
        let line = '';
        for (const word of words) {
            // If a single word is wider than the line, hard-break it.
            if (font.widthOfTextAtSize(word, size) > maxWidth) {
                if (line) { out.push(line); line = ''; }
                let chunk = '';
                for (const ch of word) {
                    const test = chunk + ch;
                    if (font.widthOfTextAtSize(test, size) > maxWidth && chunk) {
                        out.push(chunk);
                        chunk = ch;
                    } else {
                        chunk = test;
                    }
                }
                if (chunk) line = chunk;
                continue;
            }
            const test = line ? line + ' ' + word : word;
            if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
                out.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        if (line) out.push(line);
    }
    return out;
}

function walkNodes(node, ctx) {
    if (!node) return;
    for (const child of node.childNodes) {
        renderNode(child, ctx);
    }
}

function renderNode(node, ctx) {
    if (node.nodeType === 3) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (text) drawTextBlock(ctx, text, { size: 12 });
        return;
    }
    if (node.nodeType !== 1) return;

    const tag = node.tagName.toLowerCase();
    const text = node.textContent.trim();

    switch (tag) {
        case 'h1':
            ctx.y -= 12;
            drawTextBlock(ctx, text, { size: 20, font: ctx.helveticaBold });
            ctx.y -= 8;
            break;
        case 'h2':
            ctx.y -= 8;
            drawTextBlock(ctx, text, { size: 16, font: ctx.helveticaBold });
            ctx.y -= 6;
            break;
        case 'h3':
        case 'h4':
            ctx.y -= 6;
            drawTextBlock(ctx, text, { size: 14, font: ctx.helveticaBold });
            ctx.y -= 4;
            break;
        case 'p':
            if (text) drawTextBlock(ctx, text, { size: 12 });
            ctx.y -= 6;
            break;
        case 'br':
            ctx.y -= 8;
            break;
        case 'hr':
            ctx.y -= 10;
            drawTextBlock(ctx, '─'.repeat(40), {
                size: 10,
                color: rgb(0.5, 0.5, 0.5),
                leading: 14,
            });
            ctx.y -= 10;
            break;
        case 'img':
            if (ctx.options.keepImages !== false) {
                const src = node.getAttribute('src');
                if (src) {
                    drawTextBlock(ctx, `[Image: ${truncate(src, 70)}]`, {
                        size: 9,
                        color: rgb(0.4, 0.4, 0.4),
                    });
                    ctx.y -= 4;
                }
            }
            break;
        case 'blockquote':
            ctx.y -= 6;
            drawTextBlock(ctx, text, {
                size: 11,
                color: rgb(0.3, 0.3, 0.3),
                indent: 20,
            });
            ctx.y -= 6;
            break;
        case 'pre':
        case 'code':
            ctx.y -= 4;
            drawTextBlock(ctx, text, {
                size: 10,
                font: ctx.courier,
                color: rgb(0.15, 0.15, 0.15),
                indent: 10,
            });
            ctx.y -= 4;
            break;
        case 'li':
            drawTextBlock(ctx, '• ' + text, { size: 12, indent: 15 });
            ctx.y -= 2;
            break;
        case 'ul':
        case 'ol':
            walkNodes(node, ctx);
            ctx.y -= 4;
            break;
        default:
            walkNodes(node, ctx);
    }
}

function truncate(s, n) {
    return s.length > n ? s.substring(0, n) + '...' : s;
}

// ─── Plain-text extractor (used by convertToTXT) ─────────────────────────────

function extractTextNodes(node, lines, opts = {}) {
    if (!node) return;
    const isBlock = opts.block;

    for (const child of node.childNodes) {
        if (child.nodeType === 3) {
            // Text node — collapse whitespace
            const text = child.textContent.replace(/\s+/g, ' ').trim();
            if (text) {
                if (isBlock && lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
                    lines.push(' ' + text);
                } else {
                    lines.push(text);
                }
            }
        } else if (child.nodeType === 1) {
            const tag = child.tagName.toLowerCase();

            if (tag === 'h1') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                if (t) { lines.push(''); lines.push(t); lines.push('='.repeat(Math.min(t.length, 60))); lines.push(''); }
            } else if (tag === 'h2') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                if (t) { lines.push(''); lines.push(t); lines.push('-'.repeat(Math.min(t.length, 60))); lines.push(''); }
            } else if (tag === 'h3' || tag === 'h4') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                if (t) { lines.push(''); lines.push('## ' + t); lines.push(''); }
            } else if (tag === 'p') {
                extractTextNodes(child, lines, { block: true });
                lines.push('');
            } else if (tag === 'br') {
                lines.push('');
            } else if (tag === 'hr') {
                lines.push(''); lines.push('─'.repeat(40)); lines.push('');
            } else if (tag === 'blockquote') {
                const inner = [];
                extractTextNodes(child, inner, { block: false });
                const t = inner.join(' ').trim();
                if (t) lines.push(''); lines.push('> ' + t.split('\n').join('\n> ')); lines.push('');
            } else if (tag === 'li') {
                const inner = [];
                extractTextNodes(child, inner, { block: false });
                const t = inner.join(' ').replace(/\s+/g, ' ').trim();
                if (t) lines.push('  • ' + t);
            } else if (tag === 'ul' || tag === 'ol') {
                extractTextNodes(child, lines, opts);
                lines.push('');
            } else if (tag === 'pre' || tag === 'code') {
                const t = child.textContent.trim();
                if (t) { lines.push(''); lines.push('```'); lines.push(t); lines.push('```'); lines.push(''); }
            } else if (tag === 'img') {
                const alt = child.getAttribute('alt') || '';
                const src = child.getAttribute('src') || '';
                if (alt) lines.push(`[${alt}]`);
                else if (src) lines.push(`[Image: ${truncate(src, 60)}]`);
            } else if (tag === 'a') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                const href = child.getAttribute('href') || '';
                if (t) {
                    if (href && href !== t) lines.push(`${t} <${href}>`);
                    else lines.push(t);
                }
            } else {
                // Descend into other elements (div, span, strong, em, etc.)
                extractTextNodes(child, lines, opts);
            }
        }
    }
}

// ─── Markdown extractor (used by convertToMarkdown) ─────────────────────────

function extractMarkdownNodes(node, lines, opts = {}) {
    if (!node) return;
    const depth = opts.listDepth || 0;

    for (const child of node.childNodes) {
        if (child.nodeType === 3) {
            const text = child.textContent.replace(/\s+/g, ' ').trim();
            if (text) lines.push(text);
        } else if (child.nodeType === 1) {
            const tag = child.tagName.toLowerCase();

            if (tag === 'h1') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                if (t) { lines.push(''); lines.push(`# ${t}`); lines.push(''); }
            } else if (tag === 'h2') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                if (t) { lines.push(''); lines.push(`## ${t}`); lines.push(''); }
            } else if (tag === 'h3') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                if (t) { lines.push(''); lines.push(`### ${t}`); lines.push(''); }
            } else if (tag === 'h4') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                if (t) { lines.push(''); lines.push(`#### ${t}`); lines.push(''); }
            } else if (tag === 'p') {
                extractMarkdownNodes(child, lines, opts);
                lines.push('');
            } else if (tag === 'br') {
                lines.push('  '); // Two-space trail for hard break in MD
            } else if (tag === 'hr') {
                lines.push(''); lines.push('---'); lines.push('');
            } else if (tag === 'blockquote') {
                const inner = [];
                extractMarkdownNodes(child, inner, opts);
                const t = inner.join(' ').trim();
                if (t) lines.push(''); lines.push('> ' + t.split('\n').join('\n> ')); lines.push('');
            } else if (tag === 'li') {
                const inner = [];
                extractMarkdownNodes(child, inner, { listDepth: depth + 1 });
                const t = inner.join(' ').replace(/\s+/g, ' ').trim();
                if (t) lines.push(`${'  '.repeat(depth)}- ${t}`);
            } else if (tag === 'ul' || tag === 'ol') {
                extractMarkdownNodes(child, lines, { listDepth: depth });
                lines.push('');
            } else if (tag === 'pre') {
                const t = child.textContent.trim();
                if (t) { lines.push(''); lines.push('```'); lines.push(t); lines.push('```'); lines.push(''); }
            } else if (tag === 'code') {
                // Inline code
                const t = child.textContent.trim();
                if (t) lines.push(`\`${t}\``);
            } else if (tag === 'img') {
                const alt = child.getAttribute('alt') || '';
                const src = child.getAttribute('src') || '';
                if (src) lines.push(`![${alt}](${src})`);
            } else if (tag === 'a') {
                const t = child.textContent.replace(/\s+/g, ' ').trim();
                const href = child.getAttribute('href') || '';
                if (t) lines.push(`[${t}](${href})`);
            } else if (tag === 'strong' || tag === 'b') {
                const inner = [];
                extractMarkdownNodes(child, inner, opts);
                const t = inner.join('').trim();
                if (t) lines.push(`**${t}**`);
            } else if (tag === 'em' || tag === 'i') {
                const inner = [];
                extractMarkdownNodes(child, inner, opts);
                const t = inner.join('').trim();
                if (t) lines.push(`*${t}*`);
            } else {
                extractMarkdownNodes(child, lines, opts);
            }
        }
    }
}

// ============================================================
// TXT Export — pure text, no formatting
// ============================================================

/**
 * Extract plain text from a clean HTML document.
 * Block elements get a blank line before/after so paragraphs are clear.
 */
export function convertToTXT(html, url, options = {}) {
    const document = parseFreshDocument(html);
    const title = (document.querySelector('title')?.textContent || 'Document').trim();

    const lines = [];

    // Header
    lines.push(title);
    lines.push('─'.repeat(Math.min(title.length, 60)));
    lines.push(`Source: ${url}`);
    lines.push(`Generated: ${new Date().toISOString().split('T')[0]}`);
    lines.push('');

    extractTextNodes(document.body, lines, { block: true });

    return Buffer.from(lines.join('\n'), 'utf-8');
}

// ============================================================
// Markdown Export — structured text with MD syntax
// ============================================================

/**
 * Extract content as GitHub-flavored Markdown.
 * Headings, lists, blockquotes, code blocks, and inline formatting preserved.
 */
export function convertToMarkdown(html, url, options = {}) {
    const document = parseFreshDocument(html);
    const title = (document.querySelector('title')?.textContent || 'Document').trim();

    const lines = [];

    // YAML-style frontmatter
    lines.push('---');
    lines.push(`title: "${title.replace(/"/g, '\\"')}"`);
    lines.push(`source: ${url}`);
    lines.push(`date: ${new Date().toISOString().split('T')[0]}`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${title}`);
    lines.push('');

    extractMarkdownNodes(document.body, lines, { listDepth: 0 });

    return Buffer.from(lines.join('\n'), 'utf-8');
}

// ============================================================
// EPUB Generation (minimal in-house implementation)
// ============================================================

// HTML5 void elements that MUST be self-closed in XHTML.
//   <img>  -> <img />
//   <br>   -> <br />
//   <hr>   -> <hr />
//   <source> (often inside <picture>) -> <source />
//   <input>, <meta>, <link> etc.
//
// Built with `new RegExp(string, ...)` so we can include a literal `/`
// inside a negative lookbehind (the regex-literal form `(?<!/)` confused
// Node's regex parser).
const VOID_ELEMENT_RE = new RegExp(
    '<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)' +
    '\\b([^>]*?)(?<!/)>',
    'gi'
);

function htmlToXhtml(bodyHtml) {
    // 1) Self-close HTML5 void elements so the result is valid XHTML.
    //    Without this, EPUB readers (which use strict XML parsers like libxml2)
    //    reject EPUBs that contain unclosed <img>, <br>, <hr>, <source>, etc.
    let out = bodyHtml.replace(VOID_ELEMENT_RE, '<$1$2 />');

    // 2) Quote any unquoted attribute values. HTML allows `<img src=foo.jpg>`,
    //    XHTML requires `<img src="foo.jpg" />`. Match `name=value` patterns
    //    where the value has no quote and no whitespace.
    out = out.replace(
        /(\s[a-zA-Z_:][-a-zA-Z0-9_:.]*)=([^"'\s<>][^"'\s<>]*)/g,
        '$1="$2"'
    );

    return out;
}

export async function convertToEPUB(html, title, url, options = {}) {
    const document = parseFreshDocument(html);

    // Don't strip <style> blocks anymore — preserve the page's original CSS.
    // We still inject our minimal reader CSS *first* so the page's styles can
    // override ours. Inline `style="..."` attributes on body elements are
    // already preserved by linkedom.
    const hasOriginalStyle = document.querySelectorAll('style, link[rel="stylesheet"]').length > 0;

    // Embed images (download, save to EPUB, rewrite src/srcset to local paths).
    const { images: embeddedImages, skipped: skippedImages, found: foundImages } = await embedImages(document, url, {
        maxImages: 25,
        maxBytes: 4 * 1024 * 1024,
    });
    if (skippedImages > 0 || embeddedImages.size > 0) {
        console.log(`[EPUB] image embedding: found=${foundImages}, embedded=${embeddedImages.size}, skipped=${skippedImages}`);
    }

    const articleTitle = (title || 'SaveBook Document').trim();
    const bodyContent = htmlToXhtml(document.body.innerHTML);
    const safeTitle = escapeXml(articleTitle);
    const safeAuthor = escapeXml(options.author || 'SaveBook');
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const uuid = crypto.randomUUID();

    // ---- Mimetype (must be the first entry, stored uncompressed) ----
    const mimetype = 'application/epub+zip';

    // ---- META-INF/container.xml ----
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    // ---- OEBPS/content.opf ----
    // Build the <manifest> with image entries. Each image becomes a separate
    // <item> in the EPUB so the chapter can reference it as a local file.
    const imageManifestItems = [...embeddedImages.values()]
        .map(({ filename, mime }, i) =>
            `    <item id="img${i + 1}" href="${escapeXml(filename)}" media-type="${escapeXml(mime)}"/>`
        )
        .join('\n');

    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${safeTitle}</dc:title>
    <dc:creator>${safeAuthor}</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>SaveBook</dc:publisher>
    <dc:date>${timestamp}</dc:date>
    <meta property="dcterms:modified">${timestamp}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
${imageManifestItems}
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`;

    // ---- OEBPS/nav.xhtml ----
    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      <li><a href="chapter.xhtml">${safeTitle}</a></li>
    </ol>
  </nav>
</body>
</html>`;

    // ---- OEBPS/chapter.xhtml ----
    // Pull the page's <style> blocks from the head and put them inside the
    // chapter's <head> so the page renders with its own CSS. Inline `style=""`
    // attributes on body elements are preserved by linkedom and are in bodyContent.
    //
    // We also fetch external stylesheets referenced by <link rel="stylesheet">
    // and inline them. Without this, toolsbase.net (and most modern sites) would
    // render unstyled in the EPUB reader because their CSS lives in /css/...
    // files, not inline.
    const styleChunks = [];
    let inlineStyleCount = 0, externalCssCount = 0;
    if (hasOriginalStyle) {
        for (const s of document.querySelectorAll('head style')) {
            if (s.textContent.trim()) { styleChunks.push(s.textContent); inlineStyleCount++; }
        }
        for (const link of document.querySelectorAll('head link[rel="stylesheet"]')) {
            const href = link.getAttribute('href');
            if (!href) continue;
            let abs;
            try { abs = new URL(href, url).href; } catch { continue; }
            try {
                const r = await fetch(abs, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SaveBook/1.0)' } });
                if (r.ok) {
                    const css = await r.text();
                    if (css.trim()) { styleChunks.push(`/* ${href} */\n${css}`); externalCssCount++; }
                }
            } catch {}
        }
    }
    if (inlineStyleCount || externalCssCount) {
        console.log(`[EPUB] CSS: ${inlineStyleCount} inline <style>, ${externalCssCount} external stylesheet(s) inlined`);
    }
    let originalStyleBlock = '';
    if (styleChunks.length) {
        // CDATA-wrapped so any '<' or '&' inside the CSS doesn't break the XHTML parse
        originalStyleBlock = `<style type="text/css"><![CDATA[\n${styleChunks.join('\n\n')}\n]]></style>`;
    }

    const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${safeTitle}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
  ${originalStyleBlock}
</head>
<body>
  <h1>${safeTitle}</h1>
  ${bodyContent}
</body>
</html>`;

    // ---- OEBPS/style.css ----
    const styleCss = `
body { font-family: Georgia, serif; line-height: 1.6; margin: 1.5em; }
h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 1.5em 0 0.5em; }
h1 { font-size: 1.6em; }
h2 { font-size: 1.3em; }
p { margin: 0 0 1em 0; }
img { max-width: 100%; height: auto; }
a { color: #1e6bb8; text-decoration: none; }
blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #555; margin: 1em 0; }
pre, code { font-family: "SF Mono", Menlo, Consolas, monospace; background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
pre { padding: 1em; overflow-x: auto; }
ul, ol { margin: 0 0 1em 1.5em; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #ddd; padding: 0.5em 0.75em; text-align: left; }
`;

    // ---- Build the ZIP using fflate's streaming Zip class ----
    // EPUB spec requires: (1) mimetype is the FIRST entry, (2) mimetype is STORED (not deflated).
    // We use ZipPassThrough for mimetype (level 0) and the default deflate for other files.

    return new Promise((resolve, reject) => {
        const chunks = [];
        const fileEntries = [
            { name: 'mimetype', data: strToU8(mimetype), stored: true },
            { name: 'META-INF/container.xml', data: strToU8(containerXml), stored: false },
            { name: 'OEBPS/content.opf', data: strToU8(contentOpf), stored: false },
            { name: 'OEBPS/nav.xhtml', data: strToU8(navXhtml), stored: false },
            { name: 'OEBPS/chapter.xhtml', data: strToU8(chapterXhtml), stored: false },
            { name: 'OEBPS/style.css', data: strToU8(styleCss), stored: false },
            // Embedded images (binary; not stored, but not text either)
            ...[...embeddedImages.values()].map(({ filename, data }) => ({
                name: `OEBPS/${filename}`,
                data,
                stored: false,
            })),
        ];

        const zip = new Zip((err, chunk, final) => {
            if (err) return reject(err);
            if (chunk) chunks.push(chunk);
            if (final) resolve(Buffer.concat(chunks));
        });

        for (const entry of fileEntries) {
            const pass = new ZipPassThrough(entry.name);
            zip.add(pass);
            pass.push(entry.data, true); // true = end of stream
        }
        zip.end();
    });
}

function escapeXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
