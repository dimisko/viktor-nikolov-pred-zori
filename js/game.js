/* Game flow: starting, asking the suspect, calling Ilievski, unlocking documents and ending.
   send() and hint() snapshot S first and roll back on error, so a failed call costs the player no time. */
import { S, setS, fresh, save, END, Q_COST, HINT_COST } from "./state.js";
import { DOCS } from "./story/docs.js";
import { OPENING_NARRATION, OPENING_LINE, OPENING_TURN } from "./story/scenes.js";
import { buildSuspectInput, ilievskiInput } from "./story/prompts.js";
import { askAI, aiReady, errCopy } from "./ai.js";
import { splitRaw, streamPart, applyMeta } from "./parse.js";
import { busy, pendingDoc, render, renderLog, renderStatus, addLive, setBusy, setPending, autosize, toast } from "./ui.js";
import { $, fmt } from "./util.js";

export function startGame() {
  setS(fresh());
  S.phase = "play";
  S.log.push({ w: "n", text: OPENING_NARRATION });
  S.log.push({ w: "s", text: OPENING_LINE });
  S.turns.push({ role: "assistant", content: OPENING_TURN });
  save(); render();
}

export function restart() { setS(fresh()); save(); render(); }

function checkUnlocks() {
  for (const d of DOCS) {
    if (!S.unlocked.includes(d.id) && d.unlockAt <= S.t) {
      S.unlocked.push(d.id); S.fresh.push(d.id);
      S.log.push({ w: "n", text: fmt(d.unlockAt) + ". " + d.arrive });
    }
  }
}

function checkEnd() {
  if (S.revealed.includes("location")) S.outcome = "win";
  else if (S.lawyer) S.outcome = "lawyer";
  else if (S.t >= END) S.outcome = "time";
  if (S.outcome) S.endAt = Math.min(S.t, END);
}

/* the game stays on the transcript after an outcome so the last reply can be read; this moves to the end screen */
export function finish() { if (!S.outcome) return; S.phase = "end"; save(); render(); }

export async function send() {
  if (busy || S.phase !== "play" || S.outcome) return;
  const text = $("input").value.trim();
  const doc = pendingDoc ? DOCS.find(d => d.id === pendingDoc) : null;
  if (!text && !doc) { $("input").focus(); return; }
  if (!aiReady) { toast(errCopy({ code: "unavailable" })); return; }

  const snapshot = JSON.stringify(S);
  const shownLine = doc ? `[Му го покажувам документот ${doc.code}: ${doc.title}]` : "";
  const viktorText = [shownLine, text].filter(Boolean).join(" ");
  const viktorLine = "НИКОЛОВ: " + viktorText;

  S.log.push({ w: "v", text: text || "…", doc: doc ? doc.id : null });
  S.q++; S.t += Q_COST;
  const input = buildSuspectInput(viktorLine, text, doc);
  $("input").value = ""; autosize(); setPending(null);
  renderLog(); renderStatus();
  const live = addLive("s", "Трајковски", "[Трајковски молчи]");
  setBusy(true);
  try {
    const raw = await askAI(input, { onText: ({ text }) => live.set(streamPart(text)) });
    const { reply, meta } = splitRaw(raw);
    if (!reply) throw { code: "empty_completion" };
    S.turns.push({ role: "user", content: viktorLine }, { role: "assistant", content: raw.trim() });
    S.log.push({ w: "s", text: reply });
    applyMeta(meta, reply);
    checkUnlocks(); checkEnd(); save(); render();
  } catch (e) {
    setS(JSON.parse(snapshot));
    $("input").value = text; autosize(); if (doc) setPending(doc.id);
    const m = errCopy(e); if (m) toast(m);
    render();
  } finally { setBusy(false); }
}

export async function hint() {
  if (busy || S.phase !== "play" || S.outcome || S.hints <= 0) return;
  if (!aiReady) { toast(errCopy({ code: "unavailable" })); return; }
  const snapshot = JSON.stringify(S);
  const input = ilievskiInput();
  S.hints--; S.t += HINT_COST;
  renderStatus();
  const live = addLive("i", "Илиевски, на телефон", "Ѕвони");
  setBusy(true);
  try {
    const text = (await askAI(input, { onText: ({ text }) => live.set(text) })).trim();
    S.log.push({ w: "i", text });
    checkUnlocks(); checkEnd(); save(); render();
  } catch (e) {
    setS(JSON.parse(snapshot));
    const m = errCopy(e); if (m) toast(m);
    render();
  } finally { setBusy(false); }
}
