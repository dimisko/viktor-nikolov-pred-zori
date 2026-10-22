/* The AI layer. askAI() is the only function that talks to an AI: it POSTs to the Worker proxy set in config.js. */
const CONFIG = window.PREDZORI_CONFIG || {};
export const aiReady = !!CONFIG.apiUrl;

/* input: a string, or [{role, content}] messages. opts.onText({text, delta}) is called as text streams in. */
export async function askAI(input, opts = {}) {
  if (!aiReady) throw { code: "unavailable" };
  const messages = typeof input === "string" ? [{ role: "user", content: input }] : input;
  /* give up if no data arrives for a while: 50 s for the first byte (Worker main + fallback), 30 s between chunks */
  const ctl = new AbortController(); let timer;
  const arm = ms => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), ms); };
  if (opts.signal) opts.signal.addEventListener("abort", () => ctl.abort());
  arm(50000);
  try {
    const res = await fetch(CONFIG.apiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, stream: true }), signal: ctl.signal });
    if (/ndjson/.test(res.headers.get("Content-Type") || "")) return await readStream(res, opts.onText, () => arm(30000));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw { code: res.status === 429 ? "rate_limited" : (data.error || "upstream_error") };
    const text = String(data.text || "").trim();
    if (!text) throw { code: "empty_completion" };
    if (opts.onText) opts.onText({ text, delta: text });
    return text;
  } catch (e) { throw e && e.code ? e : { code: "upstream_error" }; }
  finally { clearTimeout(timer); }
}

/* reads the Worker's NDJSON stream: {"t": delta} lines, or {"error": code} */
async function readStream(res, onText, tick) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    tick(); buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!l) continue;
      const m = JSON.parse(l);
      if (m.error) throw { code: m.error };
      if (m.t) { text += m.t; if (onText) onText({ text, delta: m.t }); }
    }
  }
  text = text.trim();
  if (!text) throw { code: "empty_completion" };
  return text;
}

/* Error codes from askAI() and the Worker -> Macedonian message for the player. Keep in sync with worker/src/index.js. */
export function errCopy(e) {
  switch (e && e.code) {
    case "unavailable": return "Вештачката интелигенција не е достапна. Провери го apiUrl во config.js.";
    case "rate_limited": return "Премногу барања или е потрошен бесплатниот лимит. Почекај малку, па обиди се пак. Времето не ти е потрошено.";
    case "prompt_too_large": return "Записникот стана предолг. Започни нов распит.";
    default: return "Врската се прекина. Обиди се повторно, времето не ти е потрошено.";
  }
}
