/* Rendering: screens, status bar, transcript, dossier sheet, toasts. Reads S, never talks to the AI. */
import { S, END, MAX_HINTS, load, save, justRevealed } from "./state.js";
import { DOCS } from "./story/docs.js";
import { SECRETS } from "./story/secrets.js";
import { ending } from "./story/scenes.js";
import { aiReady } from "./ai.js";
import { $, pad, fmt, esc, rich } from "./util.js";

/* busy: a request is in flight. pendingDoc: id of the document Viktor will show with his next question. */
export let busy = false, pendingDoc = null;

function show(id) { for (const s of document.querySelectorAll(".screen")) s.classList.toggle("on", s.id === id); }

export function render() {
  if (S.phase === "play") { show("game"); renderStatus(); renderLog(); }
  else if (S.phase === "end") { show("end"); renderEnd(); }
  else { show("intro"); renderIntro(); }
  renderAi();
}

function renderIntro() {
  const saved = load();
  $("resumeBtn").hidden = !(saved && saved.phase === "play");
  $("startBtn").textContent = $("resumeBtn").hidden ? "Влези во собата за распит" : "Започни нов распит";
}

function renderAi() {
  $("aiStatus").textContent = aiReady ? "Осомничениот и Илиевски ги игра вештачка интелигенција." : "Вештачката интелигенција не е поставена. Додај apiUrl во config.js.";
  const b = $("blocked");
  b.hidden = !(S.phase === "play" && !aiReady);
  if (!b.hidden) b.textContent = "Вештачката интелигенција не е достапна, па Трајковски не може да одговара. Провери го config.js.";
}

export function renderStatus() {
  $("clock").textContent = fmt(Math.min(S.t, END));
  const left = Math.max(0, END - S.t);
  $("left").textContent = "до 06:00: " + Math.floor(left / 60) + ":" + pad(left % 60);
  $("hintsLeft").textContent = S.hints;
  $("hintBtn").disabled = busy || S.hints <= 0 || !!S.outcome;
  $("composerRow").hidden = !!S.outcome;
  $("finishBtn").hidden = !S.outcome;
  $("hintBtn").setAttribute("aria-label", "Јави се на Илиевски, преостанати повици: " + S.hints);
  $("resVal").textContent = S.res;
  $("meterFill").style.width = S.res + "%";
  $("meter").setAttribute("aria-valuenow", S.res);
  $("mood").textContent = S.mood;
  $("newBadge").hidden = !S.fresh.length;
  $("secrets").innerHTML = SECRETS.map(s => {
    const done = S.revealed.includes(s.k);
    return `<li class="${done ? "done" : ""}${justRevealed.includes(s.k) ? " just" : ""}">${esc(done ? s.a : s.q)}</li>`;
  }).join("");
}

function entryHTML(e) {
  if (e.w === "n") return `<p class="e n">${esc(e.text)}</p>`;
  if (e.w === "x") { const s = SECRETS.find(x => x.k === e.k); return `<p class="e x"><span class="stampmini">Потврдено</span><span>${esc(s.a)}</span></p>`; }
  if (e.w === "v") {
    const d = e.doc ? DOCS.find(x => x.id === e.doc) : null;
    return `<div class="e v"><span class="spk">Николов</span>${d ? `<span class="shown">Покажан доказ: ${esc(d.code)}, ${esc(d.title)}</span>` : ""}${e.text && e.text !== "…" ? `<div class="txt">${esc(e.text)}</div>` : ""}</div>`;
  }
  if (e.w === "s") return `<div class="e s"><span class="spk">Трајковски</span><div class="txt">${rich(e.text)}</div></div>`;
  if (e.w === "i") return `<div class="e i"><span class="spk">Илиевски, на телефон</span><div class="txt">${rich(e.text)}</div></div>`;
  return "";
}

export function renderLog() {
  const head = `<div class="log-head"><h2>Записник од распит, предмет 1147/26</h2><p>Осомничен: Горан Трајковски. Распитува: инспектор Виктор Николов.</p></div>`;
  $("log").innerHTML = head + S.log.map(entryHTML).join("");
  scrollDown();
}
function scrollDown() { const l = $("log"); l.scrollTop = l.scrollHeight; }

/* a transcript entry that fills in while the reply streams; returns { set(text) } */
export function addLive(kind, speaker, waiting) {
  const el = document.createElement("div");
  el.className = "e " + kind;
  el.innerHTML = `<span class="spk">${esc(speaker)}</span><div class="txt"><span class="stage dots">${esc(waiting)}</span></div>`;
  $("log").appendChild(el); scrollDown();
  const txt = el.querySelector(".txt");
  return { set(t) { if (t) { txt.innerHTML = rich(t); scrollDown(); } } };
}

export function setBusy(b) {
  busy = b;
  $("sendBtn").disabled = b; $("showBtn").disabled = b;
  $("hintBtn").disabled = b || S.hints <= 0 || !!S.outcome;
  $("sendBtn").textContent = b ? "…" : "Прашај";
}

export function setPending(id) {
  pendingDoc = id;
  const d = id ? DOCS.find(x => x.id === id) : null;
  $("pending").hidden = !d;
  if (d) $("pendingText").textContent = "Ќе му покажеш: " + d.code + ", " + d.title;
}

function renderDocs() {
  const inGame = S.phase === "play";
  $("docList").innerHTML = DOCS.map(d => {
    if (!S.unlocked.includes(d.id)) return `<div class="locked">${esc(d.code)} ${esc(d.title)}: се очекува околу ${fmt(d.unlockAt)}</div>`;
    const isNew = S.fresh.includes(d.id);
    return `<details${isNew ? " open" : ""}><summary><span class="code">${esc(d.code)}</span>${esc(d.title)}${isNew ? '<span class="fresh">ново</span>' : ""}</summary>
      <p class="doc-text">${esc(d.text)}</p>
      ${inGame ? `<button class="outline" data-show="${d.id}">Покажи му го</button>` : ""}</details>`;
  }).join("");
}
export function openSheet() { renderDocs(); $("sheet").hidden = false; S.fresh = []; save(); renderStatus(); $("sheet").querySelector(".sheet-head button").focus(); }
export function closeSheet() { $("sheet").hidden = true; }

function renderEnd() {
  const at = S.endAt || S.t;
  const { stamp, title, body, rank } = ending(S.outcome, at, S.hints);
  $("endStamp").textContent = stamp;
  $("endTitle").textContent = title;
  $("endText").innerHTML = body.split("\n\n").map(p => `<p>${esc(p)}</p>`).join("");
  $("stats").innerHTML = `<dt>Крај на распитот</dt><dd>${fmt(Math.min(at, END))}</dd>
    <dt>Поставени прашања</dt><dd>${S.q}</dd>
    <dt>Повици до Илиевски</dt><dd>${MAX_HINTS - S.hints}</dd>
    <dt>Откриени тајни</dt><dd>${S.revealed.length} од ${SECRETS.length}</dd>`;
  $("rank").textContent = rank;
}

export function autosize() { const t = $("input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 132) + "px"; }

let toastTimer;
export function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5200);
}
