import { handleLicenseVerify, stripe, env, json, CORS } from "../_lib.js";

export const config = { runtime: "edge" };

const MAX_DEVICES = 2;

export default async function handler(request) {
  const res = await handleLicenseVerify(request);

  // Additive + fail-open: any error returns the original response.
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    const device = url.searchParams.get("device") || "";
    if (!key.startsWith("cus_")) return res;

    const data = await res.clone().json();
    if (!data || data.valid !== true) return res;
    if (data.tier === "master" || data.tier === "pilot") return res;

    const E = env();
    const cust = await stripe(E, "GET", `/v1/customers/${key}`);
    if (cust.error) return res;
    const meta = cust.metadata || {};

    // ---- admin suspend / revoke (blocks access regardless of billing state) ----
    const admStatus = (meta.joolt_status || "").toLowerCase();
    if (admStatus === "suspended" || admStatus === "revoked") {
      return json({
        valid: false,
        status: admStatus,
        tier: data.tier,
        reason: admStatus === "suspended"
          ? "This license is suspended. Contact admin@thejooltgroup.com."
          : "This license has been revoked.",
        serverTime: Date.now()
      }, 200, CORS);
    }

    // ---- device lock ----
    let devices = [];
    try { devices = JSON.parse(meta.joolt_devices || "[]"); } catch (e) {}
    if (!Array.isArray(devices)) devices = [];
    const now = Date.now();
    let dirty = false, seatLimit = false;
    if (device) {
      const found = devices.find(d => d && d.id === device);
      if (found) {
        if (!found.lastSeen || now - found.lastSeen > 6 * 3600 * 1000) { found.lastSeen = now; dirty = true; }
      } else if (devices.length < MAX_DEVICES) {
        devices.push({ id: device, firstSeen: now, lastSeen: now }); dirty = true;
      } else {
        seatLimit = true;
      }
    }

    // ---- usage snapshot ----
    let usage = {};
    try { usage = JSON.parse(meta.joolt_usage || "{}") || {}; } catch (e) { usage = {}; }
    let incoming = null;
    try { const raw = url.searchParams.get("u"); if (raw) incoming = JSON.parse(raw); } catch (e) {}
    if (incoming && typeof incoming === "object") {
      const merged = Object.assign({}, usage, incoming);
      if (usage.fs && incoming.fs) merged.fs = Math.min(usage.fs, incoming.fs);
      const stale = !usage.ls || (now - usage.ls > 6 * 3600 * 1000);
      const changed = usage.jobs !== incoming.jobs || usage.tour !== incoming.tour ||
                      usage.conn !== incoming.conn || usage.cver !== incoming.cver ||
                      usage.live !== incoming.live || usage.contacts !== incoming.contacts;
      if (stale || changed) { usage = merged; dirty = true; }
    }

    if (dirty && !seatLimit) {
      const p = new URLSearchParams();
      p.set("metadata[joolt_devices]", JSON.stringify(devices.slice(0, 8)));
      if (usage && usage.v) p.set("metadata[joolt_usage]", JSON.stringify(usage));
      try { await stripe(E, "POST", `/v1/customers/${key}`, p); } catch (e) {}
    }

    if (seatLimit) {
      return json({
        valid: false, status: "seat_limit", tier: data.tier, expiresAt: data.expiresAt,
        reason: "This license is already active on " + MAX_DEVICES + " devices. Release one from your JOOLT dashboard, or email admin@thejooltgroup.com.",
        devices: devices.length, deviceLimit: MAX_DEVICES, serverTime: Date.now()
      }, 200, CORS);
    }
    return res;
  } catch (e) {
    return res; // fail-open
  }
}
