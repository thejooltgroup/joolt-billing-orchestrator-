/**
 * Shared logic for all Vercel Edge Function routes.
 * Same functionality as the Cloudflare Worker — repackaged for Vercel.
 */

export const TRIAL_PHASE1_DAYS = 3;
export const TRIAL_TOTAL_DAYS = 30;

/* -------- Stripe helper -------- */
export async function stripe(env, method, path, body) {
  const url = "https://api.stripe.com" + path;
  const init = {
    method,
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "Stripe-Version": "2024-06-20"
    }
  };
  if (body) {
    init.body = body instanceof URLSearchParams ? body.toString() : body;
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetch(url, init);
  const out = await res.json();
  if (!res.ok) out.error = out.error || { message: "http_" + res.status };
  return out;
}

/* -------- Responses -------- */
export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json", ...extra }
  });
}
export function html(body, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>JOOLT</title>` +
    `<style>body{font-family:-apple-system,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;background:#0A0E1A;color:#F4F7FC;}` +
    `a{color:#8FB3FF;}h2{color:white;}</style>${body}`,
    { status, headers: { "content-type": "text/html" } }
  );
}
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, stripe-signature"
};

/* -------- Env accessor: process.env works on Vercel Edge for public + secret vars -------- */
export function env() {
  return {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    PRICE_LICENSE: process.env.PRICE_LICENSE,
    PRICE_ONETIME_FOUNDERS: process.env.PRICE_ONETIME_FOUNDERS,
    PRICE_ONETIME_SUITE: process.env.PRICE_ONETIME_SUITE,
    PRICE_SETUP_CONSULTING: process.env.PRICE_SETUP_CONSULTING,
    WELCOME_URL_BASE: process.env.WELCOME_URL_BASE || "https://smb.joolt.io/welcome",
    FOUNDERS_MAX: process.env.FOUNDERS_MAX || "50",
    MASTER_LICENSE_KEY: process.env.MASTER_LICENSE_KEY || "",
    PILOT_LICENSE_KEYS: process.env.PILOT_LICENSE_KEYS || "",
    PILOT_EXPIRES_AT: process.env.PILOT_EXPIRES_AT || "",
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID || "",
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET || "",
    GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN || "",
    WELCOME_FROM: process.env.WELCOME_FROM || "Troy at JOOLT <admin@thejooltgroup.com>"
  };
}

/* -------- Instant welcome email (Gmail API, sends AS admin@thejooltgroup.com) --------
   Fires after a successful checkout. Fully isolated: any failure here is
   swallowed — it can NEVER affect billing or the webhook response. */
function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sendWelcomeEmail(session, sku, E) {
  try {
    if (!E.GMAIL_CLIENT_ID || !E.GMAIL_CLIENT_SECRET || !E.GMAIL_REFRESH_TOKEN) return; // not configured — skip silently
    const to = session.customer_details && session.customer_details.email;
    if (!to) return;
    const first = ((session.customer_details && session.customer_details.name) || "").split(" ")[0] || "there";
    const oneTime = sku === "founders" ? "$39 Founder's fee" : "$79 one-time fee";
    const emailHtml = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;line-height:1.6">
  <p>Hi ${first},</p>
  <p>Welcome to JOOLT — you just hired Sophia. Here's your next 10 minutes:</p>
  <p><b>1. Open your Suite (bookmark this):</b><br/>
  <a href="https://smb.joolt.io/smb-suite-app.html">smb.joolt.io/smb-suite-app.html</a><br/>
  You'll land on Sophia's Plays — the jobs she runs for your business. A few work right now; the rest turn on when your tools are connected.</p>
  <p><b>2. Book your setup call (do this today):</b><br/>
  Reply to this email with two times that work this week. On a 30-minute screen-share we install your Sophia box, connect the tools you already use, and turn your plays on. You'll leave the call with Sophia already working.</p>
  <p><b>3. Your billing, in plain English:</b><br/>
  &bull; Today: $0 — your 3-day free trial is running<br/>
  &bull; Day 3: your one-time ${oneTime}<br/>
  &bull; Day 30: your $7.99/mo license begins (cancel anytime)<br/>
  Your receipt session ID: <code style="font-size:12px">${session.id}</code></p>
  <p>One promise: <b>Sophia drafts, you approve.</b> Nothing is ever sent, posted, or paid without your OK.</p>
  <p>Talk soon,<br/>Troy Walker<br/>The JOOLT Group &middot; <a href="https://smb.joolt.io">smb.joolt.io</a></p>
  <p style="color:#667;font-size:13px">P.S. If you'd rather not touch any setup yourself, ask about Guided Setup on your call — we do every step with you.</p>
</div>`;
    // 1. Exchange the refresh token for a short-lived access token
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: E.GMAIL_CLIENT_ID,
        client_secret: E.GMAIL_CLIENT_SECRET,
        refresh_token: E.GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token"
      }).toString()
    });
    const tok = await tokRes.json();
    if (!tok.access_token) return;

    // 2. Build the RFC-2822 message and send via Gmail as admin@thejooltgroup.com
    const subject = "You're in — here's your JOOLT SMB Suite (2-minute start)";
    const mime =
      "From: " + E.WELCOME_FROM + "\r\n" +
      "To: " + to + "\r\n" +
      "Reply-To: admin@thejooltgroup.com\r\n" +
      "Subject: =?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode(subject))) + "?=\r\n" +
      "MIME-Version: 1.0\r\n" +
      "Content-Type: text/html; charset=UTF-8\r\n" +
      "\r\n" + emailHtml;
    await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Authorization": "Bearer " + tok.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(mime) })
    });
  } catch (e) { /* never let email problems touch billing */ }
}

/* -------- Checkout handler (shared by /checkout/founders and /checkout/suite) -------- */
export async function handleCheckout(sku) {
  const E = env();
  try {
    if (sku === "founders" && E.FOUNDERS_MAX) {
      const count = await countFoundersSold(E);
      if (count >= Number(E.FOUNDERS_MAX)) {
        return html(
          `<h2>Founder's Edition is sold out.</h2>` +
          `<p>All ${E.FOUNDERS_MAX} slots claimed. Standard Suite is still available.</p>` +
          `<p><a href="/api/checkout/suite">Buy the SMB Suite →</a></p>`
        );
      }
    }

    const successUrl = `${E.WELCOME_URL_BASE.replace(/\/$/,"")}?sku=${sku}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `https://joolt.io?canceled=1`;

    const explainer = sku === "founders"
      ? "Founder's Edition — 3-day free trial. Your $39 one-time is charged on day 3. Your $7.99/mo license begins billing on day 30. Cancel anytime."
      : "SMB Suite — 3-day free trial. Your $79 one-time is charged on day 3. Your $7.99/mo license begins billing on day 30. Cancel anytime.";

    const p = new URLSearchParams();
    p.set("mode", "setup");
    p.set("payment_method_types[]", "card");
    p.set("success_url", successUrl);
    p.set("cancel_url", cancelUrl);
    p.set("customer_creation", "always");
    p.set("billing_address_collection", "auto");
    p.set("metadata[sku]", sku);
    p.set("metadata[flow]", "day3_day30");
    p.set("custom_text[after_submit][message]", explainer);

    const session = await stripe(E, "POST", "/v1/checkout/sessions", p);
    if (session.error) return json({ error: session.error.message }, 500);

    return Response.redirect(session.url, 303);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function countFoundersSold(E) {
  const p = new URLSearchParams();
  p.set("limit", "100");
  p.set("status", "complete");
  const res = await stripe(E, "GET", "/v1/checkout/sessions?" + p.toString());
  if (res.error || !res.data) return 0;
  return res.data.filter(s => s.metadata && s.metadata.sku === "founders").length;
}

/* -------- Webhook handler -------- */
export async function handleWebhook(request) {
  const E = env();
  const bodyText = await request.text();
  const sigHeader = request.headers.get("stripe-signature") || "";
  const ok = await verifyStripeSignature(bodyText, sigHeader, E.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("bad signature", { status: 400 });

  const event = JSON.parse(bodyText);
  if (event.type === "checkout.session.completed") {
    return handleCheckoutCompleted(event.data.object, E);
  }
  return json({ received: true });
}

async function handleCheckoutCompleted(session, E) {
  const sku = (session.metadata && session.metadata.sku) || "suite";
  const flow = (session.metadata && session.metadata.flow) || "";
  if (flow !== "day3_day30") return json({ skipped: "not_day3_day30_flow" });

  const customerId = session.customer;
  if (!customerId) return json({ error: "no_customer" }, 500);

  const setupIntentId = session.setup_intent;
  if (!setupIntentId) return json({ error: "no_setup_intent" }, 500);

  const setupIntent = await stripe(E, "GET", `/v1/setup_intents/${setupIntentId}`);
  if (setupIntent.error || !setupIntent.payment_method) return json({ error: "no_payment_method" }, 500);

  const paymentMethodId = setupIntent.payment_method;

  const attachP = new URLSearchParams();
  attachP.set("invoice_settings[default_payment_method]", paymentMethodId);
  const custUpd = await stripe(E, "POST", `/v1/customers/${customerId}`, attachP);
  if (custUpd.error) return json({ error: "cust_update_failed", detail: custUpd.error.message }, 500);

  const oneTimePriceId = sku === "founders" ? E.PRICE_ONETIME_FOUNDERS : E.PRICE_ONETIME_SUITE;
  const licensePriceId = E.PRICE_LICENSE;
  if (!oneTimePriceId || !licensePriceId) return json({ error: "missing_price_env" }, 500);

  const nowSec = Math.floor(Date.now() / 1000);
  const day3Sec = nowSec + TRIAL_PHASE1_DAYS * 86400;
  const day30Sec = nowSec + TRIAL_TOTAL_DAYS * 86400;

  const p = new URLSearchParams();
  p.set("customer", customerId);
  p.set("start_date", String(nowSec));
  p.set("end_behavior", "release");
  p.set("default_settings[collection_method]", "charge_automatically");
  p.set("default_settings[default_payment_method]", paymentMethodId);
  p.set("metadata[sku]", sku);
  p.set("metadata[flow]", "day3_day30");

  // Phase 1: day 0 → day 3, trial
  p.set("phases[0][items][0][price]", licensePriceId);
  p.set("phases[0][items][0][quantity]", "1");
  p.set("phases[0][end_date]", String(day3Sec));
  p.set("phases[0][trial]", "true");

  // Phase 2: day 3 → day 30, trial + one-time via add_invoice_item
  p.set("phases[1][items][0][price]", licensePriceId);
  p.set("phases[1][items][0][quantity]", "1");
  p.set("phases[1][end_date]", String(day30Sec));
  p.set("phases[1][trial]", "true");
  p.set("phases[1][add_invoice_items][0][price]", oneTimePriceId);
  p.set("phases[1][add_invoice_items][0][quantity]", "1");

  // Phase 3: day 30+, license live
  p.set("phases[2][items][0][price]", licensePriceId);
  p.set("phases[2][items][0][quantity]", "1");

  const schedule = await stripe(E, "POST", "/v1/subscription_schedules", p);
  if (schedule.error) return json({ error: "schedule_failed", detail: schedule.error.message }, 500);

  // Billing is fully set up — now (and only now) send the instant welcome email.
  // Isolated: sendWelcomeEmail can never throw or alter the response.
  await sendWelcomeEmail(session, sku, E);

  return json({ ok: true, scheduleId: schedule.id, customer: customerId, sku });
}

/* -------- License verification -------- */
export async function handleLicenseVerify(request) {
  const E = env();
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";

  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Master license bypass (for internal QA, demos, training) — env-var controlled
  if (E.MASTER_LICENSE_KEY && key === E.MASTER_LICENSE_KEY) {
    return json({
      valid: true,
      status: "active",
      expiresAt: Date.now() + 100 * 365 * 24 * 3600 * 1000, // ~100 years
      tier: "master",
      trialEnd: null,
      cancelAt: null,
      reason: "master_key",
      gracePeriodDays: 0,
      serverTime: Date.now()
    }, 200, CORS);
  }

  // Pilot/beta licenses — comma-separated keys in PILOT_LICENSE_KEYS, expiry in PILOT_EXPIRES_AT (ISO date)
  if (E.PILOT_LICENSE_KEYS) {
    const pilots = E.PILOT_LICENSE_KEYS.split(",").map(s => s.trim()).filter(Boolean);
    if (pilots.includes(key)) {
      const exp = Date.parse(E.PILOT_EXPIRES_AT || "") || (Date.now() + 183 * 24 * 3600 * 1000);
      const valid = Date.now() < exp;
      return json({
        valid,
        status: valid ? "active" : "expired",
        expiresAt: exp,
        tier: "pilot",
        trialEnd: null,
        cancelAt: exp,
        reason: valid ? "pilot_key" : "Pilot license expired — email admin@thejooltgroup.com",
        gracePeriodDays: 0,
        serverTime: Date.now()
      }, 200, CORS);
    }
  }

  if (!key || !key.startsWith("cus_")) {
    return json({ valid: false, status: "invalid_key", reason: "License key missing or malformed." }, 200, CORS);
  }

  const p = new URLSearchParams();
  p.set("customer", key);
  p.set("status", "all");
  p.set("limit", "10");
  const subs = await stripe(E, "GET", "/v1/subscriptions?" + p.toString());
  if (subs.error || !subs.data) {
    return json({ valid: false, status: "lookup_failed", reason: (subs.error && subs.error.message) || "Could not verify" }, 200, CORS);
  }

  const licenseSub = subs.data.find(s =>
    (s.items && s.items.data ? s.items.data : []).some(it => it.price && it.price.id === E.PRICE_LICENSE)
  );

  if (!licenseSub) {
    return json({ valid: false, status: "no_subscription", reason: "No JOOLT license subscription on this customer." }, 200, CORS);
  }

  const status = licenseSub.status;
  const valid = ["trialing", "active"].includes(status);
  const expiresAt = licenseSub.current_period_end
    ? licenseSub.current_period_end * 1000
    : (licenseSub.trial_end ? licenseSub.trial_end * 1000 : null);
  const tier = (licenseSub.metadata && licenseSub.metadata.tier) || "standard";

  return json({
    valid,
    status,
    expiresAt,
    tier,
    trialEnd: licenseSub.trial_end ? licenseSub.trial_end * 1000 : null,
    cancelAt: licenseSub.cancel_at ? licenseSub.cancel_at * 1000 : null,
    reason: valid ? "ok" : ("Subscription is " + status),
    gracePeriodDays: 7,
    serverTime: Date.now()
  }, 200, CORS);
}

/* -------- Stripe webhook signature verification (HMAC-SHA256) -------- */
async function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(x => x.split("=")));
  const t = parts.t;
  if (!t) return false;
  const signedPayload = t + "." + payload;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const sigHex = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, "0")).join("");

  const v1s = header.split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  return v1s.some(v => timingSafeEqualHex(v, sigHex));
}
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
