import { stripe, env, json } from "./_lib.js";

export const config = { runtime: "edge" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

/* Public: returns the white-label brand config for a reseller ref code.
   Fail-open to empty (JOOLT default) so the app never breaks. */
export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(request.url);
  const code = (url.searchParams.get("ref") || "").toLowerCase().replace(/[^a-z0-9\-]/g, "").slice(0, 60);
  const cacheHdr = { ...CORS, "cache-control": "public, max-age=300" };

  if (!code) return json({ ok: false, reason: "no_ref" }, 200, cacheHdr);

  try {
    const E = env();
    const q = "metadata['joolt_kind']:'reseller' AND metadata['joolt_code']:'" + code + "'";
    const found = await stripe(E, "GET", "/v1/customers/search?query=" + encodeURIComponent(q) + "&limit=1");
    const c = found.data && found.data[0];
    if (!c) return json({ ok: false, reason: "not_found" }, 200, cacheHdr);
    const m = c.metadata || {};
    return json({
      ok: true,
      code,
      name: m.joolt_brand_name || c.name || "",
      primary: m.joolt_brand_primary || "",
      accent: m.joolt_brand_accent || "",
      logo: m.joolt_brand_logo || "",
      tagline: m.joolt_brand_tagline || "",
      poweredBy: m.joolt_brand_powered === "1",
      support: m.joolt_brand_support || ""
    }, 200, cacheHdr);
  } catch (e) {
    return json({ ok: false, reason: "error" }, 200, cacheHdr);
  }
}
