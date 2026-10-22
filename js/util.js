/* Small shared helpers. */
export const $ = id => document.getElementById(id);
export const pad = n => String(n).padStart(2, "0");
/* minutes after midnight -> "HH:MM" */
export function fmt(t) { return pad(Math.floor(t / 60)) + ":" + pad(t % 60); }
export function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
/* escaped text with [stage directions] in <em class="stage"> and line breaks */
export function rich(s) { return esc(s).replace(/\[([^\]]+)\]/g, '<em class="stage">[$1]</em>').replace(/\n+/g, "<br>"); }
