import fs from 'node:fs';
const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const required = [
  ['CATALOG_QUERY_BASE_URL', /"CATALOG_QUERY_BASE_URL"\s*:\s*"https:\/\//],
  ['CATALOG_QUERY_TIMEOUT_MS', /"CATALOG_QUERY_TIMEOUT_MS"\s*:\s*"\d+"/],
];
for (const [label, re] of required) {
  if (!re.test(text)) throw new Error(`[QAgent Gateway] Missing/invalid ${label} in wrangler.jsonc`);
}
if (/"CATALOG_QUERY_HMAC_SECRET"\s*:/.test(text)) {
  throw new Error('[QAgent Gateway] CATALOG_QUERY_HMAC_SECRET must be a Worker secret, never a wrangler var.');
}
console.log('[QAgent Gateway] 07.5.12-A Catalog proxy configuration verified.');
