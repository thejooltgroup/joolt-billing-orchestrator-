import { stripe, env, json } from "./_lib.js";

export const config = { runtime: "edge" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-token"
};

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const ADMIN = process.env.ADMIN_TOKEN || "";
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("x-admin-token") || "";
  if (!ADMIN) return json({ error: "admin_token_not_set", hint: "Set ADMIN_TOKEN in Vercel → Settings → Environment Variables, then redeploy." }, 200, CORS);
  if (token !== ADMIN) return json({ error: "unauthorized" }, 401, CORS);

  const E = env();
  const PRICE_LICENSE = process.env.PRICE_LICENSE || "";

  try {
    const bal = await stripe(E, "GET", "/v1/balance");
    const sum = a => (a || []).reduce((n, x) => n + (x.amount || 0), 0);

    // Subscriptions (up to 3 pages of 100), with customer expanded.
    let subs = [], after = null;
    for (let i = 0; i < 3; i++) {
      const p = new URLSearchParams();
      p.set("status", "all"); p.set("limit", "100"); p.set("expand[]", "data.customer");
      if (after) p.set("starting_after", after);
      const r = await stripe(E, "GET", "/v1/subscriptions?" + p.toString());
      if (r.error || !r.data) break;
      subs = subs.concat(r.data);
      if (!r.has_more) break;
      after = r.data[r.data.length - 1].id;
    }

    const items = s => (s.items && s.items.data ? s.items.data : []);
    const isLic = s => items(s).some(it => it.price && it.price.id === PRICE_LICENSE);
    const licSubs = PRICE_LICENSE ? subs.filter(isLic) : [];
    const activeLic = licSubs.filter(s => ["trialing", "active"].includes(s.status));

    const monthly = s => {
      let m = 0;
      items(s).forEach(it => {
        const pr = it.price; if (!pr || !pr.recurring) return;
        const q = it.quantity || 1; let amt = (pr.unit_amount || 0) * q;
        const iv = pr.recurring.interval, ic = pr.recurring.interval_count || 1;
        if (iv === "year") amt = amt / (12 * ic);
        else if (iv === "week") amt = (amt * 52) / 12 / ic;
        else if (iv === "day") amt = (amt * 365) / 12 / ic;
        else amt = amt / ic;
        m += amt;
      });
      return m;
    };
    const mrr = subs.filter(s => ["trialing", "active"].includes(s.status)).reduce((n, s) => n + monthly(s), 0);

    const ch = await stripe(E, "GET", "/v1/charges?limit=100");
    const charges = (ch.data || []).filter(c => c.paid && c.status === "succeeded");
    const now = Math.floor(Date.now() / 1000), d30 = now - 30 * 86400;
    const rev30 = charges.filter(c => c.created >= d30).reduce((n, c) => n + (c.amount - (c.amount_refunded || 0)), 0);

    const setup = { guided: 0, concierge: 0, managed: 0 };
    charges.forEach(c => { const a = c.amount; if (a === 19900) setup.guided++; else if (a === 75000) setup.concierge++; else if (a === 7900) setup.managed++; });

    const licenses = [];
    licSubs.sort((a, b) => (b.created || 0) - (a.created || 0)).forEach(s => {
      const cust = s.customer && typeof s.customer === "object" ? s.customer : null;
      const cid = cust ? cust.id : s.customer;
      let devices = 0;
      try { const d = JSON.parse((cust && cust.metadata && cust.metadata.joolt_devices) || "[]"); devices = Array.isArray(d) ? d.length : 0; } catch (e) {}
      licenses.push({
        id: cid, email: cust ? cust.email : null, status: s.status,
        tier: (s.metadata && s.metadata.tier) || "standard",
        periodEnd: s.current_period_end ? s.current_period_end * 1000 : (s.trial_end ? s.trial_end * 1000 : null),
        devices
      });
    });

    const recentCharges = charges.slice(0, 25).map(c => ({
      amount: c.amount, created: c.created * 1000,
      email: (c.billing_details && c.billing_details.email) || null,
      desc: c.description || null, refunded: c.amount_refunded || 0
    }));

    return json({
      ok: true, generatedAt: Date.now(),
      priceLicenseSet: !!PRICE_LICENSE,
      balance: { available: sum(bal.available), pending: sum(bal.pending), currency: (bal.available && bal.available[0] && bal.available[0].currency) || "usd" },
      kpis: { activeLicenses: activeLic.length, totalLicenseCustomers: licSubs.length, mrr: Math.round(mrr), rev30, subsCount: subs.length },
      setupSales: setup,
      licenses: licenses.slice(0, 100),
      recentCharges
    }, 200, CORS);
  } catch (e) {
    return json({ error: String(e) }, 500, CORS);
  }
}
