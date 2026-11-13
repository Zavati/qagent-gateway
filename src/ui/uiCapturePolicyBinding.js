/** PC.3 policy authority. Mirrors qagent.ui-canonical-json.v1's sorted UTF-16 keys.
 * The hash covers the server-resolved policy, never client-supplied settings. */
const fail = () => { throw Object.assign(new Error('UI_ENVIRONMENT_POLICY_INVALID'), { code: 'UI_ENVIRONMENT_POLICY_INVALID', status: 409 }); };
function checkedString(value) {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
        } else if (code >= 0xdc00 && code <= 0xdfff) fail();
    }
    return value;
}
export function canonicalUiCapturePolicy(policy) {
    let nodes = 0;
    function visit(value, depth) {
        if (depth > 48 || ++nodes > 100000) fail();
        if (value === null || typeof value === 'boolean') return JSON.stringify(value);
        if (typeof value === 'string') return JSON.stringify(checkedString(value));
        if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail();
            return '[' + value.map(item => visit(item, depth + 1)).join(',') + ']';
        }
        if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
            return '{' + Object.keys(value).sort().map(key => {
                if (['__proto__', 'constructor', 'prototype'].includes(key)) fail();
                return JSON.stringify(checkedString(key)) + ':' + visit(value[key], depth + 1);
            }).join(',') + '}';
        }
        return fail();
    }
    return visit(policy, 0);
}
export async function uiCapturePolicyHash(policy) {
    const bytes = new TextEncoder().encode(canonicalUiCapturePolicy(policy));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
