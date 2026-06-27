// ==========================================
// Order Endpoint — POST /api/order
// AmirCollider Games — amircodecollider
// Receives a website-build request and forwards it to
// Telegram with a clean, professional message card.
// Token + chat id live in Cloudflare env vars, never
// in the browser.
// ==========================================

// ==========================================
// Config
// ==========================================
const MAX_FIELD = 1500;          // hard cap per field (chars)
const MAX_DETAILS = 3500;        // details may be longer
const TG_TIMEOUT_MS = 10000;     // abort Telegram call after 10s

// ==========================================
// escapeHtml — neutralize input for Telegram HTML parse mode
// ==========================================
function escapeHtml(value, limit) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, limit || MAX_FIELD);
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
// shortId — readable, ambiguity-free request id
// ==========================================
function shortId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

// ==========================================
// fmtTime — human-readable Tehran timestamp
// ==========================================
function fmtTime(date) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tehran",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

// ==========================================
// buildKeyboard — one-tap reply button for the dev
// (Telegram inline buttons require http/https URLs)
// ==========================================
function buildKeyboard(method, handle) {
  const raw = String(handle || "").trim().replace(/^@/, "");
  if (!raw) return null;

  let url = null;
  let label = null;

  if (method === "Telegram" && /^[A-Za-z0-9_]{3,}$/.test(raw)) {
    url = "https://t.me/" + raw;
    label = "💬 Open Telegram";
  } else if (method === "Instagram") {
    const user = raw
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
      .replace(/\/+$/, "");
    if (/^[A-Za-z0-9_.]{1,30}$/.test(user)) {
      url = "https://instagram.com/" + user;
      label = "📷 Open Instagram";
    }
  }

  if (!url) return null;
  return { inline_keyboard: [[{ text: label, url }]] };
}

// ==========================================
// onRequestPost — main handler
// ==========================================
export async function onRequestPost(context) {
  const { request, env } = context;

  // Required secrets.
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

  // Request metadata (Cloudflare edge)
  const id = shortId();
  const time = fmtTime(new Date());
  const cf = request.cf || {};
  const ip = request.headers.get("CF-Connecting-IP") || "—";
  const country = request.headers.get("CF-IPCountry") || cf.country || "—";
  const city = cf.city || "—";

  // Build the Telegram message card
  const lines = [
    `🌐 <b>New project request</b>  ·  <code>#${id}</code>`,
    "",
    `👤 <b>Name</b> — ${escapeHtml(data.name)}`,
    `📦 <b>Project</b> — ${escapeHtml(data.project_type)}`,
    `💰 <b>Budget</b> — ${escapeHtml(data.budget || "—")}`,
    `⏱ <b>Timeline</b> — ${escapeHtml(data.timeline || "—")}`,
    `📨 <b>Contact</b> — ${escapeHtml(data.contact_method)} · ${escapeHtml(data.contact_handle)}`,
    "",
    "📝 <b>Details</b>",
    escapeHtml(data.details, MAX_DETAILS),
    "",
    "————————————————",
    `🌍 ${escapeHtml(city)}, ${escapeHtml(country)}  ·  <code>${escapeHtml(ip)}</code>`,
    `🕒 ${escapeHtml(time)} (Tehran)`,
    "🔗 <i>via amircodecollider</i>",
  ];
  const text = lines.join("\n");

  // Payload (+ optional one-tap reply button)
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  const keyboard = buildKeyboard(data.contact_method, data.contact_handle);
  if (keyboard) payload.reply_markup = keyboard;

  // Send to Telegram (with timeout)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!tgRes.ok) {
      return json({ ok: false, error: "Could not deliver the message." }, 502);
    }
    return json({ ok: true, id });
  } catch (_) {
    return json({ ok: false, error: "Delivery failed." }, 502);
  } finally {
    clearTimeout(timer);
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
