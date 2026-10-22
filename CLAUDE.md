# CLAUDE.md

Guidance for Claude Code sessions working on this repository.

## What this is

**Pred Zori** ("Before Dawn") is a single-page interactive interrogation game. The gameplay is in **Macedonian**. The player is Inspector Viktor Nikolov (Skopje, Department for Blood Crimes) and has from 01:00 to 06:00 of in-game time to get suspect Goran Trajkovski ("Shilo") to reveal where the missing girl Sara is. An LLM plays the suspect and the player's superior, Vladimir Ilievski (who gives hints).

- No build step and no framework: plain HTML, one CSS file and native ES modules (`<script type="module">`), served as static files.
- A Cloudflare Worker (`worker/`) proxies requests to an OpenAI-compatible LLM API so the key never reaches the browser. The game only talks to the AI through it.
- Hosted on Vercel (`https://viktor-nikolov-pred-zori.vercel.app`), which deploys on push to `master`.
- License: MIT.

## Layout

```
index.html              markup only: head/meta tags, the intro, game and end screens, dossier sheet, install popup
css/style.css           all styles and theme tokens
js/main.js              entry point: wires DOM events, initPWA(), first render()
js/state.js             constants, state S (+ setS), fresh(), load()/save(), justRevealed
js/game.js              flow: startGame, restart, send, hint, checkUnlocks, checkEnd
js/ui.js                rendering: render*, transcript, live entry, dossier sheet, toast, busy/pendingDoc
js/ai.js                askAI (the only AI call), readStream, errCopy, aiReady
js/parse.js             splitRaw, streamPart, applyMeta
js/retrieval.js         retrieve(): keyword RAG over the unlocked docs
js/pwa.js               service worker registration and the install popup
js/util.js              $, pad, fmt, esc, rich
js/story/secrets.js     SECRETS
js/story/docs.js        DOCS, the case file
js/story/prompts.js     RULES, buildSuspectInput(), ilievskiInput()
js/story/scenes.js      opening scene and the three endings (ending())
config.js               window.PREDZORI_CONFIG = { apiUrl }, the Worker URL (classic script, loaded before the modules)
serve.py                local dev server (serves .js as JavaScript, which the stock Windows server doesn't)
manifest.webmanifest    PWA manifest (name, colors, icons)
sw.js                   network-first service worker so the game is installable and opens offline
icons/                  icon.svg (favicon: lamp over a suspect), icon-maskable.svg, and PNGs rendered from them
og-image.png            1200x630 social preview referenced by the og:/twitter: tags
worker/src/index.js     Cloudflare Worker: CORS allowlist, validation, forwards to {BASE_URL}/chat/completions
worker/wrangler.toml    BASE_URL (default Gemini OpenAI-compat), MODEL, FALLBACK_* (default Groq), timeouts, MAX_TOKENS, REASONING_EFFORT, ALLOWED_ORIGINS
worker/.dev.vars.example  API_KEY (and FALLBACK_API_KEY) for local `wrangler dev` (real .dev.vars is gitignored)
README.md               player and deployer docs
```

## Run / deploy

- Game locally: `python serve.py` from the repo root, then open http://localhost:8000. Not `python -m http.server`: on Windows it often serves `.js` as `text/plain` and the browser refuses to run the modules. Opening `index.html` from `file://` doesn't work either (modules need HTTP). With `apiUrl` empty, the AI shows as unavailable (expected).
- Worker locally: `cd worker && npm install && npm run dev` (serves on :8787), then set `apiUrl: "http://localhost:8787"` in `config.js`. Needs `worker/.dev.vars` with `API_KEY=...` (and `FALLBACK_API_KEY` when `FALLBACK_BASE_URL` is set).
- Worker deploy: `npx wrangler secret put API_KEY` (and `FALLBACK_API_KEY` when `FALLBACK_BASE_URL` is set), then `npm run deploy`.
- There are no tests or linters. Verify changes by playing in a browser.

## Architecture of the game (`js/`)

Modules import what they use; there are no globals except `window.PREDZORI_CONFIG`. `js/story/` holds the case content, the rest is engine.

1. **Constants** (`state.js`). `START=60`, `END=360` (minutes after midnight, so 01:00 to 06:00), `Q_COST=10`, `HINT_COST=15`, `MAX_HINTS=3`, and localStorage key `KEY="predzori-v1"`.
2. **`SECRETS`** (`story/secrets.js`). Five ordered truths, each `{k, q, a}`: `presence`, `killer`, `boss`, `deadline`, `location`. The sidebar shows `q` until the secret is revealed, then `a`. Revealing `location` wins the game.
3. **`DOCS`** (`story/docs.js`). The case file and knowledge base. Each doc is `{id, code, title, text, kw[], unlockAt, arrive?}`. `kw` holds lowercase Macedonian keyword stems for retrieval. `unlockAt` is in minutes after midnight: `d6` (phone records) unlocks at 150 (02:30) and `d7` (forensics) at 210 (03:30), and those use `arrive` as the log message.
4. **`RULES`** (`story/prompts.js`). The suspect's system prompt, written in English and telling the model to reply in Macedonian. It contains the character, the full hidden truth, how resistance moves, the reveal conditions for each secret, and a **strict output format**: the in-character reply, then `###`, then a JSON line `{"resistance", "revealed", "lawyer", "mood"}`. `OPENING_TURN` in `story/scenes.js` follows the same format.
5. **`ilievskiInput()`** (`story/prompts.js`). Builds the mentor's hint prompt from the current state, the unlocked docs and the last 10 transcript lines. It must never spoil the location or the deadline.
6. **State `S`** (`state.js`). Built by `fresh()` and saved whole to localStorage by `save()`. Fields: `v, phase ("intro"|"play"|"end"), t, q, hints, res, mood, revealed[], log[], turns[], outcome, unlocked[], fresh[], lawyer, endAt`.
   - `S` is an exported `let`: other modules read it through the live binding but can't assign it, so replacing the whole object (start, resume, restart, rollback) goes through `setS()`. Mutating fields (`S.t += ...`) is fine anywhere.
   - `log` holds display entries, `{w, text, doc?, k?}`, where `w` is one of `n` narration, `v` Viktor, `s` suspect, `i` Ilievski, `x` secret-revealed stamp.
   - `turns` holds the raw LLM conversation history (assistant turns keep the `###` JSON line).
   - If you change the shape of the state in an incompatible way, bump `v` (and the check `S.v !== 1`) so old saves are discarded. Old saves may still carry an unused `tier` field.
7. **AI layer** (`ai.js`). `aiReady` is true when `CONFIG.apiUrl` is set.
   - **`askAI(input, opts)` is the only function that talks to an AI.** `input` is a string or a `[{role, content}]` list. It POSTs `{messages, stream: true}` to the Worker, which streams NDJSON lines (`{"t": delta}`, or a final `{"error": code}`) read by `readStream()`; `opts.onText` is called as text arrives. A non-NDJSON response (errors before streaming, or an old Worker) is read as `{text}`/`{error}` and `onText` is called once. The browser aborts after 50 s with no first byte or 30 s between chunks.
   - `errCopy()` maps error codes to Macedonian messages for the player.
8. **Retrieval (RAG).** `retrieve(q, excludeId)` (`retrieval.js`) scores the unlocked docs by how many `kw` stems appear in the question and returns the top 2. `buildSuspectInput()` (`story/prompts.js`) puts together RULES as the `system` message, the last 24 `turns`, and a `[STATE]` block with the retrieved excerpts and any shown document.
9. **Parsing** (`parse.js`). `splitRaw()` splits the reply from the meta JSON. `streamPart()` hides the `###`/JSON while streaming. `applyMeta()` clamps resistance changes to between -25 and +30 per turn, accepts `location` only if the reply mentions the boiler room, the basement or the building (regex stems in the code), and also has a regex fallback that detects the location even when the model forgets to flag it. It fills `justRevealed` for the sidebar highlight.
10. **Flow** (`game.js`). `send()` and `hint()` snapshot `S` first and **roll back** on error, so a failed call costs the player no time. `checkUnlocks()` and `checkEnd()` run after each successful turn. The game ends on a win (`location`), `lawyer`, or time (`t >= END`).
11. **Rendering** (`ui.js`). `render()` dispatches to `renderIntro`, `renderStatus`, `renderLog`, `renderEnd` (text from `ending()` in `story/scenes.js`) and `renderAi`. The dossier bottom sheet uses `renderDocs`, `openSheet` and `closeSheet`. The "show evidence" button sets `pendingDoc` via `setPending()`; `busy` is set by `setBusy()`. Both are exported `let`s that `game.js` reads. `ui.js` never calls the AI and never imports `game.js` (events are wired in `main.js`), which keeps the import graph acyclic.

## Worker (`worker/src/index.js`)

- Allows only POST and OPTIONS. Checks the origin against `ALLOWED_ORIGINS` (comma list, `*` allowed).
- Limits: body up to 120 KB, up to 40 messages, each message cut to 30k characters. Roles are cleaned to system/user/assistant.
- Calls `${BASE_URL}/chat/completions` with `temperature: 0.8`, `max_tokens: MAX_TOKENS` and, if set, `reasoning_effort: REASONING_EFFORT`, via `complete()`. Gemini's thinking tokens count against `max_tokens`; without `REASONING_EFFORT = "low"` the Ilievski hints used ~1400 of 1500 tokens thinking and came back cut mid-sentence (`finish_reason: length`). If `MODEL` returns 429 or 5xx (Gemini often answers 503 "high demand") or sends nothing within `TIMEOUT_MS` (15 s), it retries once with `FALLBACK_MODEL` (`FALLBACK_TIMEOUT_MS`, 25 s). The fallback uses the main provider (`BASE_URL`, `API_KEY`, `REASONING_EFFORT`) unless `FALLBACK_BASE_URL` is set; then it uses `FALLBACK_BASE_URL`, the `FALLBACK_API_KEY` secret and `FALLBACK_REASONING_EFFORT`, and a missing `FALLBACK_API_KEY` returns `server_not_configured`. With `stream: true` in the body, `streamReply()` turns the provider's SSE into NDJSON and aborts if the stream stalls for `IDLE_TIMEOUT_MS`. Keep `TIMEOUT_MS + FALLBACK_TIMEOUT_MS` below the browser's 50 s first-byte limit in `askAI()`.
- Deployed at `https://pred-zori-api.pred-zori-api.workers.dev` (set in `config.js`). Main: Gemini `MODEL = gemini-3.5-flash-lite` (`gemini-3.8-flash` took 60-90+ s to answer in Oct 2026 tests, flash-lite under 1 s). Fallback: Groq (`FALLBACK_BASE_URL = https://api.groq.com/openai/v1`), `FALLBACK_MODEL = openai/gpt-oss-120b`. `ALLOWED_ORIGINS` = `https://viktor-nikolov-pred-zori.vercel.app` and plus localhost:8000. Providers retire models, so if calls start returning 404, list the available models (`GET {BASE_URL}/models`) and update `MODEL`.
- Error codes (`rate_limited`, `upstream_error`, `empty_completion`, `prompt_too_large`, `forbidden_origin`, `bad_request`, `server_not_configured`) must stay in sync with `errCopy()` in `js/ai.js`.
- History is capped at 24 turns plus RULES, which keeps requests under `MAX_MESSAGES = 40`. Keep that true if you change either limit.

## Conventions and gotchas

- **Language split:** only player-facing game text (UI strings, dossier documents, narration, endings, error messages) is in Macedonian. Everything else in the repo is in English: code, comments, prompts to the model, README.md and this file.
- Game text must be standard Macedonian Cyrillic with correct orthography, including the Macedonian-specific letters (gj, kj, dz, j, lj, nj, dzh). No Serbian, Bulgarian or Russian forms.
- Code style is compact: short helper names (`$`, `esc`, `rich`, `fmt`, `pad`), dense one-line functions, double quotes, semicolons. Keep to it. Imports use relative paths with the `.js` extension (required in the browser).
- Always escape model or user text with `esc()`/`rich()` before putting it in `innerHTML`. `rich()` turns `[stage directions]` into `<em class="stage">`.
- Theming uses CSS custom properties on `:root` in `css/style.css`, with dark overrides under both `@media (prefers-color-scheme: dark)` (guarded with `:not([data-theme="light"])`) and `:root[data-theme="dark"]`. Add new colors as tokens in all three places.
- The game used to also run as a claude.ai artifact (via `window.claude`); that mode was removed in favour of the multi-file layout. The page is now static-site only.
- **Story consistency:** the facts in `js/story/` (`docs.js`, `prompts.js` with RULES and the Ilievski hints, `scenes.js` with the opening and endings) and the intro brief in `index.html` all describe the same case. When you change a name, time, place or clue, update all of them.
- **Adding a secret:** add it to `SECRETS`, add its reveal condition and its key to the `revealed` list in the RULES output format, and add any advice about it to `ilievskiInput()`.
- **Adding a JS/CSS file:** add it to `SHELL` in `sw.js` and bump `CACHE`, or the installed app won't have it offline.
- **PWA / sharing:** `initPWA()` (`js/pwa.js`) registers `sw.js` and shows the install popup (`#install`) only outside an iframe. Chromium gets a real install button via `beforeinstallprompt`; iOS gets "Share → Add to Home Screen" steps. "Not now" hides it for 7 days (localStorage `predzori-install-later`). The OG/Twitter tags use absolute `https://viktor-nikolov-pred-zori.vercel.app/` URLs, so update them if the site moves. After changing `icons/*.svg`, re-render the PNGs (for example with headless Chrome `--screenshot`).
- **Adding a document:** give it a unique `id`/`code` and good `kw` stems (lowercase and stemmed, since matching is a substring `includes`). If it arrives later, set `unlockAt` and `arrive`, and mention it in the Ilievski hints if it matters.
