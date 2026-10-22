/* Parsing the suspect's reply: "<reply>\n###\n{meta JSON}" (see the OUTPUT FORMAT in RULES). */
import { S, justRevealed } from "./state.js";
import { SECRETS } from "./story/secrets.js";

export function splitRaw(raw) {
  let i = raw.indexOf("###");
  if (i < 0) i = raw.indexOf('{"resistance"');
  if (i < 0) return { reply: raw.trim(), meta: null };
  const reply = raw.slice(0, i).trim();
  const rest = raw.slice(i);
  const a = rest.indexOf("{"), b = rest.lastIndexOf("}");
  let meta = null;
  if (a >= 0 && b > a) { try { meta = JSON.parse(rest.slice(a, b + 1)); } catch (e) { meta = null; } }
  return { reply, meta };
}

/* the visible part of a reply that is still streaming: hides the ### and a partial JSON line */
export function streamPart(text) {
  const i = text.indexOf("###");
  let r = i >= 0 ? text.slice(0, i) : text;
  r = r.replace(/#{1,2}\s*$/, "").replace(/\{"resistance[\s\S]*$/, "");
  return r.trim();
}

/* Applies the meta JSON to S: resistance change clamped to -25..+30 per turn, mood, lawyer, newly revealed secrets.
   "location" is accepted only if the reply names the place, and is detected even when the model forgets to flag it. */
export function applyMeta(meta, reply) {
  justRevealed.length = 0;
  if (meta) {
    let r = parseInt(meta.resistance, 10);
    if (!isNaN(r)) {
      r = Math.max(0, Math.min(100, r));
      const d = r - S.res;
      S.res = Math.max(0, Math.min(100, S.res + Math.max(-25, Math.min(30, d))));
    }
    if (meta.mood) S.mood = String(meta.mood).slice(0, 24);
    if (meta.lawyer === true) S.lawyer = true;
    const list = Array.isArray(meta.revealed) ? meta.revealed : [];
    for (const k of list) {
      if (!SECRETS.some(s => s.k === k) || S.revealed.includes(k)) continue;
      if (k === "location" && !/котлар|подрум|резиденц/iu.test(reply)) continue;
      S.revealed.push(k); justRevealed.push(k);
    }
  }
  if (!S.revealed.includes("location") && /котлар/iu.test(reply) && /кисела|резиденц/iu.test(reply)) {
    S.revealed.push("location"); justRevealed.push("location");
  }
  for (const k of justRevealed) S.log.push({ w: "x", k });
}
