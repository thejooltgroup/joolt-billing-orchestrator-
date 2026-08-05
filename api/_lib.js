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
    MASTER_LICENSE_KEY: process.env.MASTER_LICENSE_KEY || ""
  };
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
      ? "Founder's Edition — 3-day free trial. Your $99 one-time is charged on day 3. Your $24.99/mo license begins billing on day 30. Cancel anytime."
      : "SMB Suite — 3-day free trial. Your $197 one-time is charged on day 3. Your $24.99/mo license begins billing on day 30. Cancel anytime.";

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
