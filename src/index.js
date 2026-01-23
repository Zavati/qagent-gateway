// QAgent Gateway (Cloudflare Worker)
// Endpoints:
//  - POST /v1/generate-tests
//  - GET/POST /health
//  - GET /debug/openai-models (diagnóstico)
// Auth:
//  - Authorization: Bearer <licenseToken>
// Proteções:
//  - rate limit por token
//  - limite de payload
//  - logs com PII minimizado


const PROD_HOST = "api.apiqagent.com";

function isProdAllowedHost(request, env) {
  const host = (request.headers.get("host") || "").toLowerCase();

  // Se quiser manter dev/local liberado, controle por env:
  // env.ENVIRONMENT = "production" | "development"
  const isProd = (env.ENVIRONMENT || "production") === "production";

  if (!isProd) return true;
  return host === PROD_HOST;
}

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    ...extra,
  };
}

function getEnvNum(env, key, fallback) {
  const v = env?.[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getBearerToken(req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

// --- Rate limit (memória do Worker) ---
// MVP: em memória. Em produção: Durable Object / KV.
const rateState = new Map(); // key -> { count, resetAt }

function rateLimitOrThrow({ key, windowMs, max }) {
  const now = Date.now();
  const st = rateState.get(key);
  if (!st || now >= st.resetAt) {
    rateState.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (st.count >= max) {
    const err = new Error("Rate limit excedido. Tente novamente em instantes.");
    err.status = 429;
    err.retryAfterMs = Math.max(0, st.resetAt - now);
    throw err;
  }
  st.count += 1;
}

function safeId(value) {
  const s = String(value || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

async function readJsonWithLimit(req, maxBytes) {
  const buf = await req.arrayBuffer();

  if (buf.byteLength === 0) {
    const err = new Error("Body vazio. A extensão não enviou JSON.");
    err.status = 400;
    throw err;
  }

  if (buf.byteLength > maxBytes) {
    const err = new Error(`Payload grande demais (${buf.byteLength} bytes). Limite: ${maxBytes}.`);
    err.status = 413;
    throw err;
  }

  const text = new TextDecoder().decode(buf);

  try {
    return JSON.parse(text);
  } catch {
    console.log("[QAGENT][GW] invalid_json_body_head:", text.slice(0, 300));
    const err = new Error("JSON inválido.");
    err.status = 400;
    throw err;
  }
}

function validateToken(env, token) {
  const raw = (env?.QAGENT_LICENSE_TOKENS || "").trim();
  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!token) {
    const err = new Error("Token ausente. Vá em IA e cole seu license token.");
    err.status = 401;
    throw err;
  }

  if (allowed.length && !allowed.includes(token)) {
    const err = new Error("Token inválido/expirado.");
    err.status = 403;
    throw err;
  }
}

function normalizeCases(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.cases)) return payload;
  if (payload.result && Array.isArray(payload.result.cases)) {
    return { ...payload.result, cases: payload.result.cases };
  }
  return null;
}

// ✅ fetch com timeout + captura REAL de erro (inclusive quando status=0)
async function fetchTextWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: "",
      error: {
        name: e?.name || "Error",
        message: e?.message || String(e),
      },
    };
  } finally {
    clearTimeout(t);
  }
}

// ✅ Diagnóstico: dá pra chamar e ver se o Worker consegue falar com OpenAI e qual status vem.
async function handleDebugOpenAIModels(env) {
  if (!env?.OPENAI_API_KEY) {
    return json({ ok: false, message: "OPENAI_API_KEY ausente no env." }, { status: 500, headers: corsHeaders() });
  }

  const r = await fetchTextWithTimeout(
    "https://api.openai.com/v1/models",
    { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } },
    15000
  );

  return json(
    {
      ok: r.ok,
      status: r.status,
      error: r.error || null,
      bodyHead: (r.text || "").slice(0, 400),
    },
    { status: r.ok ? 200 : 502, headers: corsHeaders() }
  );
}

async function handleGenerateTests(req, env) {
  const token = getBearerToken(req);
  validateToken(env, token);

  const windowMs = getEnvNum(env, "RATE_LIMIT_WINDOW_MS", 60_000);
  const max = getEnvNum(env, "RATE_LIMIT_MAX", 20);
  const maxBytes = getEnvNum(env, "MAX_BODY_BYTES", 25_000);

  rateLimitOrThrow({ key: `t:${safeId(token)}`, windowMs, max });

  const body = await readJsonWithLimit(req, maxBytes);

  const issueKey = body?.jira?.key || body?.source?.issueKey || "";
  const format = (body?.format || "step").toLowerCase();
  const jiraTitle = body?.jira?.title || "";
  const jiraDesc = body?.jira?.description || "";
  const ctx = body?.context || {};

  console.log("[QAGENT][GW] generate-tests", {
    token: safeId(token),
    issue: issueKey ? safeId(issueKey) : "none",
    format,
    hasCurl: !!ctx.curl,
    hasDoc: !!ctx.docLink,
    hasExpected: !!ctx.expected,
  });

  // Stub útil se key não estiver setada
  if (!env?.OPENAI_API_KEY) {
    return json(
      {
        cases: [
          {
            id: "TC-001",
            title: "Gateway funcionando (sem OPENAI_API_KEY)",
            objective: "Validar integração extensão → backend",
            preconditions: ["Extensão carregada", "Worker rodando"],
            steps: [
              { action: "Clicar em gerar casos", data: "payload enviado", expected: "Backend responde corretamente" },
            ],
            tags: ["gateway", "local"],
            priority: "Low",
          },
        ],
        meta: { mode: "stub", issueKey },
      },
      { headers: corsHeaders() }
    );
  }

  // Prompt (reutiliza seu bom prompt)
  const userPrompt = `Você é um especialista em QA. Gere casos de teste para a tarefa do Jira abaixo.

Regras:
- Gere de 5 a 10 casos.
- Cubra: happy path, validações, negativos, bordas, autorização.
- Use o CONTEXTO ADICIONAL (cURL, documentação e esperado) para refinar os casos.
- Saída DEVE ser JSON puro, sem texto extra.
- Schema de saída:
{
  "cases": [
    {
      "id": "string",
      "title": "string",
      "objective": "string",
      "preconditions": ["string"],
      "steps": [{"action":"string","data":"string","expected":"string"}],
      "tags": ["string"],
      "priority": "Low|Medium|High"
    }
  ]
}

Tarefa:
- Key: ${issueKey}
- Title: ${jiraTitle}
- Description: ${jiraDesc}

Formato preferido: ${format === "bdd" ? "BDD (Given/When/Then)" : "Step-by-step"}.

CONTEXTO ADICIONAL (QA):
- cURL:
${(ctx.curl || "").trim() || "(vazio)"}

- Link de documentação:
${(ctx.docLink || "").trim() || "(vazio)"}

- Resultado esperado:
${(ctx.expected || "").trim() || "(vazio)"}`;

  const model = body?.settings?.model || "gpt-4o-mini";

  // ✅ Troca para Responses API (mais atual)
  const openaiUrl = "https://api.openai.com/v1/responses";
  const openaiInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: "Você é um gerador de casos de teste." }] },
        { role: "user", content: [{ type: "input_text", text: userPrompt }] },
      ],
      // força o modelo a responder em JSON (não garante 100%, mas ajuda MUITO)
      text: { format: { type: "json_object" } },
      temperature: 0.2,
    }),
  };

  const timeoutMs = Number(env.OPENAI_TIMEOUT_MS || 90000);

  // retry 1x
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await fetchTextWithTimeout(openaiUrl, openaiInit, timeoutMs);

    if (!last.ok && (last.status === 429 || last.status >= 500 || last.status === 0)) {
      await new Promise((r) => setTimeout(r, 300 + attempt * 700));
      continue;
    }
    break;
  }

  if (!last?.ok) {
    console.log("[QAGENT][GW] openai_error", {
      status: last?.status,
      error: last?.error || null,
      bodyHead: (last?.text || "").slice(0, 400),
    });
    const err = new Error(`Falha ao chamar LLM (HTTP ${last?.status || "?"}).`);
    err.status = 502;
    throw err;
  }

  // Parse do Responses API:
  // a resposta vem em output[].content[].text
  let contentText = "";
  try {
    const obj = JSON.parse(last.text);
    // tenta extrair o texto final
    const out = obj?.output || [];
    const msg = out.find((x) => x.type === "message") || out[0];
    const c = msg?.content || [];
    const t = c.find((x) => x.type === "output_text")?.text
      || c.find((x) => x.type === "text")?.text
      || "";
    contentText = t;
  } catch {
    // se não for JSON, já é erro
    const err = new Error("OpenAI retornou resposta não-JSON (Responses API).");
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(contentText);
  } catch {
    console.log("[QAGENT][GW] openai_non_json_output_head:", (contentText || "").slice(0, 400));
    const err = new Error("Resposta da LLM não veio em JSON válido.");
    err.status = 502;
    throw err;
  }

  const normalized = normalizeCases(parsed);
  if (!normalized) {
    const err = new Error("Resposta inválida do servidor (cases ausente).");
    err.status = 502;
    throw err;
  }

  return json(normalized, { headers: corsHeaders() });
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      // 🔒 Bloqueia hosts não autorizados em produção (inclui *.workers.dev)
      if (!isProdAllowedHost(req, env)) {
        return json({ ok: false, message: "Forbidden" }, { status: 403, headers: corsHeaders() });
      }

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // health: aceita GET ou POST
      if (url.pathname === "/health") {
        return json({ ok: true }, { status: 200, headers: corsHeaders() });
      }

      // debug: só GET
      if (url.pathname === "/debug/openai-models" && req.method === "GET") {
        return await handleDebugOpenAIModels(env);
      }

      if (url.pathname === "/v1/generate-tests" && req.method === "POST") {
        return await handleGenerateTests(req, env);
      }
      // Página de Política de Privacidade
      if (url.pathname === "/privacy-policy") {
        return new Response(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Política de Privacidade — QAgent</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      line-height: 1.6;
      padding: 0 20px;
      color: #111;
    }
    h1, h2 {
      margin-top: 32px;
    }
  </style>
</head>
<body>

<h1>Política de Privacidade — QAgent</h1>

<p>Última atualização: Janeiro de 2026</p>

<h2>1. Informações coletadas</h2>
<p>
A extensão QAgent não coleta, armazena ou compartilha informações pessoais identificáveis.
</p>

<h2>2. Dados processados</h2>
<p>
A extensão processa apenas informações fornecidas diretamente pelo usuário,
como texto de tarefas do Jira, descrições técnicas e contexto informado manualmente,
exclusivamente com o objetivo de gerar casos de teste.
</p>

<h2>3. Processamento externo</h2>
<p>
Para gerar os resultados, os dados enviados pelo usuário podem ser processados
por serviços de inteligência artificial através da API do QAgent.
Nenhum dado é utilizado para treinamento de modelos.
</p>

<h2>4. Armazenamento</h2>
<p>
Os dados são armazenados apenas localmente no navegador do usuário.
O QAgent não mantém banco de dados de conteúdo de tarefas, testes ou documentos.
</p>

<h2>5. Compartilhamento</h2>
<p>
Nenhuma informação pessoal é vendida, compartilhada ou utilizada para fins publicitários.
</p>

<h2>6. Segurança</h2>
<p>
Toda comunicação ocorre via HTTPS e utiliza mecanismos de autenticação por token.
</p>

<h2>7. Alterações</h2>
<p>
Esta política pode ser atualizada futuramente. Alterações relevantes serão refletidas nesta página.
</p>

<h2>8. Contato</h2>
<p>
Em caso de dúvidas, entre em contato pelo e-mail:
<strong>contato@apiqagent.com</strong>
</p>

</body>
</html>
`, {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }



      return json({ status: "not_found", message: "Endpoint inexistente." }, { status: 404, headers: corsHeaders() });
    } catch (e) {
      const status = e?.status || 500;
      const headers = corsHeaders(
        status === 429 && e.retryAfterMs ? { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)) } : {}
      );
      return json({ status: "error", message: e?.message || String(e) }, { status, headers });
    }
  },
};
