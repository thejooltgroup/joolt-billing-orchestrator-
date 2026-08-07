import { stripe, env, json } from "./_lib.js";

export const config = { runtime: "edge" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-token"
};

function slug(s) {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

  const ADMIN = process.env.ADMIN_TOKEN || "";
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("x-admin-token") || "";
  if (!ADMIN) return json({ error: "admin_token_not_set" }, 200, CORS);
  if (token !== ADMIN) return json({ error: "unauthorized" }, 401, CORS);

  const E = env();

  try {
    /* ---------- Create / update a reseller ---------- */
    if (request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const name = (body.name || "").trim();
      const code = slug(body.code || body.name);
      if (!name || !code) return json({ error: "name_and_code_required" }, 400, CORS);
      const commission = String(Math.max(0, Math.min(90, parseInt(body.commission, 10) || 25)));
      const b = body.brand || {};

      const p = new URLSearchParams();
      p.set("name", name);
      p.set("metadata[joolt_kind]", "reseller");
      p.set("metadata[joolt_code]", code);
      p.set("metadata[joolt_commission]", commission);
      p.set("metadata[joolt_brand_name]", (b.name || name).slice(0, 120));
      p.set("metadata[joolt_brand_primary]", (b.primary || "").slice(0, 20));
      p.set("metadata[joolt_brand_accent]", (b.accent || "").slice(0, 20));
      p.set("metadata[joolt_brand_logo]", (b.logo || "").slice(0, 12));
      p.set("metadata[joolt_brand_tagline]", (b.tagline || "").slice(0, 140));
      p.set("metadata[joolt_brand_powered]", b.poweredBy ? "1" : "");
      p.set("metadata[joolt_brand_domain]", (b.domain || "").slice(0, 120));
      p.set("metadata[joolt_brand_support]", (b.support || "").slice(0, 120));

      // find existing by code
      const q = "metadata['joolt_kind']:'reseller' AND metadata['joolt_code']:'" + code + "'";
      const found = await stripe(E, "GET", "/v1/customers/search?query=" + encodeURIComponent(q) + "&limit=1");
      let res;
      if (found.data && found.data[0]) {
        res = await stripe(E, "POST", "/v1/customers/" + found.data[0].id, p);
      } else {
        res = await stripe(E, "POST", "/v1/customers", p);
      }
      if (res.error) return json({ error: res.error.message }, 500, CORS);
      return json({ ok: true, id: res.id, code }, 200, CORS);
    }

    /* ---------- List resellers + attributed sales ---------- */
    const rs = await stripe(E, "GET", "/v1/customers/search?query=" + encodeURIComponent("metadata['joolt_kind']:'reseller'") + "&limit=100");
    const resellers = (rs.data || []).map(c => {
      const m = c.metadata || {};
      return {
        id: c.id,
        name: c.name || m.joolt_brand_name || m.joolt_code || "",
        code: m.joolt_code || "",
        commission: parseInt(m.joolt_commission || "25", 10),
        brand: {
          name: m.joolt_brand_name || "", primary: m.joolt_brand_primary || "", accent: m.joolt_brand_accent || "",
          logo: m.joolt_brand_logo || "", tagline: m.joolt_brand_tagline || "", poweredBy: m.joolt_brand_powered === "1",
          domain: m.joolt_brand_domain || "", support: m.joolt_brand_support || ""
        }
      };
    });

    // attribution: completed/paid checkout sessions grouped by client_reference_id
    const sess = await stripe(E, "GET", "/v1/checkout/sessions?limit=100");
    const byCode = {};
    (sess.data || []).forEach(s => {
      const ref = (s.client_reference_id || "").toLowerCase();
      if (!ref) return;
      const paid = s.payment_status === "paid" || s.status === "complete";
      if (!paid) return;
      const amt = s.amount_total || 0;
      if (!byCode[ref]) byCode[ref] = { gross: 0, count: 0 };
      byCode[ref].gross += amt; byCode[ref].count += 1;
    });

    resellers.forEach(r => {
      const a = byCode[r.code] || { gross: 0, count: 0 };
      r.grossCents = a.gross;
      r.salesCount = a.count;
      r.commissionCents = Math.round(a.gross * r.commission / 100);
    });

    return json({ ok: true, resellers, generatedAt: Date.now() }, 200, CORS);
  } catch (e) {
    return json({ error: String(e) }, 500, CORS);
  }
}
