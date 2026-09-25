# Pred Zori (Before Dawn)

**An interactive interrogation game in Macedonian.** You play Inspector Viktor Nikolov of the Department for Blood Crimes in Skopje. You have until 06:00 to break a suspect, Goran Trajkovski, and find out where the missing girl Sara is. The suspect and your superior are played by an AI.

The game itself is in Macedonian; the code, comments and documentation are in English.

## How to play

- Type questions as Viktor Nikolov; the suspect answers in character.
- Each question costs 10 minutes of in-game time (start 01:00, deadline 06:00).
- The **Evidence** button lets you show a document from the case file. New documents arrive during the night.
- The **Ilievski** button calls your superior for a hint (15 minutes, three calls).
- A resistance meter shows how closed off the suspect is. Evidence, empathy and credible deals lower it; threats and insults raise it. Threaten violence twice and he asks for a lawyer.
- Five hidden truths are uncovered in order. The game is won when he reveals where Sara is.

## How it works

The whole game is a single static page, `index.html`, with no build step.

- **Case file as a knowledge base (RAG).** The dossier documents (`DOCS`) are searched by keyword on every question. The most relevant ones, plus any document the player shows, are added to the suspect's prompt so he can tell real evidence from bluffs.
- **Suspect prompt (`RULES`).** Holds the suspect's character, the hidden truth, and the rules for when each secret may be revealed. The model replies in Macedonian, then adds a JSON line with its resistance, newly revealed secrets and mood, which drives the UI.
- **Hint prompt (`ilievskiInput`).** Gives the superior the current state and transcript so he can suggest one next step without spoiling the answer.
- **One AI function (`askAI`).** Inside claude.ai the game uses the player's own Claude account. Anywhere else it calls the proxy set in `config.js`.
- Progress is saved in the browser's `localStorage`.

```
index.html          the game (HTML, CSS, JS in one file)
config.js           apiUrl of your proxy
worker/             Cloudflare Worker that hides your API key
  src/index.js      forwards requests to any OpenAI-compatible API
  wrangler.toml     provider, model and allowed origins
```

## Deploy it for free

You need a free API key and a free Cloudflare account. The key stays in the worker, never in the page.

### 1. Get an API key

The default is Google Gemini: create a key in [Google AI Studio](https://aistudio.google.com/). Any OpenAI-compatible provider works, for example Groq (`BASE_URL = "https://api.groq.com/openai/v1"`) or OpenRouter. Change `BASE_URL` and `MODEL` in `worker/wrangler.toml` to match, and check the provider's docs for the current free model name. Macedonian quality differs a lot between models, so test a few.

### 2. Deploy the worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put API_KEY     # paste your key
npm run deploy
```

Wrangler prints a URL such as `https://pred-zori-api.<your-subdomain>.workers.dev`.

In `worker/wrangler.toml`, set `ALLOWED_ORIGINS` to your GitHub Pages address (for example `https://your-username.github.io`) so other sites can't use your quota, then deploy again.

### 3. Point the game at the worker

In `config.js`:

```js
window.PREDZORI_CONFIG = {
  apiUrl: "https://pred-zori-api.<your-subdomain>.workers.dev"
};
```

### 4. Publish on GitHub Pages

Push the repository, then in **Settings → Pages** choose **Deploy from a branch**, branch `main`, folder `/ (root)`. The game will be at `https://your-username.github.io/pred-zori/`.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To test the worker locally, copy `worker/.dev.vars.example` to `worker/.dev.vars`, add your key, run `npm run dev` in `worker/`, and set `apiUrl` to `http://localhost:8787`.

## Free tier notes

Free API tiers have per-minute and per-day limits shared by all your players. When a limit is hit, the game tells the player to wait and does not charge them in-game time. If the game gets popular, consider adding per-IP rate limiting in the worker (Cloudflare offers a rate-limiting binding) or moving to a paid tier.

## Make your own case

Everything about the story lives near the top of the script in `index.html`:

- `DOCS`: the case file (title, text, retrieval keywords, and `unlockAt` in minutes after midnight).
- `SECRETS`: the truths the player must uncover.
- `RULES`: the suspect's character, hidden truth and reveal conditions.
- `ilievskiInput()`: the mentor's advice rules.

## License

MIT. See [LICENSE](LICENSE).
