export const config = { runtime: "edge" };

export default async function handler(request) {
  return new Response(JSON.stringify({ ok: true, time: Date.now() }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
