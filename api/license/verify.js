import { handleLicenseVerify } from "../_lib.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  return handleLicenseVerify(request);
}
