/* Entry point: wires the DOM events and renders the first screen. */
import { setS, load } from "./state.js";
import { startGame, restart, send, hint } from "./game.js";
import { render, setPending, openSheet, closeSheet, autosize } from "./ui.js";
import { initPWA, hideInstall } from "./pwa.js";
import { $ } from "./util.js";

$("startBtn").addEventListener("click", startGame);
$("resumeBtn").addEventListener("click", () => { const s = load(); if (s) { setS(s); render(); } });
$("againBtn").addEventListener("click", restart);
$("sendBtn").addEventListener("click", send);
$("input").addEventListener("input", autosize);
$("input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$("hintBtn").addEventListener("click", hint);
$("dossierBtn").addEventListener("click", openSheet);
$("showBtn").addEventListener("click", openSheet);
$("pendingX").addEventListener("click", () => setPending(null));
$("sheet").addEventListener("click", e => {
  if (e.target.closest("[data-close]")) { closeSheet(); return; }
  const b = e.target.closest("[data-show]");
  if (b) { setPending(b.dataset.show); closeSheet(); $("input").focus(); }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("install").hidden) hideInstall(true); else if (!$("sheet").hidden) closeSheet();
});
$("restartBtn").addEventListener("click", () => {
  if (!confirm("Сигурно? Тековниот распит ќе се избрише.")) return;
  closeSheet(); restart();
});

initPWA();
render();
