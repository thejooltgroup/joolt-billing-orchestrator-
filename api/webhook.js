import { handleWebhook } from "./_lib.js";

export const config = { runtime: "edge" };

export default async function handler(request) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  return handleWebhook(request);
}
