// Generated counterpart of normalizer/src/baseline/safeCapture.ts. Contract parity is tested.
/** Shared capture boundary v1. Already sanitized input is still treated as untrusted. */
export const CAPTURE_CONTRACT = "qagent.observed-baseline-capture.v1";
const DENIED = new Set(["__proto__", "constructor", "prototype", "authorization", "proxyauthorization", "cookie", "setcookie", "xapikey", "apikey", "xauthtoken", "password", "passwd", "pwd", "accesstoken", "refreshtoken", "idtoken", "clientsecret", "clientkey", "secret", "secretkey", "privatekey", "sessiontoken", "sessionid", "sid", "token", "authtoken", "bearertoken", "jwt", "credential", "credentials", "csrftoken", "xcsrftoken", "xsrftoken", "otp", "pin", "cvv", "awssecretaccesskey", "privatekeydata", "idempotencykey"]);
export function safeCaptureName(k) {
    return /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(k) && !DENIED.has(k.toLowerCase()) && !DENIED.has(k.toLowerCase().replace(/[^a-z0-9]/g, "")) && !k.toLowerCase().startsWith("redacted_field_") && !k.split(/[._-]+/).some(x => DENIED.has(x.toLowerCase()));
}
export function safeCaptureString(v) {
    return new TextEncoder().encode(v).length <= 256 && !/[\u0000-\u001f]|\[REDACTED\]|\[TRUNCATED\]|__qagent_(?:redacted|truncated)__|\bBearer\s+|\beyJ[A-Za-z0-9_-]{8,}\.|\b(?:qag_(?:test|live)_|sk-)[A-Za-z0-9_-]{8,}|-----BEGIN.*PRIVATE KEY|\$\{[^}]+\}/i.test(v);
}
export function isSafeCaptureJson(v, depth = 0, budget = { nodes: 0 }) {
    if (++budget.nodes > 512 || depth > 8)
        return false;
    if (v === null || typeof v === "boolean")
        return true;
    if (typeof v === "number")
        return Number.isFinite(v);
    if (typeof v === "string")
        return safeCaptureString(v);
    if (Array.isArray(v))
        return v.length <= 20 && v.every(x => isSafeCaptureJson(x, depth + 1, budget));
    if (!v || typeof v !== "object")
        return false;
    const entries = Object.entries(v);
    return entries.length <= 64 && entries.every(([k, x]) => safeCaptureName(k) && isSafeCaptureJson(x, depth + 1, budget));
}
export function canonicalJson(v) {
    function order(x) {
        if (Array.isArray(x))
            return x.map(order);
        if (x && typeof x === "object")
            return Object.fromEntries(Object.keys(x).sort().map(k => [k, order(x[k])]));
        return x;
    }
    return JSON.stringify(order(v));
}
export async function captureHash(v) {
    const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(v))));
    return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}
export function captureRequestSafe(v) {
    if (!v || typeof v !== "object" || Array.isArray(v))
        return false;
    const r = v;
    if (Object.keys(r).some(k => !["query", "pathParams", "headers", "body"].includes(k)))
        return false;
    for (const n of ["query", "pathParams", "headers"]) {
        if (!r[n] || typeof r[n] !== "object" || Array.isArray(r[n]))
            return false;
    }
    const headers = r.headers;
    if (Object.keys(headers).some(k => k !== "content-type") || (headers["content-type"] !== undefined && !["application/json", "application/x-www-form-urlencoded"].includes(String(headers["content-type"]))))
        return false;
    const q = r.query, p = r.pathParams;
    if (Object.keys(q).length > 48 || !Object.entries(q).every(([k, x]) => safeCaptureName(k) && (typeof x === "string" ? safeCaptureString(x) : Array.isArray(x) && x.length <= 20 && x.every(v => typeof v === "string" && safeCaptureString(v)))))
        return false;
    if (Object.keys(p).length > 32 || !Object.entries(p).every(([k, x]) => safeCaptureName(k) && typeof x === "string" && safeCaptureString(x)))
        return false;
    if (r.body !== undefined && !isSafeCaptureJson(r.body))
        return false;
    return new TextEncoder().encode(canonicalJson(r)).length <= 16384;
}
const SAFE_REASONS = new Set(["REQUEST_QUERY_UNAVAILABLE", "REPEATED_QUERY_UNAVAILABLE", "REQUEST_BODY_UNAVAILABLE", "REQUEST_BODY_TRUNCATED", "REQUEST_DATA_UNSAFE_OR_UNSUPPORTED", "REQUEST_PATH_UNAVAILABLE", "REPEATED_PATH_UNSUPPORTED", "REQUEST_LIMIT", "BODY_ON_SAFE_METHOD", "RESPONSE_UNAVAILABLE", "PARTIAL_CAPTURE", "UNKNOWN_STRUCTURE", "SANITIZED_VALUE", "UNSUPPORTED_VALUE", "DEPTH_LIMIT", "PROPERTY_LIMIT", "ARRAY_SAMPLE_LIMIT", "SANITIZED_CONTAINER", "BODY_TRUNCATED", "UNSUPPORTED_PROPERTY", "PROFILE_LIMIT", "AUTH_CONTEXT_UNAVAILABLE"]);
export function baselineCaptureSafe(v) {
    if (!v || typeof v !== "object" || Array.isArray(v))
        return false;
    const c = v;
    if (Object.keys(c).some(k => !["contractVersion", "inferenceVersion", "request", "requestFingerprint", "fingerprintScope", "requestBodyEncoding", "requestCoverage", "responseCoverage", "arrayStates", "selfCheck"].includes(k)))
        return false;
    if (c.contractVersion !== CAPTURE_CONTRACT || c.inferenceVersion !== "qagent.structural-inference.v2" || !/^brq_[a-f0-9]{64}$/.test(c.requestFingerprint) || c.fingerprintScope !== "CANONICAL_CAPTURED_REQUEST_DATA")
        return false;
    if (!captureRequestSafe(c.request) || !["NONE", "JSON", "FORM_URLENCODED", "UNSUPPORTED"].includes(c.requestBodyEncoding))
        return false;
    if (!c.requestCoverage || !["COMPLETE", "PARTIAL"].includes(c.requestCoverage.status) || c.requestCoverage.headers !== "AUTH_RUNTIME_AND_CONFIG")
        return false;
    if (Object.keys(c.requestCoverage).some(k => !["status", "reasons", "headers"].includes(k)))
        return false;
    if (!c.responseCoverage || !["COMPLETE", "PARTIAL", "NO_BODY"].includes(c.responseCoverage.status))
        return false;
    if (Object.keys(c.responseCoverage).some(k => !["status", "reasons"].includes(k)))
        return false;
    for (const coverage of [c.requestCoverage, c.responseCoverage])
        if (!Array.isArray(coverage.reasons) || coverage.reasons.length > 24 || coverage.reasons.some(x => !SAFE_REASONS.has(x)))
            return false;
    if (!["PASSED", "PARTIAL", "FAILED", "NO_BODY"].includes(c.selfCheck))
        return false;
    if (!Array.isArray(c.arrayStates) || c.arrayStates.length > 32 || c.arrayStates.some(x => !x || Object.keys(x).some(k => !["path", "state"].includes(k)) || !/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\*\])*$/.test(x.path) || x.path.length > 256 || !["EMPTY", "NON_EMPTY", "MIXED"].includes(x.state)))
        return false;
    if (c.requestCoverage.status === 'COMPLETE' && c.requestCoverage.reasons.length)
        return false;
    if (c.responseCoverage.status === 'COMPLETE' && c.responseCoverage.reasons.length)
        return false;
    return true;
}
