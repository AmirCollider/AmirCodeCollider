// ==========================================
// Telegram Webhook — POST /api/telegram
// AmirCollider Games — amircodecollider
// Admin-only management bot backed by a D1 database.
// Self-creates its schema, self-registers its slash
// commands, and handles commands + inline-button taps
// to browse projects, change status, delete, and
// block/unblock senders.
// Bindings: D1 database "DB".
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (or AmirCollider),
//      TELEGRAM_WEBHOOK_SECRET
// ==========================================

// ==========================================
// Config
// ==========================================
const PAGE = 8;
const MAX_DETAILS = 3500;
const CMD_VER = "1"; // bump to force command re-registration

const STATUS = {
  new:    { emoji: "🆕", label: "New" },
  active: { emoji: "🚧", label: "In progress" },
  done:   { emoji: "✅", label: "Completed" },
};

// ==========================================
// escapeHtml — neutralize text for HTML parse mode
// ==========================================
function esc(value, limit) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, limit || 1500);
}

// ==========================================
// trunc — shorten button labels
// ==========================================
function trunc(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ==========================================
// shortId — readable id for block entries
// ==========================================
function shortId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

// ==========================================
// normContact — stable key for a sender
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
// tg — call a Telegram Bot API method
// ==========================================
async function tg(token, method, body) {
  try {
    return await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (_) {
    return null;
  }
}

// ==========================================
// answer — stop the button spinner (optional toast)
// ==========================================
async function answer(token, id, text) {
  await tg(token, "answerCallbackQuery", text ? { callback_query_id: id, text } : { callback_query_id: id });
}

// ==========================================
// sendOrEdit — post a new message, or edit one in place
// ==========================================
async function sendOrEdit(ctx, chatId, text, kb, ref) {
  if (ref) {
    await tg(ctx.token, "editMessageText", {
      chat_id: ref.chat_id, message_id: ref.message_id,
      text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb,
    });
  } else {
    await tg(ctx.token, "sendMessage", {
      chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb,
    });
  }
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
// setCommands — register the slash-command menu
// ==========================================
async function setCommands(token) {
  await tg(token, "setMyCommands", {
    commands: [
      { command: "menu",     description: "Open the project manager" },
      { command: "projects", description: "New requests" },
      { command: "active",   description: "In progress" },
      { command: "done",     description: "Completed" },
      { command: "blocked",  description: "Blocked senders" },
    ],
  });
}

// ==========================================
// ensureCommands — register commands once per version
// ==========================================
async function ensureCommands(ctx) {
  try {
    const row = await ctx.DB.prepare("SELECT value FROM meta WHERE key='cmd_ver'").first();
    if (!row || row.value !== CMD_VER) {
      await setCommands(ctx.token);
      await ctx.DB.prepare(
        "INSERT INTO meta (key,value) VALUES ('cmd_ver',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      ).bind(CMD_VER).run();
    }
  } catch (_) {}
}

// ==========================================
// getProject — one row by id
// ==========================================
async function getProject(DB, id) {
  return await DB.prepare("SELECT * FROM projects WHERE id=?").bind(id).first();
}

// ==========================================
// projectText — full project card
// ==========================================
function projectText(p) {
  const st = STATUS[p.status] || STATUS.new;
  return [
    `${st.emoji} <b>#${p.id}</b> · <i>${st.label}</i>`,
    "",
    `👤 <b>Name</b> — ${esc(p.name)}`,
    `📦 <b>Project</b> — ${esc(p.project_type)}`,
    `💰 <b>Budget</b> — ${esc(p.budget || "—")}`,
    `⏱ <b>Timeline</b> — ${esc(p.timeline || "—")}`,
    `📨 <b>Contact</b> — ${esc(p.contact_method)} · ${esc(p.contact_handle)}`,
    "",
    "📝 <b>Details</b>",
    esc(p.details, MAX_DETAILS),
    "",
    "————————————————",
    `🌍 ${esc(p.origin || "—")}`,
    `🕒 ${esc(p.created_h || "—")} (Tehran)`,
  ].join("\n");
}

// ==========================================
// projectKeyboard — management actions
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
// confirmKb — yes / cancel
// ==========================================
function confirmKb(yes, no) {
  return { inline_keyboard: [[{ text: "✅ Yes", callback_data: yes }, { text: "✖ Cancel", callback_data: no }]] };
}

// ==========================================
// sendMenu — main management menu (with live counts)
// ==========================================
async function sendMenu(ctx, chatId, ref) {
  const counts = { new: 0, active: 0, done: 0 };
  const rs = await ctx.DB.prepare("SELECT status, COUNT(*) AS c FROM projects GROUP BY status").all();
  for (const r of (rs.results || [])) if (counts[r.status] != null) counts[r.status] = r.c;
  const blk = (await ctx.DB.prepare("SELECT COUNT(*) AS c FROM blocked").first()).c;

  const text = [
    "📂 <b>Project manager</b>",
    "",
    `🆕 New: <b>${counts.new}</b>`,
    `🚧 In progress: <b>${counts.active}</b>`,
    `✅ Completed: <b>${counts.done}</b>`,
    `🚫 Blocked: <b>${blk}</b>`,
  ].join("\n");

  const kb = { inline_keyboard: [
    [{ text: `🆕 New (${counts.new})`, callback_data: "l:new:0" }, { text: `🚧 In progress (${counts.active})`, callback_data: "l:active:0" }],
    [{ text: `✅ Completed (${counts.done})`, callback_data: "l:done:0" }],
    [{ text: `🚫 Blocked (${blk})`, callback_data: "m:blocked:0" }],
  ] };
  await sendOrEdit(ctx, chatId, text, kb, ref);
}

// ==========================================
// sendList — paginated list of projects for a status
// ==========================================
async function sendList(ctx, chatId, status, page, ref) {
  if (!STATUS[status]) status = "new";
  const st = STATUS[status];
  const total = (await ctx.DB.prepare("SELECT COUNT(*) AS c FROM projects WHERE status=?").bind(status).first()).c;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  page = Math.min(Math.max(0, page || 0), pages - 1);

  const rs = await ctx.DB.prepare(
    "SELECT id,name,project_type,status FROM projects WHERE status=? ORDER BY created DESC LIMIT ? OFFSET ?"
  ).bind(status, PAGE, page * PAGE).all();

  const rows = (rs.results || []).map((it) => [{
    text: `${STATUS[it.status].emoji} ${trunc(it.name, 18)} · ${trunc(it.project_type, 16)}`,
    callback_data: `v:${it.id}`,
  }]);

  const nav = [];
  if (page > 0) nav.push({ text: "‹ Prev", callback_data: `l:${status}:${page - 1}` });
  if (page < pages - 1) nav.push({ text: "Next ›", callback_data: `l:${status}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🏠 Menu", callback_data: "home" }]);

  const text = total
    ? `${st.emoji} <b>${st.label}</b> — ${total} total\nPage ${page + 1}/${pages}`
    : `${st.emoji} <b>${st.label}</b>\n\nNothing here yet.`;
  await sendOrEdit(ctx, chatId, text, { inline_keyboard: rows }, ref);
}

// ==========================================
// sendDetail — one project with its action buttons
// ==========================================
async function sendDetail(ctx, chatId, id, ref) {
  const p = await getProject(ctx.DB, id);
  if (!p) {
    await sendOrEdit(ctx, chatId, "⚠️ That project no longer exists.",
      { inline_keyboard: [[{ text: "🏠 Menu", callback_data: "home" }]] }, ref);
    return;
  }
  await sendOrEdit(ctx, chatId, projectText(p), projectKeyboard(p), ref);
}

// ==========================================
// sendBlocked — paginated blocklist (tap to unblock)
// ==========================================
async function sendBlocked(ctx, chatId, page, ref) {
  const total = (await ctx.DB.prepare("SELECT COUNT(*) AS c FROM blocked").first()).c;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  page = Math.min(Math.max(0, page || 0), pages - 1);

  const rs = await ctx.DB.prepare(
    "SELECT bid,method,handle FROM blocked ORDER BY at DESC LIMIT ? OFFSET ?"
  ).bind(PAGE, page * PAGE).all();

  const rows = (rs.results || []).map((b) => [{
    text: `✖ ${trunc(b.method, 10)} · ${trunc(b.handle, 20)}`,
    callback_data: `ub:${b.bid}`,
  }]);

  const nav = [];
  if (page > 0) nav.push({ text: "‹ Prev", callback_data: `m:blocked:${page - 1}` });
  if (page < pages - 1) nav.push({ text: "Next ›", callback_data: `m:blocked:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🏠 Menu", callback_data: "home" }]);

  const text = total
    ? `🚫 <b>Blocked senders</b> — ${total}\nTap an entry to unblock. Page ${page + 1}/${pages}`
    : "🚫 <b>Blocked senders</b>\n\nNo one is blocked.";
  await sendOrEdit(ctx, chatId, text, { inline_keyboard: rows }, ref);
}

// ==========================================
// setStatus — change a project's status
// ==========================================
async function setStatus(ctx, id, status) {
  if (!STATUS[status]) return null;
  await ctx.DB.prepare("UPDATE projects SET status=? WHERE id=?").bind(status, id).run();
  return await getProject(ctx.DB, id);
}

// ==========================================
// deleteProject — remove project row + its posted card
// ==========================================
async function deleteProject(ctx, id) {
  const p = await getProject(ctx.DB, id);
  await ctx.DB.prepare("DELETE FROM projects WHERE id=?").bind(id).run();
  if (p && p.chat_id && p.message_id) {
    await tg(ctx.token, "deleteMessage", { chat_id: p.chat_id, message_id: p.message_id });
  }
  return p;
}

// ==========================================
// blockSender — block this project's contact
// ==========================================
async function blockSender(ctx, p) {
  const norm = normContact(p.contact_method, p.contact_handle);
  await ctx.DB.prepare(
    "INSERT OR IGNORE INTO blocked (bid,method,handle,norm,at) VALUES (?,?,?,?,?)"
  ).bind(shortId(), p.contact_method, p.contact_handle, norm, new Date().toISOString()).run();
}

// ==========================================
// unblock — remove a blocklist entry by bid
// ==========================================
async function unblock(ctx, bid) {
  await ctx.DB.prepare("DELETE FROM blocked WHERE bid=?").bind(bid).run();
}

// ==========================================
// handleMessage — slash commands
// ==========================================
async function handleMessage(msg, ctx) {
  const chatId = String(msg.chat && msg.chat.id);
  if (chatId !== ctx.adminId) {
    await tg(ctx.token, "sendMessage", { chat_id: chatId, text: "🔒 This is a private management bot." });
    return;
  }
  const raw = String(msg.text || "").trim();
  const cmd = raw.split(/\s+/)[0].split("@")[0].toLowerCase();

  if (cmd === "/setup") {
    await setCommands(ctx.token);
    await tg(ctx.token, "sendMessage", { chat_id: chatId, text: "✅ Commands registered. Use the ☰ menu or type /projects." });
    return;
  }
  if (cmd === "/active") return sendList(ctx, chatId, "active", 0, null);
  if (cmd === "/done")   return sendList(ctx, chatId, "done", 0, null);
  if (cmd === "/new" || cmd === "/projects") return sendList(ctx, chatId, "new", 0, null);
  if (cmd === "/blocked") return sendBlocked(ctx, chatId, 0, null);
  return sendMenu(ctx, chatId, null);
}

// ==========================================
// handleCallback — inline-button router
// ==========================================
async function handleCallback(cq, ctx) {
  const chatId = String(cq.message && cq.message.chat && cq.message.chat.id);
  const fromId = String(cq.from && cq.from.id);
  if (chatId !== ctx.adminId && fromId !== ctx.adminId) {
    return answer(ctx.token, cq.id, "🔒 Not authorized");
  }
  const ref = { chat_id: chatId, message_id: cq.message.message_id };
  const parts = String(cq.data || "").split(":");
  const op = parts[0];

  if (op === "home") { await sendMenu(ctx, chatId, ref); return answer(ctx.token, cq.id); }
  if (op === "l")    { await sendList(ctx, chatId, parts[1], parseInt(parts[2] || "0", 10), ref); return answer(ctx.token, cq.id); }
  if (op === "v")    { await sendDetail(ctx, chatId, parts[1], ref); return answer(ctx.token, cq.id); }
  if (op === "m" && parts[1] === "blocked") { await sendBlocked(ctx, chatId, parseInt(parts[2] || "0", 10), ref); return answer(ctx.token, cq.id); }

  if (op === "s") {
    const p = await setStatus(ctx, parts[2], parts[1]);
    if (p) { await sendOrEdit(ctx, chatId, projectText(p), projectKeyboard(p), ref); return answer(ctx.token, cq.id, `→ ${STATUS[parts[1]].label}`); }
    return answer(ctx.token, cq.id, "Gone");
  }

  if (op === "delc") {
    const p = await getProject(ctx.DB, parts[1]);
    const name = p ? esc(p.name) : parts[1];
    await sendOrEdit(ctx, chatId, `🗑 Delete <b>${name}</b>?\nThis cannot be undone.`, confirmKb(`delok:${parts[1]}`, `v:${parts[1]}`), ref);
    return answer(ctx.token, cq.id);
  }
  if (op === "delok") {
    await deleteProject(ctx, parts[1]);
    await sendMenu(ctx, chatId, ref);
    return answer(ctx.token, cq.id, "🗑 Deleted");
  }

  if (op === "blkc") {
    const p = await getProject(ctx.DB, parts[1]);
    const who = p ? `${esc(p.contact_method)} · ${esc(p.contact_handle)}` : parts[1];
    await sendOrEdit(ctx, chatId, `🚫 Block <b>${who}</b>?\nFuture requests from this contact are dropped silently.`, confirmKb(`blkok:${parts[1]}`, `v:${parts[1]}`), ref);
    return answer(ctx.token, cq.id);
  }
  if (op === "blkok") {
    const p = await getProject(ctx.DB, parts[1]);
    if (p) await blockSender(ctx, p);
    await sendDetail(ctx, chatId, parts[1], ref);
    return answer(ctx.token, cq.id, "🚫 Blocked");
  }

  if (op === "ub") {
    await unblock(ctx, parts[1]);
    await sendBlocked(ctx, chatId, 0, ref);
    return answer(ctx.token, cq.id, "Unblocked");
  }

  return answer(ctx.token, cq.id);
}

// ==========================================
// onRequestPost — webhook entry
// ==========================================
export async function onRequestPost(context) {
  const { request, env } = context;
  const token = env.TELEGRAM_BOT_TOKEN;
  const adminId = String(env.TELEGRAM_CHAT_ID || env.AmirCollider || "");
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  const DB = env.DB;

  // Verify Telegram's secret header
  if (secret && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  if (!token) return new Response("ok");

  let update;
  try { update = await request.json(); } catch (_) { return new Response("ok"); }

  const ctx = { token, adminId, DB };

  // If the database is not bound yet, tell the admin and stop
  if (!DB) {
    try {
      const m = update.message || (update.callback_query && update.callback_query.message);
      const cid = m && m.chat ? String(m.chat.id) : adminId;
      if (cid === adminId) {
        await tg(token, "sendMessage", { chat_id: cid, text: "⚠️ Database not connected. Bind a D1 database as <b>DB</b> in Pages → Settings → Bindings, then redeploy.", parse_mode: "HTML" });
      }
    } catch (_) {}
    return new Response("ok");
  }

  try {
    await ensureSchema(DB);
    await ensureCommands(ctx);
    if (update.callback_query) await handleCallback(update.callback_query, ctx);
    else if (update.message)   await handleMessage(update.message, ctx);
  } catch (_) {}

  return new Response("ok");
}

// ==========================================
// onRequestGet — health probe (open this in a browser)
// ==========================================
export async function onRequestGet(context) {
  const { env } = context;
  const adminId = String(env.TELEGRAM_CHAT_ID || env.AmirCollider || "");
  const body = {
    ok: true,
    service: "telegram-webhook",
    deployed: true,
    has_token: !!env.TELEGRAM_BOT_TOKEN,
    has_db: !!env.DB,
    has_secret: !!env.TELEGRAM_WEBHOOK_SECRET,
    admin_set: adminId.length > 0,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
