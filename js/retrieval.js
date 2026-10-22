/* Simple keyword retrieval over the unlocked dossier: the top 2 docs by number of kw stems found in the question. */
import { S } from "./state.js";
import { DOCS } from "./story/docs.js";

export function retrieve(q, excludeId) {
  const s = q.toLowerCase();
  return DOCS.filter(d => S.unlocked.includes(d.id) && d.id !== excludeId)
    .map(d => ({ d, score: d.kw.reduce((n, k) => n + (s.includes(k) ? 1 : 0), 0) }))
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2).map(x => x.d);
}
