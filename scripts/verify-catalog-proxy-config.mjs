import fs from 'node:fs';

const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

const required = [
  ['CATALOG_QUERY_BASE_URL', /"CATALOG_QUERY_BASE_URL"\s*:\s*"https:\/\//],
  ['CATALOG_QUERY_TIMEOUT_MS', /"CATALOG_QUERY_TIMEOUT_MS"\s*:\s*"\d+"/],
  [
    'CATALOG_QUERY_HMAC_SECRET required secret declaration',
    /"secrets"\s*:\s*\{[\s\S]*?"required"\s*:\s*\[[\s\S]*?"CATALOG_QUERY_HMAC_SECRET"[\s\S]*?\]/,
  ],
  [
    'CATALOG_QUERY_SERVICE service binding',
    /"services"\s*:\s*\[[\s\S]*?"binding"\s*:\s*"CATALOG_QUERY_SERVICE"[\s\S]*?"service"\s*:\s*"qagent-catalog"[\s\S]*?\]/,
  ],
];

for (const [label, re] of required) {
  if (!re.test(text)) {
    throw new Error(`[QAgent Gateway] Missing/invalid ${label} in wrangler.jsonc`);
  }
}

const varsMatch = text.match(/"vars"\s*:\s*\{([\s\S]*?)\n\t\},\n\t"d1_databases"/);
if (varsMatch && /"CATALOG_QUERY_HMAC_SECRET"\s*:/.test(varsMatch[1])) {
  throw new Error(
    '[QAgent Gateway] CATALOG_QUERY_HMAC_SECRET must never be stored under vars; declare only its name in secrets.required.',
  );
}

console.log(
  '[QAgent Gateway] 07.5.12-A Catalog proxy config verified: D1 proxy vars + required HMAC Worker secret + qagent-catalog Service Binding.',
);
