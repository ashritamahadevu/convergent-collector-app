// DrawBridge waitlist endpoint (Vercel serverless function).
// Stores signups in Upstash Redis via its REST API. Connect a store in
// Vercel > Storage > Upstash for Redis; it sets KV_REST_API_URL / KV_REST_API_TOKEN.
//   POST /api/waitlist  { email, role?, school? }  -> { ok, already }
//   GET  /api/waitlist                              -> { count }

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const ROLES = new Set(["cs-student", "educator", "developer", "other", ""]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function redis(...commands) {
  const res = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return res.json();
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) {
    return res.status(503).json({ error: "not_configured" });
  }

  try {
    if (req.method === "GET") {
      const [{ result }] = await redis(["SCARD", "waitlist:emails"]);
      return res.status(200).json({ count: result || 0 });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const body = readBody(req);
    if (body.website) return res.status(200).json({ ok: true }); // honeypot: bots fill this
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const role = ROLES.has(body.role) ? body.role : "";
    const school = String(body.school || "").trim().slice(0, 120);
    const source = String(body.source || "").trim().slice(0, 40);

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }

    const [{ result: added }] = await redis(
      ["SADD", "waitlist:emails", email],
      ["HSETNX", `waitlist:entry:${email}`, "joined", new Date().toISOString()],
      ["HSET", `waitlist:entry:${email}`, "email", email, ...(role ? ["role", role] : []), ...(school ? ["school", school] : []), ...(source ? ["source", source] : [])]
    );

    return res.status(200).json({ ok: true, already: added === 0 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server_error" });
  }
};
