# CLAUDE.md

Guidance for Claude Code sessions working on this repository.

## What this is

**Pred Zori** ("Before Dawn") is a single-page interactive interrogation game. The gameplay is in **Macedonian**. The player is Inspector Viktor Nikolov (Skopje, Department for Blood Crimes) and has from 01:00 to 06:00 of in-game time to get suspect Goran Trajkovski ("Shilo") to reveal where the missing girl Sara is. An LLM plays the suspect and the player's superior, Vladimir Ilievski (who gives hints).

- No build step and no framework: plain HTML/CSS/JS in `index.html`.
- An optional Cloudflare Worker (`worker/`) proxies requests to an OpenAI-compatible LLM API so the key never reaches the browser.
- It is hosted on GitHub Pages. The folder is **not** a git repo yet locally.
- License: MIT.

## Layout

```
index.html              the whole game (~776 lines): CSS (lines ~11-170), markup (~173-263), JS IIFE (~265-773)
config.js               window.PREDZORI_CONFIG = { apiUrl: "" }, the Worker URL for non-claude.ai hosting
worker/src/index.js     Cloudflare Worker: CORS allowlist, validation, forwards to {BASE_URL}/chat/completions
worker/wrangler.toml    BASE_URL (default Gemini OpenAI-compat), MODEL, MAX_TOKENS, ALLOWED_ORIGINS
worker/.dev.vars.example  API_KEY for local `wrangler dev` (real .dev.vars is gitignored)
README.md               player and deployer docs
```

## Run / deploy

- Game locally: `python -m http.server 8000` from the repo root, then open http://localhost:8000. With `apiUrl` empty and not inside claude.ai, the AI shows as unavailable (expected).
- Worker locally: `cd worker && npm install && npm run dev` (serves on :8787), then set `apiUrl: "http://localhost:8787"` in `config.js`. Needs `worker/.dev.vars` with `API_KEY=...`.
- Worker deploy: `npx wrangler secret put API_KEY`, then `npm run deploy`.
- There are no tests or linters. Verify changes by playing in a browser.

## Architecture of the game script (`index.html`)

Everything lives in one `"use strict"` IIFE. Main pieces, top to bottom:

1. **Constants.** `START=60`, `END=360` (minutes after midnight, so 01:00 to 06:00), `Q_COST=10`, `HINT_COST=15`, `MAX_HINTS=3`, and localStorage key `KEY="predzori-v1"`.
2. **`SECRETS`.** Five ordered truths, each `{k, q, a}`: `presence`, `killer`, `boss`, `deadline`, `location`. The sidebar shows `q` until the secret is revealed, then `a`. Revealing `location` wins the game.
3. **`DOCS`.** The case file and knowledge base. Each doc is `{id, code, title, text, kw[], unlockAt, arrive?}`. `kw` holds lowercase Macedonian keyword stems for retrieval. `unlockAt` is in minutes after midnight: `d6` (phone records) unlocks at 150 (02:30) and `d7` (forensics) at 210 (03:30), and those use `arrive` as the log message.
4. **`RULES`.** The suspect's system prompt, written in English and telling the model to reply in Macedonian. It contains the character, the full hidden truth, how resistance moves, the reveal conditions for each secret, and a **strict output format**: the in-character reply, then `###`, then a JSON line `{"resistance", "revealed", "lawyer", "mood"}`.
5. **`ilievskiInput()`.** Builds the mentor's hint prompt from the current state, the unlocked docs and the last 10 transcript lines. It must never spoil the location or the deadline.
6. **State `S`.** Built by `fresh(tier)` and saved whole to localStorage by `save()`. Fields: `v, phase ("intro"|"play"|"end"), t, q, hints, res, mood, revealed[], log[], turns[], outcome, tier, unlocked[], fresh[], lawyer, endAt`.
   - `log` holds display entries, `{w, text, doc?, k?}`, where `w` is one of `n` narration, `v` Viktor, `s` suspect, `i` Ilievski, `x` secret-revealed stamp.
   - `turns` holds the raw LLM conversation history (assistant turns keep the `###` JSON line).
   - If you change the shape of the state in an incompatible way, bump `v` (and the check `S.v !== 1`) so old saves are discarded.
7. **AI layer.** `initAI()` picks a mode:
   - `aiMode="claude"` when running inside a claude.ai artifact, using `window.claude.use("sample")` and the player's own Claude account. `S.tier` (`quick`/`default`) becomes `modelTier`, and responses stream through `onText`.
   - `aiMode="proxy"` when `CONFIG.apiUrl` is set. It POSTs `{messages}` to the Worker, which returns `{text}` or `{error}`. There is no streaming, so `onText` is called once. The first turn is sent as `system` if its content is `RULES`.
   - **`askAI(input, opts)` is the only function that talks to an AI.** `errCopy()` maps error codes to Macedonian messages for the player.
8. **Retrieval (RAG).** `retrieve(q, excludeId)` scores the unlocked docs by how many `kw` stems appear in the question and returns the top 2. `buildSuspectInput()` puts together RULES, the last 24 `turns`, and a `[STATE]` block with the retrieved excerpts and any shown document.
9. **Parsing.** `splitRaw()` splits the reply from the meta JSON. `streamPart()` hides the `###`/JSON while streaming. `applyMeta()` clamps resistance changes to between -25 and +30 per turn, accepts `location` only if the reply mentions the boiler room, the basement or the building (regex stems in the code), and also has a regex fallback that detects the location even when the model forgets to flag it.
10. **Flow.** `send()` and `hint()` snapshot `S` first and **roll back** on error, so a failed call costs the player no time. `checkUnlocks()` and `checkEnd()` run after each successful turn. The game ends on a win (`location`), `lawyer`, or time (`t >= END`).
11. **Rendering.** `render()` dispatches to `renderIntro`, `renderStatus`, `renderLog`, `renderEnd` and `renderAi`. The dossier bottom sheet uses `renderDocs`, `openSheet` and `closeSheet`. The "show evidence" button sets `pendingDoc` via `setPending()`.

## Worker (`worker/src/index.js`)

- Allows only POST and OPTIONS. Checks the origin against `ALLOWED_ORIGINS` (comma list, `*` allowed).
- Limits: body up to 120 KB, up to 40 messages, each message cut to 30k characters. Roles are cleaned to system/user/assistant.
- Calls `${BASE_URL}/chat/completions` with `temperature: 0.8` and `max_tokens: MAX_TOKENS`, via `complete()`. If `MODEL` returns 429 or 5xx (Gemini often answers 503 "high demand"), it retries once with `FALLBACK_MODEL`.
- Deployed at `https://pred-zori-api.pred-zori-api.workers.dev` (set in `config.js`). `MODEL = gemini-3.8-flash`, `FALLBACK_MODEL = gemini-3.5-flash-lite`, `ALLOWED_ORIGINS` = `https://dimisko.github.io` plus localhost:8000. Gemini retires old models for new keys, so if calls start returning 404, list the available models and update `MODEL`.
- Error codes (`rate_limited`, `upstream_error`, `empty_completion`, `prompt_too_large`, `forbidden_origin`, `bad_request`, `server_not_configured`) must stay in sync with `errCopy()` in `index.html`.
- History is capped at 24 turns plus RULES, which keeps requests under `MAX_MESSAGES = 40`. Keep that true if you change either limit.

## Conventions and gotchas

- **Language split:** only player-facing game text (UI strings, dossier documents, narration, endings, error messages) is in Macedonian. Everything else in the repo is in English: code, comments, prompts to the model, README.md and this file.
- Game text must be standard Macedonian Cyrillic with correct orthography, including the Macedonian-specific letters (gj, kj, dz, j, lj, nj, dzh). No Serbian, Bulgarian or Russian forms.
- Code style is compact: short helper names (`$`, `esc`, `rich`, `fmt`, `pad`), dense one-line functions, double quotes, semicolons. Keep to it.
- Always escape model or user text with `esc()`/`rich()` before putting it in `innerHTML`. `rich()` turns `[stage directions]` into `<em class="stage">`.
- Theming uses CSS custom properties on `:root`, with dark overrides under both `@media (prefers-color-scheme: dark)` (guarded with `:not([data-theme="light"])`) and `:root[data-theme="dark"]`. Add new colors as tokens in all three places.
- The page must keep working both as a claude.ai artifact and as a static GitHub Pages site. Inside a claude.ai artifact, `confirm()` returns false, so **the "Start over" button in the dossier sheet (`restartBtn`) does nothing there**. Replace it with an in-page confirmation if you touch that button.
- The tier radio box is hidden in proxy mode, where the model is fixed by the Worker's `MODEL`.
- **Story consistency:** the facts in `DOCS`, `RULES`, `ilievskiInput()`, the intro brief (markup around line 182) and the endings in `renderEnd()` all describe the same case. When you change a name, time, place or clue, update all of them.
- **Adding a secret:** add it to `SECRETS`, add its reveal condition and its key to the `revealed` list in the RULES output format, and add any advice about it to `ilievskiInput()`.
- **Adding a document:** give it a unique `id`/`code` and good `kw` stems (lowercase and stemmed, since matching is a substring `includes`). If it arrives later, set `unlockAt` and `arrive`, and mention it in the Ilievski hints if it matters.
