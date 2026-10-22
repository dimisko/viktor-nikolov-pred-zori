/* Game constants, the state object S and its persistence in localStorage. */
import { DOCS } from "./story/docs.js";

/* times are minutes after midnight: 01:00 to 06:00 */
export const START = 60, END = 360, Q_COST = 10, HINT_COST = 15, MAX_HINTS = 3;
const KEY = "predzori-v1";

/* If you change the shape incompatibly, bump v (and the check below) so old saves are discarded. */
export function fresh() {
  return {
    v: 1, phase: "intro", t: START, q: 0, hints: MAX_HINTS, res: 85, mood: "презрив",
    revealed: [], log: [], turns: [], outcome: null,
    unlocked: DOCS.filter(d => d.unlockAt <= START).map(d => d.id), fresh: [], lawyer: false, endAt: null
  };
}
export function load() { try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
export function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* S is replaced on start, resume, restart and rollback via setS(); importers see the new object through the live binding. */
export let S = load();
if (!S || S.v !== 1) S = fresh();
export function setS(v) { S = v; }

/* secret keys revealed by the last suspect reply, highlighted in the sidebar */
export const justRevealed = [];
