import { stripe, env, json } from "./_lib.js";

export const config = { runtime: "edge" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-token"
};

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, CORS);

  const ADMIN = process.env.ADMIN_TOKEN || "";
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const url = new URL(request.url);
  const token = body.token || url.searchParams.get("token") || request.headers.get("x-admin-token") || "";
  if (!ADMIN) return json({ error: "admin_token_not_set" }, 200, CORS);
  if (token !== ADMIN) return json({ error: "unauthorized" }, 401, CORS);

  const id = (body.id || "").trim();
  const action = (body.action || "").trim();
  if (!id.startsWith("cus_")) return json({ error: "bad_id" }, 400, CORS);

  const E = env();
  const statusFor = { suspend: "suspended", revoke: "revoked", reactivate: "" };
  if (!(action in statusFor)) return json({ error: "bad_action" }, 400, CORS);

  try {
    // set the access flag on the customer
    const p = new URLSearchParams();
    p.set("metadata[joolt_status]", statusFor[action]);
    const upd = await stripe(E, "POST", `/v1/customers/${id}`, p);
    if (upd.error) return json({ error: upd.error.message || "update_failed" }, 500, CORS);

    let cancelled = [];
    if (action === "revoke") {
      // also cancel the license subscription so billing stops
      const PRICE_LICENSE = process.env.PRICE_LICENSE || "";
      const subs = await stripe(E, "GET", `/v1/subscriptions?customer=${id}&status=active&limit=10`);
      for (const s of (subs.data || [])) {
        const isLic = (s.items && s.items.data ? s.items.data : []).some(it => it.price && it.price.id === PRICE_LICENSE);
        if (isLic) { const c = await stripe(E, "DELETE", `/v1/subscriptions/${s.id}`); if (!c.error) cancelled.push(s.id); }
      }
    }
    return json({ ok: true, id, action, status: statusFor[action], cancelled }, 200, CORS);
  } catch (e) {
    return json({ error: String(e) }, 500, CORS);
  }
}
