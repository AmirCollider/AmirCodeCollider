# AmirCodeCollider

Personal site for **Amir Collider** — portfolio + a "start a project" order form that
delivers each request straight to your Telegram bot. Static site + one Cloudflare Pages
Function. No build step.

```
.
├── index.html              # the whole site (HTML + CSS + JS inline)
├── functions/
│   └── api/
│       └── order.js        # POST /api/order  ->  Telegram sendMessage
├── assets/
│   ├── logo.png            # placeholder mark — replace with your logo
│   └── og.png              # placeholder social-share image — replace if you like
└── _headers                # basic security headers
```

## You provide 3 things

1. `assets/logo.png` — your own logo (square works best; the nav + favicon use it).
2. `TELEGRAM_BOT_TOKEN` — a Cloudflare environment variable (below).
3. `TELEGRAM_CHAT_ID` — a Cloudflare environment variable (below).

The token and chat id are **never** in the website code — only in Cloudflare's settings,
so visitors can't see them.

## Get your bot token + chat id

1. In Telegram, message **@BotFather** → `/newbot` → follow prompts → copy the **bot token**.
2. Start a chat with your new bot and send it any message (e.g. "hi").
3. Message **@userinfobot** in Telegram → it replies with your numeric **chat id**.
   (Or open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` after step 2 and read
   `result[].message.chat.id`.)

## Deploy to Cloudflare Pages

1. Push this folder to the repo `AmirCollider/AmirCodeCollider`:
   ```
   git init
   git add .
   git commit -m "Launch amircodecollider"
   git branch -M main
   git remote add origin https://github.com/AmirCollider/AmirCodeCollider.git
   git push -u origin main
   ```
2. Cloudflare dashboard → **Workers & Pages** → your **amircodecollider** Pages project →
   **Settings → Build** → connect it to the GitHub repo.
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: `/`
3. **Settings → Environment variables → Production** → add:
   - `TELEGRAM_BOT_TOKEN` = your bot token
   - `TELEGRAM_CHAT_ID` = your chat id
4. **Deployments → Retry / redeploy** so the new variables load.
5. Open the site, submit the form once — the request should arrive in your Telegram.

## Test locally (optional)

```
npm i -g wrangler
wrangler pages dev .
```
Add the two variables in a `.dev.vars` file for local testing:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Notes

- Honeypot field + server-side validation block most spam.
- All user input is HTML-escaped before it reaches Telegram.
- To add a custom domain: Pages project → **Custom domains**.
