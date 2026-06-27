# AmirCodeCollider

Personal site for **Amir Collider** — a cute, soft portfolio + a "start a project"
order form that delivers each request straight to your Telegram bot.

- 🌐 Three languages: **فارسی · English · 日本語** (switch in the top bar, choice is remembered)
- 🌙 **Dark & light** themes (remembers the visitor's choice; follows system by default)
- 💖 Soft kawaii look — neon-blue + soft-red accents, centered layout so RTL/LTR switching stays calm
- 📨 Order form → your Telegram, with a honeypot + server-side validation
- ⚡ Static site + one Cloudflare Pages Function. No build step.

```
.
├── index.html              # whole site: HTML + CSS + JS + the 3-language dictionary
├── functions/
│   └── api/
│       └── order.js        # POST /api/order  ->  Telegram sendMessage
├── assets/
│   └── logo.png            # cute placeholder mark — replace with your own
└── _headers                # basic security headers
```

## Environment variables (already set in your project)

In **Settings → Variables and secrets** you added:

| Name                  | Value                              | Status |
|-----------------------|------------------------------------|--------|
| `TELEGRAM_BOT_TOKEN`  | your bot token                     | ✅ used |
| `AmirCollider`        | your numeric Telegram chat id      | ✅ used as the chat id |

The function reads the chat id from `TELEGRAM_CHAT_ID` **or** `AmirCollider`, so your
current setup works as-is. (If you ever want a clearer name, add `TELEGRAM_CHAT_ID`
with the same value — it takes priority.)

## Your logo

You uploaded **AmirColliderLogo.png** to an R2 bucket. Two ways to use it:

**A) Simplest (recommended)** — put the file in the repo as `assets/logo.png`.
The site already points there; nothing else to change.

**B) Serve from R2** — turn on public access for the bucket
(R2 → your bucket → Settings → Public access → r2.dev), copy the public URL, then in
`index.html` set:
```js
var LOGO_URL = "https://pub-XXXXXXXX.r2.dev/AmirColliderLogo.png";
```
Note: your message said the bucket is `amircodecolliderr2`, but the dashboard link shows
`amircolliderr2` — use whichever name actually exists.

## Deploy to Cloudflare Pages

1. Push this folder to `AmirCollider/AmirCodeCollider`:
   ```
   git init
   git add .
   git commit -m "Launch amircodecollider"
   git branch -M main
   git remote add origin https://github.com/AmirCollider/AmirCodeCollider.git
   git push -u origin main
   ```
2. Cloudflare → **Workers & Pages** → **amircodecollider** → connect the GitHub repo.
   - Framework preset: **None**
   - Build command: *(empty)*
   - Build output directory: `/`
3. Make sure `TELEGRAM_BOT_TOKEN` and `AmirCollider` are set for **Production**.
4. **Deployments → redeploy** so the variables load.
5. Open the site, submit the form once — the request should arrive in your Telegram.

## Test locally (optional)

```
npm i -g wrangler
wrangler pages dev .
```
With a `.dev.vars` file:
```
TELEGRAM_BOT_TOKEN=...
AmirCollider=...
```

## Notes

- Add a custom domain later: Pages project → **Custom domains**.
- `og.png` (social-share image) is skipped for now — add one later and re-add the
  `og:image` meta tag if you want link previews.
- To tweak any wording in any language, edit the `I18N` object near the bottom of `index.html`.
