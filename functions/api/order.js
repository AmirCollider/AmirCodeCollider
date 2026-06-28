// ==========================================
// Order Endpoint — POST /api/order
// AmirCollider Games — amircodecollider
// Receives a website-build request, drops it if the
// sender is blocked, stores it in the D1 database, and
// posts a manageable card to the admin's Telegram.
// Bindings: D1 database "DB".
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (or AmirCollider).
// ==========================================

// ==========================================
// Config
// ==========================================
const MAX_FIELD = 1500;
const MAX_DETAILS = 3500;
const TG_TIMEOUT_MS = 10000;

const STATUS = {
  new:    { emoji: "🆕", label: "New" },
  active: { emoji: "🚧", label: "In progress" },
  done:   { emoji: "✅", label: "Completed" },
};

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
// shortId — readable, ambiguity-free id
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
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

// ==========================================
// normContact — stable key for blocking a sender
// ==========================================
function normContact(method, handle) {
  return String(method || "").toLowerCase().trim() + ":" +
    String(handle || "").trim().replace(/^@/, "").toLowerCase();
}

// ==========================================
// contactUrl — one-tap "open contact" button (http/https only)
// ==========================================
function contactUrl(method, handle) {
  const raw = String(handle || "").trim().replace(/^@/, "");
  if (!raw) return null;
  if (method === "Telegram" && /^[A-Za-z0-9_]{3,}$/.test(raw)) return "https://t.me/" + raw;
  if (method === "Instagram") {
    const user = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/+$/, "");
    if (/^[A-Za-z0-9_.]{1,30}$/.test(user)) return "https://instagram.com/" + user;
  }
  return null;
}

// ==========================================
// projectText — the message card (shared shape with the webhook)
// ==========================================
function projectText(p) {
  const st = STATUS[p.status] || STATUS.new;
  return [
    `${st.emoji} <b>#${p.id}</b> · <i>${st.label}</i>`,
    "",
    `👤 <b>Name</b> — ${escapeHtml(p.name)}`,
    `📦 <b>Project</b> — ${escapeHtml(p.project_type)}`,
    `💰 <b>Budget</b> — ${escapeHtml(p.budget || "—")}`,
    `⏱ <b>Timeline</b> — ${escapeHtml(p.timeline || "—")}`,
    `📨 <b>Contact</b> — ${escapeHtml(p.contact_method)} · ${escapeHtml(p.contact_handle)}`,
    "",
    "📝 <b>Details</b>",
    escapeHtml(p.details, MAX_DETAILS),
    "",
    "————————————————",
    `🌍 ${escapeHtml(p.origin || "—")}`,
    `🕒 ${escapeHtml(p.created_h || "—")} (Tehran)`,
  ].join("\n");
}

// ==========================================
// projectKeyboard — management actions (shared shape with the webhook)
// ==========================================
function projectKeyboard(p) {
  const rows = [];
  const url = contactUrl(p.contact_method, p.contact_handle);
  if (url) rows.push([{ text: "↗ Open contact", url }]);

  const sb = [];
  if (p.status !== "active") sb.push({ text: "🚧 In progress", callback_data: `s:active:${p.id}` });
  if (p.status !== "done")   sb.push({ text: "✅ Completed",   callback_data: `s:done:${p.id}` });
  if (p.status !== "new")    sb.push({ text: "🆕 New",         callback_data: `s:new:${p.id}` });
  for (let i = 0; i < sb.length; i += 2) rows.push(sb.slice(i, i + 2));

  rows.push([
    { text: "🚫 Block sender", callback_data: `blkc:${p.id}` },
    { text: "🗑 Delete",       callback_data: `delc:${p.id}` },
  ]);
  rows.push([
    { text: "⬅ List", callback_data: `l:${p.status}:0` },
    { text: "🏠 Menu", callback_data: "home" },
  ]);
  return { inline_keyboard: rows };
}

// ==========================================
// ensureSchema — create tables on first use (idempotent)
// ==========================================
async function ensureSchema(DB) {
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, contact_method TEXT, contact_handle TEXT, project_type TEXT, budget TEXT, timeline TEXT, details TEXT, status TEXT DEFAULT 'new', created TEXT, created_h TEXT, origin TEXT, chat_id TEXT, message_id INTEGER)"),
    DB.prepare("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, created DESC)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS blocked (bid TEXT PRIMARY KEY, method TEXT, handle TEXT, norm TEXT UNIQUE, at TEXT)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"),
  ]);
}

// ==========================================
// onRequestPost — main handler
// ==========================================
export async function onRequestPost(context) {
  const { request, env } = context;

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID || env.AmirCollider;
  const DB = env.DB; // optional D1 binding
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
    return json({ ok: true });
  }

  // Validate required fields
  const required = ["name", "contact_method", "contact_handle", "project_type", "details"];
  for (const key of required) {
    if (!String(data[key] || "").trim()) {
      return json({ ok: false, error: "Missing required fields." }, 400);
    }
  }

  // Block check — silently drop requests from blocked senders
  const norm = normContact(data.contact_method, data.contact_handle);
  if (DB) {
    try {
      await ensureSchema(DB);
      const hit = await DB.prepare("SELECT 1 AS x FROM blocked WHERE norm=? LIMIT 1").bind(norm).first();
      if (hit) return json({ ok: true });
    } catch (_) {}
  }

  // Build the project record
  const now = new Date();
  const cf = request.cf || {};
  const ip = request.headers.get("CF-Connecting-IP") || "—";
  const country = request.headers.get("CF-IPCountry") || cf.country || "—";
  const city = cf.city || "—";

  const p = {
    id: shortId(),
    name: String(data.name).slice(0, MAX_FIELD),
    contact_method: String(data.contact_method).slice(0, 40),
    contact_handle: String(data.contact_handle).slice(0, 200),
    project_type: String(data.project_type).slice(0, 80),
    budget: String(data.budget || "—").slice(0, 60),
    timeline: String(data.timeline || "—").slice(0, 120),
    details: String(data.details).slice(0, MAX_DETAILS),
    status: "new",
    created: now.toISOString(),
    created_h: fmtTime(now),
    origin: `${city}, ${country} · ${ip}`,
    chat_id: null,
    message_id: null,
  };

  // Compose payload — full management card when DB is bound, else a simple card
  const payload = {
    chat_id: chatId,
    text: projectText(p),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (DB) {
    payload.reply_markup = projectKeyboard(p);
  } else {
    const url = contactUrl(p.contact_method, p.contact_handle);
    if (url) payload.reply_markup = { inline_keyboard: [[{ text: "↗ Open contact", url }]] };
  }

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

    // Persist (so the menu / status / delete / block actions work)
    if (DB) {
      try {
        let result = null;
        try { result = (await tgRes.json()).result; } catch (_) {}
        if (result) { p.chat_id = String(chatId); p.message_id = result.message_id; }
        await DB.prepare(
          "INSERT INTO projects (id,name,contact_method,contact_handle,project_type,budget,timeline,details,status,created,created_h,origin,chat_id,message_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(
          p.id, p.name, p.contact_method, p.contact_handle, p.project_type,
          p.budget, p.timeline, p.details, p.status, p.created, p.created_h,
          p.origin, p.chat_id, p.message_id
        ).run();
      } catch (_) {}
    }

    return json({ ok: true, id: p.id });
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
