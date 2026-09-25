// Pred Zori API proxy.
// Keeps the AI provider's API key secret and forwards chat requests to any
// OpenAI-compatible endpoint (Google Gemini, Groq, OpenRouter, ...).
// Configure BASE_URL, MODEL and ALLOWED_ORIGINS in wrangler.toml,
// and set the key with:  npx wrangler secret put API_KEY

const MAX_BODY_BYTES = 120_000;
const MAX_MESSAGES = 40;
const ROLES = new Set(["system", "user", "assistant"]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
    const anyOrigin = allowed.includes("*");
    const originOk = anyOrigin || allowed.includes(origin);

    const cors = {
      "Access-Control-Allow-Origin": anyOrigin ? "*" : originOk ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405, cors);
    if (!originOk) return reply({ error: "forbidden_origin" }, 403, cors);
    if (!env.API_KEY) return reply({ error: "server_not_configured" }, 500, cors);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return reply({ error: "prompt_too_large" }, 413, cors);

    let body;
    try { body = JSON.parse(raw); } catch { return reply({ error: "bad_json" }, 400, cors); }

    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || messages.length === 0 || messages.length > MAX_MESSAGES) {
      return reply({ error: "bad_request" }, 400, cors);
    }
    const clean = messages.map((m) => ({
      role: ROLES.has(m && m.role) ? m.role : "user",
      content: String((m && m.content) || "").slice(0, 30_000),
    }));

    let upstream = await complete(env, env.MODEL, clean);
    // Busy or rate-limited main model: retry once with the fallback model, if one is set.
    if (env.FALLBACK_MODEL && (!upstream || upstream.status === 429 || upstream.status >= 500)) {
      upstream = await complete(env, env.FALLBACK_MODEL, clean);
    }
    if (!upstream) return reply({ error: "upstream_error" }, 502, cors);

    if (!upstream.ok) {
      const limited = upstream.status === 429;
      return reply({ error: limited ? "rate_limited" : "upstream_error" }, limited ? 429 : 502, cors);
    }

    const data = await upstream.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text.trim()) return reply({ error: "empty_completion" }, 502, cors);
    return reply({ text }, 200, cors);
  },
};

async function complete(env, model, messages) {
  try {
    return await fetch(`${env.BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.API_KEY}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.8,
        max_tokens: Number(env.MAX_TOKENS || 1500),
      }),
    });
  } catch {
    return null;
  }
}

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
