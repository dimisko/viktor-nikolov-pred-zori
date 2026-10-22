/* Install as an app: registers sw.js and shows the #install popup (never inside a frame). */
import { $ } from "./util.js";
import { toast } from "./ui.js";

const LATER_KEY = "predzori-install-later";
let installEvt = null;

export function initPWA() {
  $("installGo").addEventListener("click", async () => {
    const e = installEvt; installEvt = null;
    if (!e) { hideInstall(false); return; }
    e.prompt();
    const c = await e.userChoice.catch(() => ({}));
    hideInstall(c.outcome !== "accepted");
  });
  $("installLater").addEventListener("click", () => hideInstall(true));
  $("install").addEventListener("click", e => { if (e.target.closest("[data-later]")) hideInstall(true); });
  window.addEventListener("appinstalled", () => { hideInstall(false); toast("Играта е инсталирана. Најди ја на почетниот екран."); });

  let framed = true; try { framed = window.top !== window.self; } catch (e) {}
  if (framed || location.protocol === "file:" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) return;
  let later = 0; try { later = +localStorage.getItem(LATER_KEY) || 0; } catch (e) {}
  if (Date.now() - later < 7 * 864e5) return;
  // Chromium fires beforeinstallprompt only when the app is not installed yet; iOS has no prompt API, so show steps.
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; setTimeout(() => showInstall(false), 1200); });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) setTimeout(() => showInstall(true), 1200);
}

function showInstall(ios) {
  if (!$("install").hidden) return;
  $("installSteps").hidden = !ios; $("installGo").hidden = ios;
  $("installLater").textContent = ios ? "Разбрав" : "Не сега";
  $("install").hidden = false; $(ios ? "installLater" : "installGo").focus();
}

/* remember: "not now", don't show again for 7 days */
export function hideInstall(remember) {
  $("install").hidden = true;
  if (remember) try { localStorage.setItem(LATER_KEY, String(Date.now())); } catch (e) {}
}
