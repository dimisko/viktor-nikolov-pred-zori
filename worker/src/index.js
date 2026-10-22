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

    const stream = body.stream === true;
    const mainMs = Number(env.TIMEOUT_MS || 15000);
    let upstream = await complete(env, env.MODEL, clean, stream, mainMs);
    // Busy, rate-limited or too slow main model: retry once with the fallback model, if one is set.
    if (env.FALLBACK_MODEL && (!upstream || upstream.res.status === 429 || upstream.res.status >= 500)) {
      upstream = await complete(env, env.FALLBACK_MODEL, clean, stream, Number(env.FALLBACK_TIMEOUT_MS || 25000));
    }
    if (!upstream) return reply({ error: "upstream_error" }, 502, cors);

    const { res, ctl } = upstream;
    if (!res.ok) {
      const limited = res.status === 429;
      return reply({ error: limited ? "rate_limited" : "upstream_error" }, limited ? 429 : 502, cors);
    }
    if (stream) return streamReply(res, ctl, Number(env.IDLE_TIMEOUT_MS || 20000), cors);

    const data = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text.trim()) return reply({ error: "empty_completion" }, 502, cors);
    return reply({ text }, 200, cors);
  },
};

// Resolves to { res, ctl } once response headers arrive, or null on network error / timeout.
// ctl stays usable so a stalled stream can be aborted later.
async function complete(env, model, messages, stream, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${env.BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.API_KEY}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.8,
        max_tokens: Number(env.MAX_TOKENS || 4000),
        ...(stream ? { stream: true } : {}),
        ...(env.REASONING_EFFORT ? { reasoning_effort: env.REASONING_EFFORT } : {}),
      }),
      signal: ctl.signal,
    });
    return { res, ctl };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Turns the provider's SSE stream into NDJSON lines for the game: {"t": "..."} per text delta,
// and a final {"error": code} if the stream fails, stalls for idleMs, or yields no text.
function streamReply(res, ctl, idleMs, cors) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const line = (o) => w.write(enc.encode(JSON.stringify(o) + "\n"));
  (async () => {
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), idleMs); };
    let buf = "", got = false;
    try {
      arm();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm();
        buf += value;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const l = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!l.startsWith("data:")) continue;
          const d = l.slice(5).trim();
          if (d === "[DONE]") continue;
          let j;
          try { j = JSON.parse(d); } catch { continue; }
          const t = j?.choices?.[0]?.delta?.content;
          if (t) { got = true; await line({ t }); }
        }
      }
      if (!got) await line({ error: "empty_completion" });
    } catch {
      await line({ error: "upstream_error" }).catch(() => {});
    } finally {
      clearTimeout(timer);
      await w.close().catch(() => {});
    }
  })();
  return new Response(readable, {
    status: 200,
    headers: { ...cors, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
