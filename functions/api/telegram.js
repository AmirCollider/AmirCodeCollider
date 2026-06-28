// ==========================================
// Telegram Webhook — POST /api/telegram
// AmirCollider Games — amircodecollider
// Admin-only management bot. Handles commands and
// inline-button taps to browse projects, change
// status, delete, and block/unblock senders.
// Requires KV binding PROJECTS and env vars:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (or AmirCollider),
//   TELEGRAM_WEBHOOK_SECRET
// ==========================================

// ==========================================
// Config
// ==========================================
const PAGE = 8;
const MAX_DETAILS = 3500;

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
// KV helpers
// ==========================================
async function getIndex(KV) { return (await KV.get("__index", { type: "json" })) || []; }
async function setIndex(KV, arr) { await KV.put("__index", JSON.stringify(arr)); }
async function getBlocked(KV) { return (await KV.get("__blocked", { type: "json" })) || []; }
async function setBlocked(KV, arr) { await KV.put("__blocked", JSON.stringify(arr)); }
async function getProject(KV, id) { return await KV.get("project:" + id, { type: "json" }); }

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
  const idx = await getIndex(ctx.KV);
  const blk = await getBlocked(ctx.KV);
  const c = { new: 0, active: 0, done: 0 };
  for (const it of idx) if (c[it.status] != null) c[it.status]++;

  const text = [
    "📂 <b>Project manager</b>",
    "",
    `🆕 New: <b>${c.new}</b>`,
    `🚧 In progress: <b>${c.active}</b>`,
    `✅ Completed: <b>${c.done}</b>`,
    `🚫 Blocked: <b>${blk.length}</b>`,
  ].join("\n");

  const kb = { inline_keyboard: [
    [{ text: `🆕 New (${c.new})`, callback_data: "l:new:0" }, { text: `🚧 In progress (${c.active})`, callback_data: "l:active:0" }],
    [{ text: `✅ Completed (${c.done})`, callback_data: "l:done:0" }],
    [{ text: `🚫 Blocked (${blk.length})`, callback_data: "m:blocked:0" }],
  ] };
  await sendOrEdit(ctx, chatId, text, kb, ref);
}

// ==========================================
// sendList — paginated list of projects for a status
// ==========================================
async function sendList(ctx, chatId, status, page, ref) {
  if (!STATUS[status]) status = "new";
  const idx = await getIndex(ctx.KV);
  const items = idx.filter((it) => it.status === status);
  const st = STATUS[status];
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  page = Math.min(Math.max(0, page || 0), pages - 1);
  const slice = items.slice(page * PAGE, (page + 1) * PAGE);

  const rows = slice.map((it) => [{
    text: `${STATUS[it.status].emoji} ${trunc(it.name, 18)} · ${trunc(it.project_type, 16)}`,
    callback_data: `v:${it.id}`,
  }]);

  const nav = [];
  if (page > 0) nav.push({ text: "‹ Prev", callback_data: `l:${status}:${page - 1}` });
  if (page < pages - 1) nav.push({ text: "Next ›", callback_data: `l:${status}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🏠 Menu", callback_data: "home" }]);

  const text = items.length
    ? `${st.emoji} <b>${st.label}</b> — ${items.length} total\nPage ${page + 1}/${pages}`
    : `${st.emoji} <b>${st.label}</b>\n\nNothing here yet.`;
  await sendOrEdit(ctx, chatId, text, { inline_keyboard: rows }, ref);
}

// ==========================================
// sendDetail — one project with its action buttons
// ==========================================
async function sendDetail(ctx, chatId, id, ref) {
  const p = await getProject(ctx.KV, id);
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
  const blocked = await getBlocked(ctx.KV);
  const pages = Math.max(1, Math.ceil(blocked.length / PAGE));
  page = Math.min(Math.max(0, page || 0), pages - 1);
  const slice = blocked.slice(page * PAGE, (page + 1) * PAGE);

  const rows = slice.map((b) => [{
    text: `✖ ${trunc(b.method, 10)} · ${trunc(b.handle, 20)}`,
    callback_data: `ub:${b.bid}`,
  }]);

  const nav = [];
  if (page > 0) nav.push({ text: "‹ Prev", callback_data: `m:blocked:${page - 1}` });
  if (page < pages - 1) nav.push({ text: "Next ›", callback_data: `m:blocked:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🏠 Menu", callback_data: "home" }]);

  const text = blocked.length
    ? `🚫 <b>Blocked senders</b> — ${blocked.length}\nTap an entry to unblock. Page ${page + 1}/${pages}`
    : "🚫 <b>Blocked senders</b>\n\nNo one is blocked.";
  await sendOrEdit(ctx, chatId, text, { inline_keyboard: rows }, ref);
}

// ==========================================
// setStatus — change a project's status
// ==========================================
async function setStatus(ctx, id, status) {
  const p = await getProject(ctx.KV, id);
  if (!p || !STATUS[status]) return null;
  p.status = status;
  await ctx.KV.put("project:" + id, JSON.stringify(p));
  const idx = await getIndex(ctx.KV);
  const e = idx.find((it) => it.id === id);
  if (e) e.status = status;
  await setIndex(ctx.KV, idx);
  return p;
}

// ==========================================
// deleteProject — remove project + its index entry + card
// ==========================================
async function deleteProject(ctx, id) {
  const p = await getProject(ctx.KV, id);
  await ctx.KV.delete("project:" + id);
  const idx = (await getIndex(ctx.KV)).filter((it) => it.id !== id);
  await setIndex(ctx.KV, idx);
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
  const blocked = await getBlocked(ctx.KV);
  if (!blocked.some((b) => b.norm === norm)) {
    blocked.unshift({ bid: shortId(), method: p.contact_method, handle: p.contact_handle, norm, at: new Date().toISOString() });
    await setBlocked(ctx.KV, blocked);
    await ctx.KV.put("blocknorm:" + norm, "1");
  }
}

// ==========================================
// unblock — remove a blocklist entry by bid
// ==========================================
async function unblock(ctx, bid) {
  const blocked = await getBlocked(ctx.KV);
  const b = blocked.find((x) => x.bid === bid);
  if (b) {
    await ctx.KV.delete("blocknorm:" + b.norm);
    await setBlocked(ctx.KV, blocked.filter((x) => x.bid !== bid));
  }
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
  const text = String(msg.text || "").trim().toLowerCase();
  if (text === "/active") return sendList(ctx, chatId, "active", 0, null);
  if (text === "/done")   return sendList(ctx, chatId, "done", 0, null);
  if (text === "/new" || text === "/projects") return sendList(ctx, chatId, "new", 0, null);
  if (text === "/blocked") return sendBlocked(ctx, chatId, 0, null);
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
    const p = await getProject(ctx.KV, parts[1]);
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
    const p = await getProject(ctx.KV, parts[1]);
    const who = p ? `${esc(p.contact_method)} · ${esc(p.contact_handle)}` : parts[1];
    await sendOrEdit(ctx, chatId, `🚫 Block <b>${who}</b>?\nFuture requests from this contact are dropped silently.`, confirmKb(`blkok:${parts[1]}`, `v:${parts[1]}`), ref);
    return answer(ctx.token, cq.id);
  }
  if (op === "blkok") {
    const p = await getProject(ctx.KV, parts[1]);
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
  const KV = env.PROJECTS;

  // Verify Telegram's secret header
  if (secret && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  if (!token || !KV) return new Response("ok");

  let update;
  try { update = await request.json(); } catch (_) { return new Response("ok"); }

  const ctx = { token, adminId, KV };
  try {
    if (update.callback_query) await handleCallback(update.callback_query, ctx);
    else if (update.message)   await handleMessage(update.message, ctx);
  } catch (_) {}

  return new Response("ok");
}
