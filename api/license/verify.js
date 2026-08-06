import { handleLicenseVerify, stripe, env, json, CORS } from "../_lib.js";

export const config = { runtime: "edge" };

const MAX_DEVICES = 2;

async function writeDevices(E, key, devices) {
  try {
    const p = new URLSearchParams();
    p.set("metadata[joolt_devices]", JSON.stringify(devices.slice(0, 8)));
    await stripe(E, "POST", `/v1/customers/${key}`, p);
  } catch (e) { /* fail-open */ }
}

export default async function handler(request) {
  // Core verification is unchanged.
  const res = await handleLicenseVerify(request);

  // Device-lock is additive and fail-open: any error returns the original response,
  // so a bug here can never lock out a paying customer.
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    const device = url.searchParams.get("device") || "";
    if (!device || !key.startsWith("cus_")) return res;

    const data = await res.clone().json();
    if (!data || data.valid !== true) return res;            // only enforce on otherwise-valid licenses
    if (data.tier === "master" || data.tier === "pilot") return res;

    const E = env();
    const cust = await stripe(E, "GET", `/v1/customers/${key}`);
    if (cust.error) return res;
    let devices = [];
    try { devices = JSON.parse((cust.metadata && cust.metadata.joolt_devices) || "[]"); } catch (e) { devices = []; }
    if (!Array.isArray(devices)) devices = [];

    const now = Date.now();
    const found = devices.find(d => d && d.id === device);
    if (found) {
      if (!found.lastSeen || now - found.lastSeen > 6 * 3600 * 1000) { found.lastSeen = now; await writeDevices(E, key, devices); }
      return res;                                            // known device → allowed
    }
    if (devices.length < MAX_DEVICES) {
      devices.push({ id: device, firstSeen: now, lastSeen: now });
      await writeDevices(E, key, devices);
      return res;                                            // new device within limit → registered + allowed
    }
    // Over the device limit → block this device (existing devices keep working).
    return json({
      valid: false,
      status: "seat_limit",
      tier: data.tier,
      expiresAt: data.expiresAt,
      reason: "This license is already active on " + MAX_DEVICES + " devices. Release one from your JOOLT dashboard, or email admin@thejooltgroup.com.",
      devices: devices.length,
      deviceLimit: MAX_DEVICES,
      serverTime: Date.now()
    }, 200, CORS);
  } catch (e) {
    return res; // fail-open
  }
}
