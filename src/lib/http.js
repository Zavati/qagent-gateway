export function corsHeaders(req = null, env = {}, extra = {}) {
  // env.QAGENT_ALLOWED_ORIGINS can be "*" (default) or a comma-separated list of allowed origins.
  const allowed = (env?.QAGENT_ALLOWED_ORIGINS || "*").trim();
  let origin = "*";

  if (allowed !== "*") {
    const reqOrigin = req?.headers?.get?.("origin") || "";
    const allowedList = allowed.split(",").map((value) => value.trim()).filter(Boolean);
    origin = reqOrigin && allowedList.includes(reqOrigin) ? reqOrigin : "null";
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-QAgent-Signature, X-QAgent-Tenant, X-QAgent-Cohort",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    ...extra,
  };
}
