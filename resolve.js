import { stripe, env, json, CORS } from "../_lib.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  const E = env();
  const url = new URL(request.url);
  const sid = url.searchParams.get("session_id") || "";
  if (!sid.startsWith("cs_")) {
    return json({ error: "invalid_session_id" }, 400, CORS);
  }
  const session = await stripe(E, "GET", "/v1/checkout/sessions/" + encodeURIComponent(sid));
  if (session.error) {
    return json({ error: session.error.message || "lookup_failed" }, 500, CORS);
  }
  return json({
    customer: session.customer || null,
    sku: (session.metadata && session.metadata.sku) || null,
    email: (session.customer_details && session.customer_details.email) || null,
    status: session.status
  }, 200, CORS);
}
