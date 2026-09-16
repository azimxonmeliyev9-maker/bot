/**
 * VERCEL SERVERLESS WEBHOOK ENTRY-POINT (v6.2 ES Modules & Tashkent Timezone UTC+5)
 * Node.js 20.x, @vercel/kv, Subscription Guard & Payment System
 */
import { CONFIG } from '../config.js';
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  deleteMessage,
  escapeHtml,
  formatMoney,
  formatDate,
  getTashkentToday,
  getTashkentDateStr,
  getTashkentTimeStr,
  getTashkentNowMinutes,
  getTashkentMonthKey,
  getTashkentYearKey
} from '../lib/telegram.js';
import { checkAccess } from '../lib/subscriptionGuard.js';
import {
  handleSubscriptionMenu,
  handlePaymentMethodSelect,
  handleUserPaymentConfirmation,
  handleAdminApproval,
  handleAdminRejection,
  showSubscriptionRequiredMessage
} from '../lib/paymentHandlers.js';
import { isSubActive } from '../lib/subscriptionService.js';
import { getUserAppData as getUserData, saveUserAppData as saveUserData, getDbStatus } from '../lib/storage.js';


// ─── HELPERS ──────────────────────────────────────────────────
function parseNum(s) {
  if (!s) return null;
  let str = String(s).replace(/\s/g, '').replace(/,/g, '').replace(/_/g, '');
  if (/^(\d+)k$/i.test(str)) str = str.replace(/k$/i, '000');
  const n = parseFloat(str);
  return isFinite(n) && n > 0 ? n : null;
}

function isNumericText(s) {
  return /^\d[\d\s,._k]*$/i.test(s.trim());
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

// ─── KEYBOARDS ────────────────────────────────────────────────
const KB_MAIN = {
  keyboard: [
    ['💸 Harajat Qo\'shish', '✅ Vazifa Qo\'shish'],
    ['📊 Kunlik Hisobot',    '📋 Vazifalar Ro\'yxati'],
    ['💰 Balans',            '📈 Statistika'],
    ['🗂 Harajatlar Tarixi', '💳 Obuna'],
    ['⚙️ Baza Holati']
  ],
  resize_keyboard: true,
  persistent: true
};
const KB_REMOVE = { remove_keyboard: true };

const KB_CATEGORY = {
  keyboard: [
    ['🍽 Taom/Oziq-ovqat', '🚕 Transport'],
    ['🛍 Xarid',            '💊 Sog\'liq'],
    ['💡 Kommunal',         '🎬 O\'yin-kulgi'],
    ['📦 Boshqa']
  ],
  resize_keyboard: true,
  one_time_keyboard: true
};
const KB_PRIORITY = {
  keyboard: [
    ['🔴 Juda Zarur'],
    ['🟡 Muhim'],
    ['🟢 Oddiy']
  ],
  resize_keyboard: true,
  one_time_keyboard: true
};
const KB_TIME = {
  keyboard: [
    ['⏰ 09:00', '⏰ 12:00', '⏰ 15:00'],
    ['⏰ 18:00', '⏰ 20:00', '⏰ 22:00'],
    ['📅 Vaqtsiz (eslatma yo\'q)']
  ],
  resize_keyboard: true,
  one_time_keyboard: true
};
const KB_INCOME_CAT = {
  keyboard: [
    ['💼 Oylik maosh', '🎁 Bonus'],
    ['🛒 Savdo daromadi', '📦 Boshqa kirim']
  ],
  resize_keyboard: true,
  one_time_keyboard: true
};

// ─── UI VIEWS ─────────────────────────────────────────────────
async function showBalanceView(chatId, name, u) {
  const inc = (u.incomes || []).reduce((s, i) => s + i.amount, 0);
  const exp = (u.expenses || []).reduce((s, e) => s + e.amount, 0);
  const rem = inc - exp;

  if (inc === 0) {
    await sendMessage(chatId,
      `💰 <b>Balansingiz</b>\n\n<i>Hali kirim qo'shilmagan.</i>\n\nDaromadingizni qo'shing:`,
      { reply_markup: { keyboard: [['💵 Kirim Qo\'shish'], ['💳 Menyuga qaytish']], resize_keyboard: true } }
    );
    return;
  }

  const mk = getTashkentMonthKey();
  const mExp = (u.expenses || []).filter(e => (e.dateKey || '').startsWith(mk)).reduce((s, e) => s + e.amount, 0);
  const mInc = (u.incomes || []).filter(i => (i.dateKey || '').startsWith(mk)).reduce((s, i) => s + i.amount, 0);
  const mPct = mInc > 0 ? Math.round(mExp / mInc * 100) : (inc > 0 ? Math.round(mExp / inc * 100) : 0);

  const remLine = rem >= 0
    ? `✅ <b>Qolgan:</b> <code>${formatMoney(rem)}</code>`
    : `⚠️ <b>Qolgan:</b> <code>-${formatMoney(Math.abs(rem))}</code> <i>(limit oshdi!)</i>`;

  const last = (u.incomes || []).slice(-3).reverse()
    .map(i => `• <i>${escapeHtml(i.description)}</i> — <b>${formatMoney(i.amount)}</b>`).join('\n') || '<i>Yo\'q</i>';

  await sendMessage(chatId,
    `💰 <b>BALANSINGIZ</b> — ${escapeHtml(name)}\n\n` +
    `📥 <b>Jami kirim:</b> <code>${formatMoney(inc)}</code>\n` +
    `📤 <b>Jami harajat:</b> <code>${formatMoney(exp)}</code>\n` +
    `━━━━━━━━━━━━━━━━\n${remLine}\n\n` +
    `📊 <b>Bu oy sarflandi:</b> ${formatMoney(mExp)} (${mPct}%)\n\n` +
    `💵 <b>So'nggi kirimlar:</b>\n${last}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '➕ Kirim Qo\'shish', callback_data: 'income_start' },
          { text: '🔄 Yangilash', callback_data: 'balance_refresh' }
        ]]
      }
    }
  );
}

async function showDailyReportView(chatId, name, u) {
  const td = getTashkentToday();
  const list = (u.expenses || []).filter(e => e.dateKey === td);
  const total = list.reduce((s, e) => s + e.amount, 0);
  const inc = (u.incomes || []).reduce((s, i) => s + i.amount, 0);
  const allExp = (u.expenses || []).reduce((s, e) => s + e.amount, 0);
  const rem = inc - allExp;

  let balLine = '';
  if (inc > 0) {
    balLine = rem >= 0
      ? `\n━━━━━━━━━━━━━━━━\n✅ <b>Qolgan balans:</b> <code>${formatMoney(rem)}</code>`
      : `\n━━━━━━━━━━━━━━━━\n⚠️ <b>Balans:</b> <code>-${formatMoney(Math.abs(rem))}</code>`;
  }

  if (list.length === 0) {
    await sendMessage(chatId,
      `📊 <b>KUNLIK HISOBOT</b>\n📅 ${getTashkentDateStr()} • ${escapeHtml(name)}\n\n<i>Bugun harajat yo'q.</i>${balLine}`,
      { reply_markup: KB_MAIN }
    );
    return;
  }

  await sendMessage(chatId,
    `📊 <b>KUNLIK HISOBOT</b>\n📅 ${getTashkentDateStr()} • ${escapeHtml(name)}\n\n` +
    `💸 <b>Jami:</b> <code>${formatMoney(total)}</code> • ${list.length} ta harajat${balLine}\n\n` +
    `<i>Quyidagi harajatlarni o'chirish yoki tahrirlash mumkin 👇</i>`,
    { reply_markup: KB_MAIN }
  );

  for (const e of list) {
    await sendMessage(chatId,
      `${e.time ? `🕐 <b>${e.time}</b> ` : ''}💵 <b>${formatMoney(e.amount)}</b>\n📝 ${escapeHtml(e.description)}`,
      {
        reply_markup: { inline_keyboard: [[
          { text: '🗑 O\'chirish', callback_data: `del_${e.id}` },
          { text: '✏️ Tahrirlash', callback_data: `edit_${e.id}` }
        ]]}
      }
    );
  }
}

async function showExpenseHistoryView(chatId, name, u) {
  const all = [...(u.expenses || [])].reverse();
  if (all.length === 0) {
    await sendMessage(chatId, `🗂 <b>Harajatlar tarixi bo'sh.</b>`, { reply_markup: KB_MAIN });
    return;
  }

  const byDay = {};
  all.forEach(e => {
    const k = e.dateKey || 'nodate';
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(e);
  });

  const days = Object.keys(byDay).sort().reverse().slice(0, 10);
  const totalAll = all.reduce((s, e) => s + e.amount, 0);

  await sendMessage(chatId,
    `🗂 <b>HARAJATLAR TARIXI</b>\n👤 ${escapeHtml(name)}\n` +
    `💰 Jami: <code>${formatMoney(totalAll)}</code> • ${all.length} ta\n\n` +
    `<i>So'nggi 10 kunlik harajatlar:</i>`
  );

  for (const day of days) {
    const dayList = byDay[day];
    const dayTotal = dayList.reduce((s, e) => s + e.amount, 0);
    const lbl = day === getTashkentToday() ? '📅 Bugun' : `📅 ${day}`;
    await sendMessage(chatId, `${lbl} ━━━ <b>${formatMoney(dayTotal)}</b>`);

    for (const e of dayList) {
      await sendMessage(chatId,
        `${e.time ? `🕐 ${e.time} ` : ''}💵 <b>${formatMoney(e.amount)}</b> 📝 ${escapeHtml(e.description)}`,
        {
          reply_markup: { inline_keyboard: [[
            { text: '🗑 O\'chirish', callback_data: `del_${e.id}` },
            { text: '✏️ Tahrirlash', callback_data: `edit_${e.id}` }
          ]]}
        }
      );
    }
  }
}

async function showTasksView(chatId, name, u) {
  const tasks = u.tasks || [];
  const pending = tasks.filter(t => !t.completed);
  const done = tasks.filter(t => t.completed);

  if (tasks.length === 0) {
    await sendMessage(chatId,
      `📋 <b>Vazifalar bo'sh.</b>\n\nYangi vazifa qo'shish uchun ✅ Vazifa Qo'shish tugmasini bosing.`,
      { reply_markup: KB_MAIN }
    );
    return;
  }

  let txt = `📋 <b>VAZIFALAR</b> — ${escapeHtml(name)}\n`;
  if (pending.length) {
    txt += `\n⏳ <b>Bajarilmagan (${pending.length}):</b>\n`;
    pending.forEach(t => {
      txt += `• ${t.emoji} <b>${escapeHtml(t.title)}</b>${t.deadlineTime ? ` 🕐${t.deadlineTime}` : ''}\n`;
    });
  }
  if (done.length) {
    txt += `\n✅ <b>Bajarildi (${done.length}):</b>\n`;
    done.slice(-5).forEach(t => { txt += `• ✔ <s>${escapeHtml(t.title)}</s>\n`; });
  }

  const buttons = pending.slice(0, 8).map(t => [
    { text: `✅ ${t.title.slice(0, 28)}`, callback_data: `task_done_${t.id}` }
  ]);
  await sendMessage(chatId, txt, {
    reply_markup: buttons.length ? { inline_keyboard: buttons } : KB_MAIN
  });
}

async function showStatsView(chatId, name, u, period) {
  let filtered, label;
  const todayStr = getTashkentToday();

  if (period === 'today') {
    filtered = (u.expenses || []).filter(e => e.dateKey === todayStr);
    label = '🕐 Bugungi';
  } else if (period === 'week') {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);
    const fromStr = getTashkentToday(fromDate);
    filtered = (u.expenses || []).filter(e => e.dateKey && e.dateKey >= fromStr);
    label = '📅 Haftalik (7 kun)';
  } else if (period === 'month') {
    const mk = getTashkentMonthKey();
    filtered = (u.expenses || []).filter(e => (e.dateKey || '').startsWith(mk));
    label = `🗓 ${getTashkentDateStr()}`;
  } else {
    const yr = getTashkentYearKey();
    filtered = (u.expenses || []).filter(e => (e.dateKey || '').startsWith(yr));
    label = `📆 Yillik (${yr})`;
  }

  if (!filtered.length) {
    await sendMessage(chatId, `📈 <b>${label}</b>\n\n<i>Bu davr uchun harajat topilmadi.</i>`, { reply_markup: KB_MAIN });
    return;
  }

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const days = new Set(filtered.map(e => e.dateKey)).size;
  const avg = Math.round(total / Math.max(days, 1));

  const catMap = {};
  filtered.forEach(e => { catMap[e.description] = (catMap[e.description] || 0) + e.amount; });
  const top = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const catTxt = top.map(([d, s], i) => {
    const pct = Math.round(s / total * 100);
    const bar = '█'.repeat(Math.max(1, Math.round(pct / 10))) + '░'.repeat(Math.max(0, 10 - Math.round(pct / 10)));
    return `${i + 1}. ${escapeHtml(d)}\n ${bar} ${pct}% — <b>${formatMoney(s)}</b>`;
  }).join('\n');

  const dayMap = {};
  filtered.forEach(e => { dayMap[e.dateKey] = (dayMap[e.dateKey] || 0) + e.amount; });
  const topDay = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0];

  await sendMessage(chatId,
    `📈 <b>STATISTIKA — ${label}</b>\n👤 ${escapeHtml(name)}\n\n` +
    `💰 <b>Jami:</b> <code>${formatMoney(total)}</code>\n` +
    `📊 <b>Bitimlar:</b> ${filtered.length} ta\n` +
    `📆 <b>Kunlar:</b> ${days}\n` +
    `📉 <b>O'rtacha/kun:</b> <code>${formatMoney(avg)}</code>\n` +
    (topDay ? `🏆 <b>Eng yuqori kun:</b> ${topDay[0]} — <code>${formatMoney(topDay[1])}</code>\n` : '') +
    `\n🏅 <b>Toifalar:</b>\n${catTxt}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🕐 Bugungi', callback_data: 'stat_today' }, { text: '📅 Haftalik', callback_data: 'stat_week' }],
          [{ text: '🗓 Oylik', callback_data: 'stat_month' }, { text: '📆 Yillik', callback_data: 'stat_year' }]
        ]
      }
    }
  );
}

async function checkReminders(chatId, u) {
  const nm = getTashkentNowMinutes();
  const td = getTashkentToday();
  let changed = false;

  for (const t of (u.tasks || [])) {
    if (t.completed || !t.deadlineMinutes || t.dateKey !== td) continue;
    if (!t.reminderSent && t.reminderMinutes != null && nm >= t.reminderMinutes && nm < t.deadlineMinutes) {
      t.reminderSent = true; changed = true;
      await sendMessage(chatId,
        `⏰ <b>ESLATMA!</b>\n📌 <b>${escapeHtml(t.title)}</b>\n${t.emoji} ${t.label}\n\n` +
        `⏱ <b>${t.deadlineMinutes - nm} daqiqa</b> qoldi (🕐 <code>${t.deadlineTime}</code>)\nTez bajaring! 💪`,
        { reply_markup: { inline_keyboard: [[{ text: '✅ Bajarildi!', callback_data: `task_done_${t.id}` }]] } }
      );
    }
    if (!t.deadlineSent && nm >= t.deadlineMinutes) {
      t.deadlineSent = true; changed = true;
      await sendMessage(chatId,
        `🔔 <b>MUDDAT TUGADI!</b>\n📌 <b>${escapeHtml(t.title)}</b>\n${t.emoji} ${t.label}\n\nBajardingizmi?`,
        { reply_markup: { inline_keyboard: [[
          { text: '✅ Ha, bajardim!', callback_data: `task_done_${t.id}` },
          { text: '⏳ Hali yo\'q', callback_data: `task_skip_${t.id}` }
        ]]} }
      );
    }
  }
  return changed;
}

// ════════════════════════════════════════════════════════════
//  MAIN WEBHOOK HANDLER
// ════════════════════════════════════════════════════════════
export default async function webhookHandler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot Webhook Active v6.2 (Asia/Tashkent UTC+5)');
  }

  try {
    let upd = req.body;
    if (typeof upd === 'string') {
      try { upd = JSON.parse(upd); } catch (_) {}
    }
    if (!upd) return res.status(200).send('OK');

    // ── 1. CALLBACK QUERY PROCESSING ─────────────────────────
    if (upd.callback_query) {
      const cq = upd.callback_query;
      const chatId = String(cq.message.chat.id);
      const userId = String(cq.from.id);
      const username = cq.from.username || '';
      const name = cq.from.first_name || 'Foydalanuvchi';
      const data = cq.data || '';

      const ack = (txt = '') => answerCallbackQuery(cq.id, txt, false);

      // Obuna & Payment callbacklar
      if (data === 'sub_click') {
        await ack('Click to\'lov tanlandi');
        await handlePaymentMethodSelect(chatId, userId, username, name, 'Click');
        return res.status(200).send('OK');
      }
      if (data === 'sub_payme') {
        await ack('Payme to\'lov tanlandi');
        await handlePaymentMethodSelect(chatId, userId, username, name, 'Payme');
        return res.status(200).send('OK');
      }
      if (data === 'sub_menu') {
        await ack();
        await handleSubscriptionMenu(chatId, userId, name);
        return res.status(200).send('OK');
      }
      if (data.startsWith('confirm_pay_')) {
        const code = data.replace('confirm_pay_', '');
        await handleUserPaymentConfirmation(chatId, userId, code, cq.id);
        return res.status(200).send('OK');
      }
      if (data.startsWith('approve_pay_')) {
        const code = data.replace('approve_pay_', '');
        await handleAdminApproval(chatId, code, cq.message.message_id, cq.id);
        return res.status(200).send('OK');
      }
      if (data.startsWith('reject_pay_')) {
        const code = data.replace('reject_pay_', '');
        await handleAdminRejection(chatId, code, cq.message.message_id, cq.id);
        return res.status(200).send('OK');
      }

      // Subscription Guard Check for callback queries
      const access = await checkAccess(userId, '', data);
      if (!access.allowed) {
        await ack('🔒 Obuna kerak!');
        await showSubscriptionRequiredMessage(chatId, name);
        return res.status(200).send('OK');
      }

      // App Callbacks (Expenses, Tasks, Stats)
      const u = await getUserData(userId);
      const save = () => saveUserData(userId, u);

      if (['stat_today', 'stat_week', 'stat_month', 'stat_year'].includes(data)) {
        const map = { stat_today: 'today', stat_week: 'week', stat_month: 'month', stat_year: 'year' };
        await ack('Yuklanmoqda...');
        await showStatsView(chatId, name, u, map[data]);
        return res.status(200).send('OK');
      }

      if (data.startsWith('task_done_')) {
        const id = data.slice(10);
        const t = (u.tasks || []).find(t => t.id === id);
        if (t) {
          t.completed = !t.completed;
          await save();
          await ack(t.completed ? '✅ Bajarildi!' : '↩️ Qayta ochildi');
          await editMessageText(chatId, cq.message.message_id,
            `${t.completed ? '✅' : '⏳'} <b>${escapeHtml(t.title)}</b>\n${t.emoji} ${t.label}${t.deadlineTime ? ` | 🕐${t.deadlineTime}` : ''}`,
            { reply_markup: { inline_keyboard: [[{ text: t.completed ? '↩️ Qayta Ochish' : '✅ Bajarildi', callback_data: `task_done_${id}` }]] } }
          );
        }
        return res.status(200).send('OK');
      }

      if (data.startsWith('task_skip_')) {
        const id = data.slice(10);
        const t = (u.tasks || []).find(t => t.id === id);
        await ack('⏳ Keyinroq bajaring!');
        if (t) {
          await editMessageText(chatId, cq.message.message_id,
            `⏳ <b>${escapeHtml(t.title)}</b>\n${t.emoji} ${t.label}\n\n<i>Hali bajarilmadi.</i>`,
            { reply_markup: { inline_keyboard: [[{ text: '✅ Bajarildi!', callback_data: `task_done_${id}` }]] } }
          );
        }
        return res.status(200).send('OK');
      }

      if (data.startsWith('del_')) {
        const id = data.slice(4);
        const exp = (u.expenses || []).find(e => e.id === id);
        u.expenses = (u.expenses || []).filter(e => e.id !== id);
        await save();
        await ack("🗑 O'chirildi!");
        await deleteMessage(chatId, cq.message.message_id);
        if (exp) {
          const totalInc = (u.incomes || []).reduce((s, i) => s + i.amount, 0);
          const totalExp = u.expenses.reduce((s, e) => s + e.amount, 0);
          const rem = totalInc - totalExp;
          const balLine = totalInc > 0
            ? (rem >= 0 ? `\n✅ Yangi balans: <code>${formatMoney(rem)}</code>` : `\n⚠️ Yangi balans: <code>-${formatMoney(Math.abs(rem))}</code>`)
            : '';
          await sendMessage(chatId, `🗑 <b>O'chirildi:</b> ${escapeHtml(exp.description)} — <code>${formatMoney(exp.amount)}</code>${balLine}`);
        }
        return res.status(200).send('OK');
      }

      if (data.startsWith('edit_')) {
        const id = data.slice(5);
        const exp = (u.expenses || []).find(e => e.id === id);
        if (!exp) { await ack('Topilmadi'); return res.status(200).send('OK'); }
        u.expenses = (u.expenses || []).filter(e => e.id !== id);
        u.state = 'exp_amount'; u.pending = {};
        await save();
        await ack('✏️ Tahrirlash...');
        await deleteMessage(chatId, cq.message.message_id);
        await sendMessage(chatId,
          `✏️ <b>Tahrirlash</b>\n\n` +
          `🗑 O'chirildi: <s>${escapeHtml(exp.description)}</s> — <code>${formatMoney(exp.amount)}</code>\n\n` +
          `Yangi summasini kiriting:`,
          { reply_markup: KB_REMOVE }
        );
        return res.status(200).send('OK');
      }

      if (data === 'balance_refresh') {
        await ack('🔄 Yangilanmoqda...');
        await showBalanceView(chatId, name, u);
        return res.status(200).send('OK');
      }

      if (data === 'income_start') {
        await ack();
        u.state = 'inc_amount'; u.pending = {};
        await save();
        await sendMessage(chatId, `💵 <b>Kirim Qo'shish</b>\n\nNecha so'm?\n<i>Masalan: 2 500 000</i>`, { reply_markup: KB_REMOVE });
        return res.status(200).send('OK');
      }

      await ack();
      return res.status(200).send('OK');
    }

    // ── 2. MESSAGE PROCESSING ─────────────────────────────────
    if (!upd.message) return res.status(200).send('OK');

    const msg = upd.message;
    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    const name = msg.from?.first_name || 'Foydalanuvchi';
    const text = (msg.text || '').trim();

    // ── /start & /menu ────────────────────────────────────────
    if (text === '/start' || text === '/menu') {
      const u = await getUserData(userId);
      u.state = null; u.pending = {};
      await saveUserData(userId, u);

      const active = await isSubActive(userId);

      if (active) {
        await sendMessage(chatId,
          `👋 <b>Xush kelibsiz, ${escapeHtml(name)}!</b>\n\n` +
          `🌟 <b>Xarajat va Vazifalar Boti</b>\n\n` +
          `📌 Quyidagi menyudan foydalanishingiz mumkin:`,
          { reply_markup: KB_MAIN }
        );
      } else {
        await sendMessage(chatId,
          `👋 <b>Assalomu alaykum, ${escapeHtml(name)}!</b>\n\n` +
          `🌟 <b>Xarajat & Vazifa Boti</b>ga xush kelibsiz!\n\n` +
          `📌 <b>Bot imkoniyatlari:</b>\n` +
          `  💸 Harajat va Kirimlar balansi\n` +
          `  ✅ Vazifalar va 30-min oldin avto-eslatmalar\n` +
          `  📊 Chuqur statistika va hisobotlar\n\n` +
          ` Botdan foydalanish uchun obunani faollashtiring:`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '💳 Obuna Sotib Olish (5 000 UZS)', callback_data: 'sub_click' }
                ]
              ]
            }
          }
        );
      }
      return res.status(200).send('OK');
    }

    // ── /status & /db (DATABASE DIAGNOSTICS) ──────────────────
    if (text === '/status' || text === '/db' || text === '⚙️ Baza Holati') {
      const dbStatus = await getDbStatus();
      if (dbStatus.connected) {
        await sendMessage(chatId, `🟢 <b>BAZA HOLATI: FAOL ✅</b>\n\n<b>Turi:</b> ${dbStatus.type}\n\n✨ Barcha xarajatlar, vazifalar va obunalar Vercel KV bazasida abadiy saqlanmoqda.`);
      } else {
        await sendMessage(chatId,
          `🔴 <b>BAZA HOLATI: VAQTINCHALIK RAM ⚠️</b>\n\n` +
          `⚠️ <b>DIQQAT:</b> Vercel KV bazasi loyihaga ulanmagan!\n` +
          `<b>Sabab:</b> <code>${escapeHtml(dbStatus.reason)}</code>\n\n` +
          `📌 <b>Ma'lumotlar o'chib ketmasligi uchun shuni bajaring:</b>\n` +
          `1️⃣ <a href="https://vercel.com">Vercel.com</a> Dashboardga kiring\n` +
          `2️⃣ Loyihangiz (<b>bot</b>) -> <b>Storage</b> bo'limini tanlang\n` +
          `3️⃣ <b>Connect Store</b> -> <b>KV (Redis)</b> ni tanlab <b>Connect</b> tugmasini bosing!`
        );
      }
      return res.status(200).send('OK');
    }


    // ── OBUNA MENYUSI TUGMASI ────────────────────────────────
    if (text === '💳 Obuna' || text === '💳 Obunani ko\'rish' || text === '/sub') {
      await handleSubscriptionMenu(chatId, userId, name);
      return res.status(200).send('OK');
    }

    // ── SUBSCRIPTION GUARD CHECK ──────────────────────────────
    const access = await checkAccess(userId, text);
    if (!access.allowed) {
      await showSubscriptionRequiredMessage(chatId, name);
      return res.status(200).send('OK');
    }

    // ── AUTHENTICATED & SUBSCRIBED USER FLOWS ────────────────
    const u = await getUserData(userId);
    const save = () => saveUserData(userId, u);

    // Eslatmalarni tekshirish
    const remChanged = await checkReminders(chatId, u);
    if (remChanged) await save();

    // Ovozli xabar
    if (msg.voice || msg.audio) {
      u.state = 'exp_amount'; u.pending = { fromVoice: true };
      await save();
      await sendMessage(chatId,
        `🎤 <b>Ovozli xabar qabul qilindi!</b> (${msg.voice?.duration || 0} sek)\n\n💰 Harajat summasini yozing:`,
        { reply_markup: KB_REMOVE }
      );
      return res.status(200).send('OK');
    }

    if (!text) return res.status(200).send('OK');

    // Asosiy menyu tugmalari
    if (text === '💸 Harajat Qo\'shish') {
      u.state = 'exp_amount'; u.pending = {};
      await save();
      await sendMessage(chatId, `💸 <b>Harajat Qo'shish</b>\n\nSummasini kiriting:\n<i>Masalan: 50 000</i>`, { reply_markup: KB_REMOVE });
      return res.status(200).send('OK');
    }

    if (text === '✅ Vazifa Qo\'shish') {
      u.state = 'task_title'; u.pending = {};
      await save();
      await sendMessage(chatId, `✅ <b>Yangi Vazifa</b>\n\nVazifa nomini yozing:`, { reply_markup: KB_REMOVE });
      return res.status(200).send('OK');
    }

    if (text === '📊 Kunlik Hisobot' || text === '/hisobot') {
      u.state = null; await save();
      await showDailyReportView(chatId, name, u);
      return res.status(200).send('OK');
    }

    if (text === '📋 Vazifalar Ro\'yxati' || text === '/vazifalar') {
      u.state = null; await save();
      await showTasksView(chatId, name, u);
      return res.status(200).send('OK');
    }

    if (text === '💰 Balans' || text === '/balans') {
      u.state = null; await save();
      await showBalanceView(chatId, name, u);
      return res.status(200).send('OK');
    }

    if (text === '📈 Statistika' || text === '/stat') {
      u.state = null; await save();
      await sendMessage(chatId, `📈 <b>Statistika</b>\n\nQaysi davr?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📅 Haftalik', callback_data: 'stat_week' }, { text: '🗓 Oylik', callback_data: 'stat_month' }, { text: '📆 Yillik', callback_data: 'stat_year' }],
            [{ text: '🕐 Bugungi', callback_data: 'stat_today' }]
          ]
        }
      });
      return res.status(200).send('OK');
    }

    if (text === '🗂 Harajatlar Tarixi' || text === '/tarix') {
      u.state = null; await save();
      await showExpenseHistoryView(chatId, name, u);
      return res.status(200).send('OK');
    }

    if (text === '💵 Kirim Qo\'shish') {
      u.state = 'inc_amount'; u.pending = {};
      await save();
      await sendMessage(chatId, `💵 <b>Kirim Qo'shish</b>\n\nNecha so'm?\n<i>Masalan: 2 500 000</i>`, { reply_markup: KB_REMOVE });
      return res.status(200).send('OK');
    }

    // STATE MACHINE: Harajat summa
    if (u.state === 'exp_amount') {
      const n = parseNum(text);
      if (n) {
        u.pending.amount = n;
        u.state = 'exp_desc';
        await save();
        await sendMessage(chatId,
          `💰 Summa: <b>${formatMoney(n)}</b>\n\n❓ Nima uchun sarflandi?\nToifa tanlang yoki yozing:`,
          { reply_markup: KB_CATEGORY }
        );
      } else {
        await sendMessage(chatId, `❗ Faqat <b>raqam</b> kiriting.\n<i>Masalan: 50000</i>`);
      }
      return res.status(200).send('OK');
    }

    // STATE MACHINE: Harajat izoh
    if (u.state === 'exp_desc') {
      const amount = u.pending?.amount;
      if (amount && text) {
        u.expenses.push({ id: genId(), amount, description: text, date: getTashkentDateStr(), dateKey: getTashkentToday(), time: getTashkentTimeStr() });
        u.pending = {}; u.state = null;
        await save();

        const todayExp = u.expenses.filter(e => e.dateKey === getTashkentToday()).reduce((s, e) => s + e.amount, 0);
        const totalInc = (u.incomes || []).reduce((s, i) => s + i.amount, 0);
        const totalExp = u.expenses.reduce((s, e) => s + e.amount, 0);
        const rem = totalInc - totalExp;
        const balLine = totalInc > 0
          ? (rem >= 0
            ? `\n━━━━━━━━━━━━━━━━\n✅ <b>Qolgan balans:</b> <code>${formatMoney(rem)}</code>`
            : `\n━━━━━━━━━━━━━━━━\n⚠️ <b>Qolgan:</b> <code>-${formatMoney(Math.abs(rem))}</code>`)
          : '';

        await sendMessage(chatId,
          `✅ <b>Harajat saqlandi!</b>\n\n💵 ${formatMoney(amount)} • 📝 ${escapeHtml(text)} • 🕐 ${getTashkentTimeStr()}\n\n` +
          `📊 Bugungi jami: <code>${formatMoney(todayExp)}</code>${balLine}`,
          { reply_markup: KB_MAIN }
        );
      } else {
        u.state = null; await save();
        await sendMessage(chatId, `❌ Bekor qilindi.`, { reply_markup: KB_MAIN });
      }
      return res.status(200).send('OK');
    }

    // STATE MACHINE: Kirim summa
    if (u.state === 'inc_amount') {
      const n = parseNum(text);
      if (n) {
        u.pending.amount = n;
        u.state = 'inc_desc';
        await save();
        await sendMessage(chatId, `💵 <b>${formatMoney(n)}</b>\n\n📝 Izoh kiriting:`, { reply_markup: KB_INCOME_CAT });
      } else {
        await sendMessage(chatId, `❗ Faqat <b>raqam</b> kiriting.`);
      }
      return res.status(200).send('OK');
    }

    // STATE MACHINE: Kirim izoh
    if (u.state === 'inc_desc') {
      const amount = u.pending?.amount;
      if (amount && text) {
        if (!u.incomes) u.incomes = [];
        u.incomes.push({ id: genId(), amount, description: text, date: getTashkentDateStr(), dateKey: getTashkentToday(), time: getTashkentTimeStr() });
        u.pending = {}; u.state = null;
        await save();

        const totalInc = u.incomes.reduce((s, i) => s + i.amount, 0);
        const totalExp = u.expenses.reduce((s, e) => s + e.amount, 0);
        await sendMessage(chatId,
          `✅ <b>Kirim saqlandi!</b>\n\n💵 ${formatMoney(amount)} • 📝 ${escapeHtml(text)}\n\n` +
          `📥 Jami kirim: <code>${formatMoney(totalInc)}</code>\n📤 Jami harajat: <code>${formatMoney(totalExp)}</code>\n` +
          `✅ Qolgan: <code>${formatMoney(totalInc - totalExp)}</code>`,
          { reply_markup: KB_MAIN }
        );
      } else {
        u.state = null; await save();
        await sendMessage(chatId, `❌ Bekor qilindi.`, { reply_markup: KB_MAIN });
      }
      return res.status(200).send('OK');
    }

    // STATE MACHINE: Vazifa title
    if (u.state === 'task_title') {
      u.pending.title = text;
      u.state = 'task_priority';
      await save();
      await sendMessage(chatId, `📝 <b>${escapeHtml(text)}</b>\n\n⚡ Muhimlik darajasini tanlang:`, { reply_markup: KB_PRIORITY });
      return res.status(200).send('OK');
    }

    // STATE MACHINE: Vazifa priority
    if (u.state === 'task_priority') {
      let emoji = '🟡', label = 'Muhim', priority = 'medium';
      if (text.includes('Juda Zarur') || text.includes('🔴')) { emoji = '🔴'; label = 'Juda Zarur'; priority = 'high'; }
      else if (text.includes('Oddiy') || text.includes('🟢')) { emoji = '🟢'; label = 'Oddiy'; priority = 'low'; }
      u.pending.priority = { emoji, label, priority };
      u.state = 'task_time';
      await save();
      await sendMessage(chatId, `${emoji} <b>${label}</b>\n\n🕐 Qaysi soatga bajarilishi kerak?`, { reply_markup: KB_TIME });
      return res.status(200).send('OK');
    }

    // STATE MACHINE: Vazifa time
    if (u.state === 'task_time') {
      const { title, priority: pr } = u.pending || {};
      const { emoji = '🟡', label = 'Muhim' } = pr || {};
      let deadlineTime = null, deadlineMinutes = null, reminderMinutes = null;

      if (text !== '📅 Vaqtsiz (eslatma yo\'q)') {
        const m = text.replace('⏰', '').trim().match(/^(\d{1,2}):(\d{2})$/);
        if (m) {
          const h = parseInt(m[1]), min = parseInt(m[2]);
          if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
            deadlineTime = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
            deadlineMinutes = h * 60 + min;
            reminderMinutes = deadlineMinutes - 30;
          }
        }
      }

      const task = {
        id: genId(), title: title || 'Vazifa', priority: pr?.priority || 'medium', emoji, label,
        date: getTashkentDateStr(), dateKey: getTashkentToday(), time: getTashkentTimeStr(),
        deadlineTime, deadlineMinutes, reminderMinutes,
        reminderSent: false, deadlineSent: false, completed: false
      };
      u.tasks.push(task);
      u.pending = {}; u.state = null;
      await save();

      let txt = `✅ <b>Vazifa qo'shildi!</b>\n\n📌 <b>${escapeHtml(task.title)}</b>\n${emoji} ${label}`;
      if (deadlineTime) txt += `\n⏰ Eslatma: ${deadlineTime} dan 30 daqiqa oldin`;
      await sendMessage(chatId, txt, { reply_markup: KB_MAIN });
      return res.status(200).send('OK');
    }

    // Raqam yozilganda -> harajat kiritish
    if (isNumericText(text)) {
      const n = parseNum(text);
      if (n) {
        u.pending = { amount: n };
        u.state = 'exp_desc';
        await save();
        await sendMessage(chatId,
          `💰 Summa: <b>${formatMoney(n)}</b>\n\n❓ Nima uchun sarflandi?\nToifa tanlang yoki yozing:`,
          { reply_markup: KB_CATEGORY }
        );
        return res.status(200).send('OK');
      }
    }

    // Odatiy javob
    await sendMessage(chatId,
      `💡 Harajat qo'shish uchun summa yozing yoki quyidagi tugmalardan foydalaning:`,
      { reply_markup: KB_MAIN }
    );
    return res.status(200).send('OK');

  } catch (err) {
    console.error('[WEBHOOK ERROR]:', err?.message || err);
  } finally {
    return res.status(200).send('OK');
  }
}
