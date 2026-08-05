# JOOLT Billing Orchestrator — Vercel Deploy Guide

Since `joolt.io` is on Vercel, this is a fresh Vercel Edge Function project instead of a Cloudflare Worker. Same logic — different host. **~10 minutes** to live.

## Structure

```
orchestrator-vercel/
├── api/
│   ├── _lib.js                 (shared logic — checkout, webhook, license verify)
│   ├── checkout/
│   │   ├── founders.js         → GET /checkout/founders
│   │   └── suite.js            → GET /checkout/suite
│   ├── webhook.js              → POST /webhook
│   ├── license/verify.js       → GET /license/verify?key=cus_XXX
│   └── health.js               → GET /health
├── vercel.json                 (route rewrites)
├── package.json
└── .env.example                (copy values into Vercel dashboard)
```

## Option A — Deploy from the Vercel dashboard (no CLI)

1. Zip the `orchestrator-vercel/` folder
2. Go to **vercel.com/new** → **Deploy** → drag the zip
3. Name the project (suggest: `joolt-billing-orchestrator`)
4. Before hitting Deploy, click **Environment Variables** and paste every line from `.env.example` (put your real `sk_live_...` in `STRIPE_SECRET_KEY`, mark it Sensitive)
5. Click **Deploy**
6. When it finishes, you'll get a URL like `https://joolt-billing-orchestrator.vercel.app`

## Option B — Deploy from Terminal (Vercel CLI)

Only if you're comfortable in Terminal:

```bash
npm i -g vercel
cd orchestrator-vercel
vercel                # first time: it links a new project
vercel env pull       # optional: pull existing envs
vercel --prod         # deploy to production
```

Set env vars either interactively during `vercel` first-run, or in the dashboard after.

## Bind your domain

Vercel Dashboard → your project → **Settings → Domains** → add either:
- `smb.joolt.io` (subdomain, cleanest), or
- `api.joolt.io/orchestrator` (path-based on an api subdomain)

Vercel handles the DNS automatically because `joolt.io` is already in your account.

## Update the Stripe webhook to point at Vercel

The webhook I registered earlier points at `https://smb.joolt.io/webhook`, which will Just Work once you bind `smb.joolt.io` in Vercel. If you want to skip the custom domain and use the `.vercel.app` URL for now, update the webhook URL in Stripe Dashboard → Developers → Webhooks → edit → change URL to your `.vercel.app`-based one. Copy the new signing secret it generates, replace `STRIPE_WEBHOOK_SECRET` in Vercel env vars, redeploy.

## Update the Buy button URLs

The app / landing / one-pager currently point at `https://smb.joolt.io/checkout/founders` and `/suite`. That works once `smb.joolt.io` is bound to this Vercel project. If you use the `.vercel.app` URL instead, tell me and I'll sweep the URLs across all deliverables in one pass.

## Test-mode deploy

Vercel supports **Preview environments**. Easiest workflow:

1. Push the project to a GitHub repo
2. Connect Vercel to the repo (automatic on first deploy)
3. Any branch other than `main` becomes a preview deploy
4. Create env vars per-environment (Production vs Preview) in Vercel dashboard so preview uses `sk_test_...`
5. Preview URLs are auto-generated like `joolt-billing-orchestrator-git-test.vercel.app`

Run `test-setup.mjs` (from the earlier `orchestrator/` folder) with your test secret key and the preview URL to bootstrap test Stripe objects.

## Verify it works

- `GET https://<your-vercel-url>/health` → `{ "ok": true, "time": ... }`
- `GET https://<your-vercel-url>/checkout/founders` → 303 redirect to Stripe Checkout
- After a real checkout with test card, verify in Stripe dashboard that a Subscription Schedule was created with 3 phases

## When something breaks

- Vercel dashboard → **Deployments → your deployment → Runtime Logs** shows every request + errors from the functions
- Stripe dashboard → **Developers → Webhooks → your endpoint → Recent deliveries** shows what Stripe sent and got back
