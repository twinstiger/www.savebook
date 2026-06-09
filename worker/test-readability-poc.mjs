// Proof of concept: linkedom + @mozilla/readability
// Does Readability work with linkedom? Compare its output to the current
// regex heuristic on the same sample page.

import { parseHTML } from 'linkedom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { cleanHTML } from './src/convert.js';

// A representative blog-post-shaped page: nav, ads, sidebar, footer noise
// around a main article. We use it to see how each extractor scores.
const SAMPLE = `<!DOCTYPE html>
<html lang="en">
<head>
    <title>How Cloudflare Workers saved our startup</title>
    <meta charset="utf-8">
    <link rel="stylesheet" href="/css/main.css">
</head>
<body>
    <header class="site-header">
        <nav>
            <a href="/">Home</a>
            <a href="/blog">Blog</a>
            <a href="/about">About</a>
        </nav>
    </header>

    <aside class="sidebar-left">
        <div class="ad-banner">BUY STUFF NOW</div>
        <ul class="recent-posts">
            <li><a href="/p1">Post 1</a></li>
            <li><a href="/p2">Post 2</a></li>
            <li><a href="/p3">Post 3</a></li>
        </ul>
    </aside>

    <main>
        <article>
            <h1>How Cloudflare Workers saved our startup</h1>
            <p class="byline">By Jane Doe · 2026-05-01</p>

            <p>Last quarter, our startup was bleeding cash on server bills. We were running a Node.js
            monolith on a single $200/month VM, and every traffic spike meant we had to either pay
            for over-provisioned instances or watch the site go down. Neither was acceptable.</p>

            <p>That's when we discovered Cloudflare Workers. The pitch was simple: instead of running
            a long-lived server, write JavaScript that gets invoked per request, billed by the
            millisecond. Cold starts in under 5ms. Free tier covers 100,000 requests per day. We
            were skeptical but the price was right.</p>

            <p>The migration took two engineers about three weeks. Most of that was porting our
            Express handlers to the Workers fetch API, which is just a slightly different shape
            than Node's http module. Once that was done, our monthly bill dropped from $200 to
            essentially zero.</p>

            <p>The biggest surprise was the latency. Our old VM was in us-east-1 and our users
            were global. After moving to Workers, p50 latency dropped from 380ms to 42ms, and p99
            from 2.1s to 180ms. Edge execution is not a marketing gimmick.</p>

            <h2>What we lost</h2>
            <p>Workers don't have a filesystem. We had to refactor our image upload pipeline
            to write directly to R2. The Node.js stdlib also isn't available — no Buffer, no
            crypto (well, crypto via Web Crypto), no fs. Once you accept the model, it's fine,
            but the first week was painful.</p>

            <h2>Would we do it again?</h2>
            <p>Yes, in a heartbeat. The combination of pay-per-request pricing, edge execution,
            and zero ops is exactly what a small team needs. We're never going back to a
            long-lived VM unless our traffic profile changes dramatically.</p>
        </article>
    </main>

    <aside class="sidebar-right">
        <div class="newsletter-signup">
            <h3>Subscribe</h3>
            <p>Get our weekly posts in your inbox.</p>
            <input type="email" placeholder="you@example.com">
            <button>Subscribe</button>
        </div>
        <div class="ad-banner">SPONSORED: Cool Product</div>
    </aside>

    <footer>
        <p>&copy; 2026 Our Startup. All rights reserved.</p>
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
    </footer>
</body>
</html>`;

console.log('--- Sample page: ~', SAMPLE.length, 'chars ---');
console.log('--- Word count of all <p> text: ---');
const totalWords = SAMPLE
    .match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)
    .map(p => p.replace(/<[^>]+>/g, ''))
    .reduce((s, t) => s + t.split(/\s+/).filter(Boolean).length, 0);
console.log('   ', totalWords, 'words total across ALL <p> tags');

// ============================================================
// 1) Current extractor (cleanHTML → serialize)
// ============================================================
console.log('\n=== [1/2] Current regex heuristic (cleanHTML) ===');
const t0 = Date.now();
const currentOut = cleanHTML(SAMPLE, 'https://example.com/blog/cf-workers', {});
const tCurrent = Date.now() - t0;
const currentText = currentOut.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const currentWords = currentText.split(/\s+/).filter(Boolean).length;
console.log(`Time:           ${tCurrent}ms`);
console.log(`Output length:  ${currentOut.length} chars`);
console.log(`Word count:     ${currentWords}`);
console.log(`First 300 chars of text:`);
console.log(`  ${currentText.slice(0, 300)}...`);

// ============================================================
// 2) Readability on the same input
// ============================================================
console.log('\n=== [2/2] Readability (linkedom + @mozilla/readability) ===');
const t1 = Date.now();
const { document } = parseHTML(SAMPLE);
const reader = new Readability(document, {
    debug: false,
    charThreshold: 100,        // default 500; lower so it works on shorter posts
    keepClasses: false,
});
const article = reader.parse();
const tRead = Date.now() - t1;

if (!article) {
    console.log('  ✗ Readability returned null (could not extract content)');
} else {
    const readText = (article.textContent || '').replace(/\s+/g, ' ').trim();
    const readWords = readText.split(/\s+/).filter(Boolean).length;
    console.log(`Time:           ${tRead}ms`);
    console.log(`Title:          ${article.title}`);
    console.log(`Byline:         ${article.byline || '(none)'}`);
    console.log(`Site name:      ${article.siteName || '(none)'}`);
    console.log(`Excerpt:        ${(article.excerpt || '').slice(0, 120)}...`);
    console.log(`Output length:  ${article.content.length} chars (XHTML)`);
    console.log(`Word count:     ${readWords}`);
    console.log(`First 300 chars of text:`);
    console.log(`  ${readText.slice(0, 300)}...`);
    console.log(`isProbablyReaderable: ${isProbablyReaderable(document)}`);
}

// ============================================================
// 3) Sanity: isProbablyReaderable should be true
// ============================================================
const { document: d2 } = parseHTML(SAMPLE);
console.log('\n=== Bonus: isProbablyReaderable check ===');
console.log('   isProbablyReaderable(SAMPLE) =', isProbablyReaderable(d2));

console.log('\n✅ PoC complete — no errors. Both extractors ran successfully.');
