// Verify the page size guard:
//   - throws PAGE_TOO_LARGE on oversize input
//   - silently passes on small input
//   - default limit is 2 MB
//
// Run: node test-size-guard.mjs

import { validatePageSize, MAX_HTML_BYTES } from './src/convert.js';

let failed = 0;
const ok = (cond, msg) => {
    if (cond) {
        console.log(`  ✓ ${msg}`);
    } else {
        console.log(`  ✗ ${msg}`);
        failed++;
    }
};

console.log('--- Size guard tests ---');
console.log(`MAX_HTML_BYTES = ${MAX_HTML_BYTES} (${(MAX_HTML_BYTES / 1024 / 1024).toFixed(2)} MB)`);

// 1) Small input passes through
console.log('\n[1/4] Small input (< 2 MB) should NOT throw');
try {
    validatePageSize('<html><body><p>hello</p></body></html>');
    ok(true, 'small input does not throw');
} catch (e) {
    ok(false, `small input threw: ${e.message}`);
}

// 2) Empty string passes through
console.log('\n[2/4] Empty string should NOT throw');
try {
    validatePageSize('');
    ok(true, 'empty string does not throw');
} catch (e) {
    ok(false, `empty string threw: ${e.message}`);
}

// 3) Oversize input throws with PAGE_TOO_LARGE
console.log('\n[3/4] Oversize input (> 2 MB) should throw PAGE_TOO_LARGE');
const big = 'x'.repeat(MAX_HTML_BYTES + 1);
let caught = null;
try {
    validatePageSize(big);
} catch (e) {
    caught = e;
}
ok(caught !== null, 'oversize input throws');
ok(caught && caught.code === 'PAGE_TOO_LARGE', 'error.code === "PAGE_TOO_LARGE"');
ok(caught && /页面过大/.test(caught.message), 'message contains "页面过大"');
ok(caught && /分块|阅读模式/.test(caught.message), 'message mentions "分块" or "阅读模式"');
ok(caught && caught.size === MAX_HTML_BYTES + 1, `error.size === ${MAX_HTML_BYTES + 1}`);
ok(caught && caught.limit === MAX_HTML_BYTES, `error.limit === ${MAX_HTML_BYTES}`);

// 4) Exactly at the limit does NOT throw (boundary is inclusive)
console.log('\n[4/4] Exactly MAX_HTML_BYTES chars should NOT throw');
try {
    validatePageSize('x'.repeat(MAX_HTML_BYTES));
    ok(true, 'exact-limit input does not throw');
} catch (e) {
    ok(false, `exact-limit input threw: ${e.message}`);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${failed === 0 ? 'all checks passed' : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
