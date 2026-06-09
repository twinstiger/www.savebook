// Verify cleanHTML uses Readability when input is a real article
// and falls back to the regex heuristic when Readability can't extract.
//
// Run: node test-readability.mjs

import { cleanHTML } from './src/convert.js';

let failed = 0;
const ok = (cond, msg) => {
    if (cond) {
        console.log(`  ✓ ${msg}`);
    } else {
        console.log(`  ✗ ${msg}`);
        failed++;
    }
};

// ============================================================
// Test 1: real article → Readability path
// ============================================================
console.log('--- Test 1: real article-shaped page (Readability path) ---');
const ARTICLE = `<!DOCTYPE html>
<html>
<head><title>How CF Workers saved our startup</title></head>
<body>
<header><nav><a href="/">Home</a> <a href="/blog">Blog</a></nav></header>
<aside class="sidebar">Buy stuff now</aside>
<main>
<article>
<h1>How CF Workers saved our startup</h1>
<p>Last quarter we were bleeding cash on servers. We were running a Node.js monolith
on a single VM and every traffic spike meant paying for over-provisioned instances
or watching the site go down. Neither was acceptable.</p>
<p>Then we discovered Cloudflare Workers. The pitch was simple: write JavaScript
that runs per request, billed by the millisecond. Cold starts in under 5ms.
Free tier covers 100k requests per day. We were skeptical but the price was right.</p>
<p>The migration took two engineers about three weeks. Most of that was porting
our Express handlers to the Workers fetch API. Once that was done, our monthly
bill dropped from $200 to essentially zero.</p>
<h2>What we lost</h2>
<p>Workers don't have a filesystem. We had to refactor our image upload pipeline
to write directly to R2. The Node.js stdlib also isn't available — no Buffer,
no crypto (well, crypto via Web Crypto), no fs. Once you accept the model,
it's fine, but the first week was painful.</p>
</article>
</main>
<aside class="sidebar-right"><h3>Subscribe</h3><p>Get weekly posts.</p></aside>
<footer><p>&copy; 2026 Our Startup</p></footer>
</body>
</html>`;

const out1 = cleanHTML(ARTICLE, 'https://example.com/blog/cf-workers', { debug: true });
const text1 = out1.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

ok(out1.length > 200, 'output is non-trivial');
ok(text1.includes('bleeding cash'), 'article body survives');
ok(text1.includes('Cloudflare Workers'), 'article body survives (2)');
ok(!text1.includes('Buy stuff now'), 'sidebar ad stripped');
ok(!text1.includes('All rights reserved') && !text1.includes('&copy;'),
   'footer noise stripped');
ok(!text1.includes('Subscribe'), 'newsletter sidebar stripped');
ok(!/<nav\b/i.test(out1) || !/Home\s*<\/a>/.test(text1),
   'nav links stripped');

// ============================================================
// Test 2: minimal page → Readability returns null → regex fallback
// ============================================================
console.log('\n--- Test 2: minimal page (regex fallback path) ---');
const MINIMAL = `<!DOCTYPE html>
<html>
<head><title>Hello</title></head>
<body>
<p>Just one short paragraph that is well below the Readability char threshold
of five hundred characters total and is not wrapped in any semantic tag.</p>
</body>
</html>`;

const out2 = cleanHTML(MINIMAL, 'https://example.com/minimal', { debug: true });
const text2 = out2.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

ok(out2.length > 100, 'output is non-trivial');
ok(text2.includes('Just one short paragraph'), 'content survives (fallback used)');
ok(text2.includes('Hello'), 'title is present');

// ============================================================
// Test 3: garbage input doesn't crash, doesn't throw
// ============================================================
console.log('\n--- Test 3: malformed input does not throw ---');
let crashed = false;
try {
    const out3 = cleanHTML('<html><body><p>oops', 'https://example.com/oops', { debug: true });
    ok(typeof out3 === 'string' && out3.length > 0, 'malformed input still returns a string');
} catch (e) {
    crashed = true;
    ok(false, `cleanHTML threw on malformed input: ${e.message}`);
}
ok(!crashed, 'no exception on malformed input');

// ============================================================
// Test 4: external stylesheet links from <head> are preserved
// ============================================================
console.log('\n--- Test 4: external stylesheet <link> tags are preserved ---');
const WITH_LINKS = `<!DOCTYPE html>
<html>
<head>
<title>Page with CSS</title>
<link rel="stylesheet" href="/css/main.css">
<link rel="stylesheet" href="/css/dark.css">
</head>
<body>
<main>
<article>
<h1>Main heading</h1>
<p>This is the article body paragraph. It needs to be long enough to clear the
Readability threshold so the algorithm considers it a real article and not just
a few random sentences. We add a couple more sentences for good measure to make
sure we trip the threshold with margin. This should be enough text content for
Readability to actually run its scoring.</p>
</article>
</main>
</body>
</html>`;

const out4 = cleanHTML(WITH_LINKS, 'https://example.com/css', { debug: true });
ok(out4.includes('href="/css/main.css"'), 'main.css link preserved');
ok(out4.includes('href="/css/dark.css"'), 'dark.css link preserved');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${failed === 0 ? 'all checks passed' : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
