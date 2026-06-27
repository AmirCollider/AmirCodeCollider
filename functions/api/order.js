// ==========================================
// Order Endpoint — POST /api/order
// AmirCollider — amircodecollider
// Receives a website-build request and forwards
// it to the Telegram bot. Token + chat id live in
// Cloudflare env vars, never in the browser.
// ==========================================

// ==========================================
// escapeHtml — neutralize input for Telegram HTML parse mode
// ==========================================
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 1500);
}

// ==========================================
// json — small response helper
// ==========================================
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ==========================================
// onRequestPost — main handler
// ==========================================
export async function onRequestPost(context) {
  const { request, env } = context;

  // Required secrets
  // Chat id accepts TELEGRAM_CHAT_ID (preferred) or the legacy "AmirCollider" var.
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID || env.AmirCollider;
  if (!token || !chatId) {
    return json({ ok: false, error: "Server not configured." }, 500);
  }

  // Parse body
  let data;
  try {
    data = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  // Honeypot — real users leave this empty
  if (data.company && String(data.company).trim() !== "") {
    return json({ ok: true }); // silently accept, send nothing
  }

  // Validate required fields
  const required = ["name", "contact_method", "contact_handle", "project_type", "details"];
  for (const key of required) {
    if (!String(data[key] || "").trim()) {
      return json({ ok: false, error: "Missing required fields." }, 400);
    }
  }

  // Build the Telegram message
  const lines = [
    "🌐 <b>New website request</b>",
    "———————————————",
    `👤 <b>Name:</b> ${escapeHtml(data.name)}`,
    `📦 <b>Project:</b> ${escapeHtml(data.project_type)}`,
    `💰 <b>Budget:</b> ${escapeHtml(data.budget || "—")}`,
    `⏱️ <b>Timeline:</b> ${escapeHtml(data.timeline || "—")}`,
    `📨 <b>Contact:</b> ${escapeHtml(data.contact_method)} — ${escapeHtml(data.contact_handle)}`,
    "———————————————",
    "📝 <b>Details:</b>",
    escapeHtml(data.details),
    "———————————————",
    "<i>Sent from amircodecollider</i>",
  ];
  const text = lines.join("\n");

  // Send to Telegram
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!tgRes.ok) {
      return json({ ok: false, error: "Could not deliver the message." }, 502);
    }
    return json({ ok: true });
  } catch (_) {
    return json({ ok: false, error: "Delivery failed." }, 502);
  }
}

// ==========================================
// onRequest — reject non-POST methods cleanly
// ==========================================
export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }
  return onRequestPost(context);
}
