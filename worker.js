// Cloudflare Worker: Telegram Moderator Bot (ShinyModeration)
// High-tech, удобный бот-модератор с поддержкой кнопок, естественных команд и авто-размута

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
  enable_links: true,        // Блокировка рекламы и ссылок
  enable_profanity: false,   // Маты отключены (по умолчанию не мутить)
  enable_spam: true,         // Блокировка скама/крипты/заработка
  enable_caps: false,        // Капс отключен (по умолчанию не мутить)
  clean_service: false,      // Чистка входов/выходов
  max_caps_percent: 85,
  auto_delete_sec: 5,        // Быстрое исчезновение алертов (5 сек)
  mute_links_sec: 86400,     // 24 часа
  mute_profanity_sec: 7200,
  mute_caps_sec: 900
};

// Хранилище настроек и известных чатов
const CHAT_SETTINGS = new Map();
const KNOWN_CHATS = new Map();

async function getChatSettings(env, chatId) {
  const key = `settings_${chatId}`;
  if (env?.SETTINGS_KV) {
    try {
      const data = await env.SETTINGS_KV.get(key, "json");
      if (data) return { ...DEFAULT_SETTINGS, ...data };
    } catch (e) {}
  }
  if (CHAT_SETTINGS.has(chatId)) {
    return { ...DEFAULT_SETTINGS, ...CHAT_SETTINGS.get(chatId) };
  }
  return { ...DEFAULT_SETTINGS };
}

async function saveChatSettings(env, chatId, newSettings) {
  const merged = { ...DEFAULT_SETTINGS, ...newSettings };
  CHAT_SETTINGS.set(chatId, merged);
  if (env?.SETTINGS_KV) {
    try {
      await env.SETTINGS_KV.put(`settings_${chatId}`, JSON.stringify(merged));
    } catch (e) {}
  }
  return merged;
}

function formatDuration(sec) {
  if (sec <= 0) return "Отключен";
  if (sec < 60) return `${sec} сек`;
  if (sec < 3600) return `${Math.floor(sec / 60)} мин`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч`;
  return `${Math.floor(sec / 86400)} дн`;
}

function parseDurationInput(str) {
  if (!str) return null;
  const match = str.trim().toLowerCase().match(/^(\d+)\s*([smhdдчмс]?)$/i);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  const unit = match[2] || 'm';
  if (unit === 's' || unit === 'с') return val;
  if (unit === 'm' || unit === 'м') return val * 60;
  if (unit === 'h' || unit === 'ч') return val * 3600;
  if (unit === 'd' || unit === 'д') return val * 86400;
  return val * 60;
}

// Проверка ссылок
function hasLinks(msg) {
  const entities = (msg.entities || []).concat(msg.caption_entities || []);
  for (let e of entities) {
    if (e.type === "url" || e.type === "text_link") return true;
    if (e.type === "mention") return true;
  }

  const text = msg.text || msg.caption || "";
  if (/(?:https?:\/\/|ftps?:\/\/|tg:\/\/|t\.me\/|telegram\.me\/|telegram\.dog\/)/i.test(text)) return true;

  const domainRegex = /\b[a-z0-9-]{2,}\.(?:com|ru|org|net|xyz|top|online|site|pro|app|io|me|link|live|fun|vip|to|tv|cc|gg|su|kz|by|ua|info|biz|co|tech|space|club|shop|work|agency|dev|cloud|store|click|press|group|design|trade|wiki|monster|fit|icu|pw|rest|casa|buzz|best|ooo|cyou|cfd|art|lat|one|bar|sbs)\b/i;
  if (domainRegex.test(text)) return true;

  const obfuscatedRegex = /[a-z0-9-]{2,}\s*(?:\[\.\]|\(\.\)|\s+dot\s+|\s+точка\s+|\s*\/\s*)(?:com|ru|org|net|xyz|top|site|online|me|io)/i;
  if (obfuscatedRegex.test(text)) return true;

  if (/\b(?:t\s*\.\s*m\s*e|w\s*w\s*w)\b/i.test(text)) return true;
  if (/(?:^|\s)@[a-zA-Z0-9_]{4,}/.test(text)) return true;

  return false;
}

// Стоп-фразы спамеров и мошенников
const SCAM_PATTERNS = [
  /пассивн(?:ый|ого|ому|ом|ым)\s+доход/i,
  /заработ(?:ок|ать|ай|ывай|аем)/i,
  /(?:доход|заработок)\s+от\s+\d+/i,
  /\d+\s*(?:тыс|к|руб|\$|usdt|евро)\s+(?:в\s+день|в\s+сутки|ежедневно)/i,
  /легкие\s+деньги/i,
  /быстр(?:ый|ые)\s+деньги/i,
  /подработк[аеиу]\s+(?:для\s+всех|на\s+дому|онлайн)/i,
  /удаленн(?:ая|ой)\s+работ[аеы]/i,
  /работа\s+без\s+опыта/i,
  /ваканси[яи]\s+онлайн/i,
  /набираю\s+(?:в\s+команду|людей|сотрудников)/i,
  /требуются\s+(?:люди|девушки|парни|сотрудники)/i,
  /без\s+вложений/i,
  /пиши(?:те)?\s+(?:мне\s+)?в\s+(?:лс|личку|директ|тг)/i,
  /жду\s+в\s+(?:лс|личке)/i,
  /отве(?:тил|тила)\s+в\s+лс/i,
  /скинул[а]?\s+в\s+лс/i,
  /сигнал[ыов]+\s+по\s+крипт/i,
  /инвестици[иях]\s+от/i,
  /дарю\s+(?:крипт|usdt|тон|ton|btc|биткоин)/i,
  /раздач[аеи]\s+(?:крипт|usdt|ton|монет|денег)/i,
  /арбитраж\s+(?:крипт|валют|p2p)/i,
  /раскрутк[аеи]\s+(?:счета|депозита)/i,
  /слив\s+(?:приват|шкур|фото|видео|переписок)/i,
  /интим\s*(?:фото|видео|знакомств)/i,
  /накрутк[аеи]\s+(?:подписчиков|лайков|ботов)/i,
  /взлом\s+(?:вк|тг|телеграм|аккаунт)/i
];

function checkScamOrPromo(msg) {
  const text = msg.text || msg.caption || "";
  if (msg.forward_origin?.type === "channel" || msg.forward_from_chat?.type === "channel") {
    return "Рекламный репост из стороннего канала";
  }
  for (let reg of SCAM_PATTERNS) {
    if (reg.test(text)) return "Рекламный спам / мошенничество";
  }
  const mentions = (msg.entities || []).filter(e => e.type === "mention" || e.type === "text_mention");
  if (mentions.length >= 3) return "Массовый спам упоминаниями пользователей";
  return null;
}

async function tgApi(token, method, data) {
  return await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

// Проверка: является ли пользователь админом
async function isAdmin(token, chatId, userId) {
  try {
    const res = await (await tgApi(token, "getChatMember", { chat_id: chatId, user_id: userId })).json();
    if (res.ok) {
      const s = res.result.status;
      return s === "creator" || s === "administrator";
    }
  } catch (e) {}

  try {
    const adminsRes = await (await tgApi(token, "getChatAdministrators", { chat_id: chatId })).json();
    if (adminsRes.ok && Array.isArray(adminsRes.result)) {
      return adminsRes.result.some(a => a.user?.id === userId);
    }
  } catch (e) {}

  return false;
}

// Проверка: является ли сам бот админом
async function checkBotIsAdmin(token, chatId) {
  try {
    const meRes = await (await tgApi(token, "getMe", {})).json();
    if (!meRes.ok) return true;
    const botId = meRes.result.id;
    const res = await (await tgApi(token, "getChatMember", { chat_id: chatId, user_id: botId })).json();
    if (res.ok) {
      return res.result.status === "administrator";
    }
  } catch (e) {}
  return true;
}

// Главное меню в ЛС (Личный кабинет администратора)
function renderDashboard(userId, username) {
  const botUsername = "shinymoderation_bot";
  // Ссылка для добавления в группу с предвыбранными правами администратора
  const addUrl = `https://t.me/${botUsername}?startgroup=true&admin=delete_messages+restrict_members`;

  const text =
    `🛡️ <b>Личный кабинет ShinyModeration</b>\n\n` +
    `👤 <b>Пользователь:</b> @${username || userId}\n` +
    `⚡ <b>Статус:</b> Владелец / Администратор (Иммунитет активен)\n\n` +
    `<i>Выберите нужное действие кнопками ниже:</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "➕ Добавить в группу (с правами)", url: addUrl }
      ],
      [
        { text: "🔊 Снять с меня мут", callback_data: "act_unmuteme" },
        { text: "🚪 Выйти из группы", callback_data: "act_leave_menu" }
      ],
      [
        { text: "⚙️ Настройки модерации", callback_data: "act_settings_help" },
        { text: "📖 Список команд", callback_data: "act_commands_help" }
      ]
    ]
  };

  return { text, reply_markup };
}

// Панель настроек чата
function renderMainMenu(chatId, chatTitle, s) {
  const text =
    `⚙️ <b>Настройки модератора для чата:</b>\n` +
    `📍 <b>${chatTitle || "Этот чат"}</b>\n\n` +
    `🔗 <b>Ссылки и юзернеймы:</b> ${s.enable_links ? '✅ ВКЛ' : '❌ ВЫКЛ'} (Мут: <b>${formatDuration(s.mute_links_sec)}</b>)\n` +
    `🚨 <b>Анти-скам / реклама:</b> ${s.enable_spam ? '✅ ВКЛ' : '❌ ВЫКЛ'} (Кара: <b>БАН</b>)\n` +
    `🤬 <b>Мат:</b> ${s.enable_profanity ? '✅ ВКЛ' : '❌ ВЫКЛ'}\n` +
    `📢 <b>Капслок:</b> ${s.enable_caps ? '✅ ВКЛ' : '❌ ВЫКЛ'}\n` +
    `🧹 <b>Удаление входов/выходов:</b> ${s.clean_service ? '✅ ВКЛ' : '❌ ВЫКЛ'}\n\n` +
    `<i>Нажмите на кнопку, чтобы включить/выключить:</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: s.enable_links ? "🔗 Ссылки: ВКЛ" : "🔗 Ссылки: ВЫКЛ", callback_data: "cfg_toggle_links" },
        { text: `⏱️ Мут: ${formatDuration(s.mute_links_sec)}`, callback_data: "cfg_menu_links" }
      ],
      [
        { text: s.enable_spam ? "🚨 Скам: ВКЛ" : "🚨 Скам: ВЫКЛ", callback_data: "cfg_toggle_spam" },
        { text: s.clean_service ? "🧹 Чистка: ВКЛ" : "🧹 Чистка: ВЫКЛ", callback_data: "cfg_toggle_service" }
      ],
      [
        { text: s.enable_profanity ? "🤬 Мат: ВКЛ" : "🤬 Мат: ВЫКЛ", callback_data: "cfg_toggle_prof" },
        { text: s.enable_caps ? "📢 Капс: ВКЛ" : "📢 Капс: ВЫКЛ", callback_data: "cfg_toggle_caps" }
      ],
      [
        { text: "🔄 Сброс настроек", callback_data: "cfg_reset" },
        { text: "❌ Закрыть", callback_data: "cfg_close" }
      ]
    ]
  };

  return { text, reply_markup };
}

// Подменю выбора длительности мута за ссылки
function renderMuteLinksMenu(s) {
  const text =
    `⏱️ <b>Длительность мута за ссылки:</b>\n` +
    `Текущее значение: <b>${formatDuration(s.mute_links_sec)}</b>\n\n` +
    `<i>Выберите время мута:</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "15 минут", callback_data: "cfg_set_links_900" },
        { text: "1 час", callback_data: "cfg_set_links_3600" },
        { text: "6 часов", callback_data: "cfg_set_links_21600" }
      ],
      [
        { text: "12 часов", callback_data: "cfg_set_links_43200" },
        { text: "24 часа (1 д)", callback_data: "cfg_set_links_86400" },
        { text: "7 дней", callback_data: "cfg_set_links_604800" }
      ],
      [
        { text: "⬅️ Назад в меню", callback_data: "cfg_main" }
      ]
    ]
  };
  return { text, reply_markup };
}

// Обработка кликов по инлайн-кнопкам
async function handleCallbackQuery(token, env, cq) {
  const chatId = cq.message?.chat?.id;
  const userId = cq.from?.id;
  const messageId = cq.message?.message_id;
  const data = cq.data || "";

  if (!chatId || !userId) return new Response("OK");

  // 1. Кнопка "Снять с меня мут" в личном кабинете
  if (data === "act_unmuteme") {
    let unmutedCount = 0;
    for (const [cId, title] of KNOWN_CHATS.entries()) {
      try {
        await tgApi(token, "restrictChatMember", {
          chat_id: cId,
          user_id: userId,
          permissions: {
            can_send_messages: true,
            can_send_audios: true,
            can_send_documents: true,
            can_send_photos: true,
            can_send_videos: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true
          }
        });
        unmutedCount++;
      } catch (e) {}
    }
    await tgApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: unmutedCount > 0 ? `🔊 Мут снят в ${unmutedCount} группах!` : "🔊 Мут снят!",
      show_alert: true
    });
    return new Response("OK");
  }

  // 2. Кнопка "Выйти из группы" в личном кабинете
  if (data === "act_leave_menu") {
    if (KNOWN_CHATS.size > 0) {
      const buttons = [];
      for (const [cId, title] of KNOWN_CHATS.entries()) {
        buttons.push([{ text: `🚪 Выйти из «${title}»`, callback_data: `leave_chat_${cId}` }]);
      }
      buttons.push([{ text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }]);

      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "🚪 <b>Выберите группу, из которой боту нужно выйти:</b>",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "🚪 <b>Управление выходом из групп:</b>\n\n" +
              "Чтобы бот вышел из группы (например, «9А»):\n" +
              "👉 <b>Просто перешлите любое сообщение из этой группы сюда в ЛС!</b>\n\n" +
              "<i>Бот сразу отобразит кнопку подтверждения выхода.</i>",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }]]
        }
      });
    }
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("OK");
  }

  // Возврат в кабинет
  if (data === "act_back_dashboard") {
    const dash = renderDashboard(userId, cq.from?.username);
    await tgApi(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: dash.text,
      parse_mode: "HTML",
      reply_markup: dash.reply_markup
    });
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("OK");
  }

  // Справка по командам
  if (data === "act_commands_help") {
    const helpText =
      "📖 <b>Быстрые команды для чата (ответом на сообщение нарушителя):</b>\n\n" +
      "• <code>мут 30м</code> или <code>/mute 30m</code> — замутить\n" +
      "• <code>размут</code> или <code>/unmute</code> — снять мут\n" +
      "• <code>кик</code> или <code>/kick</code> — выгнать из группы\n" +
      "• <code>бан</code> или <code>/ban</code> — забанить навсегда\n" +
      "• <code>дел</code> или <code>/del</code> — удалить сообщение\n" +
      "• <code>выйди</code> или <code>/leave</code> — бот выйдет из чата\n" +
      "• <code>/settings</code> — открыть панель настроек\n\n" +
      "<i>Бот понимает команды как со слешем (/), так и обычными русскими словами!</i>";

    await tgApi(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: helpText,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }]]
      }
    });
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("OK");
  }

  // Справка по настройкам
  if (data === "act_settings_help") {
    const text =
      "⚙️ <b>Как настраивать бота:</b>\n\n" +
      "1. Добавьте бота в нужную группу и назначьте Администратором.\n" +
      "2. Напишите прямо в группе команду <code>/settings</code>.\n" +
      "3. Появится удобное меню с кнопками для включения/выключения ссылок, спама, мата и изменения времени мута!";

    await tgApi(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }]]
      }
    });
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("OK");
  }

  // Выход из чата по кнопке
  if (data.startsWith("leave_chat_")) {
    const targetChatId = data.replace("leave_chat_", "");
    try {
      const res = await tgApi(token, "leaveChat", { chat_id: targetChatId });
      const resData = await res.json();
      if (resData.ok) {
        KNOWN_CHATS.delete(parseInt(targetChatId, 10));
        await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "✅ Бот покинул чат!" });
        await tgApi(token, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: `🚪 <b>Бот успешно покинул чат (ID: <code>${targetChatId}</code>)!</b>`,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "⬅️ В кабинет", callback_data: "act_back_dashboard" }]]
          }
        });
      } else {
        await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: `Ошибка: ${resData.description}`, show_alert: true });
      }
    } catch (e) {
      await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: `Ошибка: ${e.message}`, show_alert: true });
    }
    return new Response("OK");
  }

  // Размут по кнопке
  if (data.startsWith("unmute_chat_")) {
    const targetChatId = data.replace("unmute_chat_", "");
    try {
      await tgApi(token, "restrictChatMember", {
        chat_id: targetChatId,
        user_id: userId,
        permissions: {
          can_send_messages: true,
          can_send_audios: true,
          can_send_documents: true,
          can_send_photos: true,
          can_send_videos: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true
        }
      });
      await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "🔊 Мут снят!" });
      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: `🔊 <b>Мут успешно снят в группе (ID: <code>${targetChatId}</code>)!</b>\nВы снова можете отправлять туда сообщения.`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ В кабинет", callback_data: "act_back_dashboard" }]]
        }
      });
    } catch (e) {
      await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: `Ошибка: ${e.message}`, show_alert: true });
    }
    return new Response("OK");
  }

  if (data === "cfg_close") {
    await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Панель закрыта" });
    return new Response("OK");
  }

  // Проверка прав администратора для настроек в группе
  if (!await isAdmin(token, chatId, userId)) {
    await tgApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "❌ Только администраторы могут менять настройки модерации!",
      show_alert: true
    });
    return new Response("OK");
  }

  const settings = await getChatSettings(env, chatId);
  let changed = false;
  let subMenu = null;

  if (data === "cfg_reset") {
    await saveChatSettings(env, chatId, DEFAULT_SETTINGS);
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Настройки сброшены!" });
    const { text, reply_markup } = renderMainMenu(chatId, cq.message?.chat?.title, DEFAULT_SETTINGS);
    await tgApi(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup
    });
    return new Response("OK");
  }

  if (data === "cfg_toggle_links") {
    settings.enable_links = !settings.enable_links;
    changed = true;
  } else if (data === "cfg_toggle_prof") {
    settings.enable_profanity = !settings.enable_profanity;
    changed = true;
  } else if (data === "cfg_toggle_spam") {
    settings.enable_spam = !settings.enable_spam;
    changed = true;
  } else if (data === "cfg_toggle_caps") {
    settings.enable_caps = !settings.enable_caps;
    changed = true;
  } else if (data === "cfg_toggle_service") {
    settings.clean_service = !settings.clean_service;
    changed = true;
  } else if (data === "cfg_menu_links") {
    subMenu = "links";
  } else if (data.startsWith("cfg_set_links_")) {
    settings.mute_links_sec = parseInt(data.replace("cfg_set_links_", ""), 10);
    changed = true;
  }

  if (changed) {
    await saveChatSettings(env, chatId, settings);
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "✅ Сохранено!" });
  } else {
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
  }

  const chatTitle = cq.message?.chat?.title || "Этот чат";
  let payload;
  if (subMenu === "links") {
    payload = renderMuteLinksMenu(settings);
  } else {
    payload = renderMainMenu(chatId, chatTitle, settings);
  }

  await tgApi(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: payload.text,
    parse_mode: "HTML",
    reply_markup: payload.reply_markup
  });

  return new Response("OK");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = env?.BOT_TOKEN || "8227600059:AAHnhYBRiCmhCPf7aJ5ac3dvvm2ElykwHgU";

    if (url.pathname === "/set-webhook") {
      const webhookUrl = `${url.origin}/`;
      const res = await tgApi(token, "setWebhook", { url: webhookUrl });
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/webhook-info") {
      const res = await tgApi(token, "getWebhookInfo", {});
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/get-me") {
      const res = await tgApi(token, "getMe", {});
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/set-commands") {
      const commands = [
        { command: "start", description: "Личный кабинет / Информация" },
        { command: "settings", description: "Настройки модератора и мутов" },
        { command: "rules", description: "Показать правила чата" },
        { command: "mute", description: "Замутить (ответом: /mute 30m / 2h / 1d)" },
        { command: "unmute", description: "Снять мут с пользователя (ответом)" },
        { command: "kick", description: "Выгнать пользователя из группы (ответом)" },
        { command: "ban", description: "Навсегда забанить нарушителя (ответом)" },
        { command: "del", description: "Быстро удалить сообщение (ответом)" },
        { command: "leave", description: "Выйти из группы" }
      ];
      const res = await tgApi(token, "setMyCommands", { commands });
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (request.method !== "POST") {
      return new Response("ShinyModeration Bot is active!", { status: 200 });
    }

    try {
      const update = await request.json();

      // Обработка кликов по инлайн-кнопкам
      if (update.callback_query) {
        return await handleCallbackQuery(token, env, update.callback_query);
      }

      const msg = update.message;
      if (!msg || !msg.chat) {
        return new Response("OK");
      }

      const chatId = msg.chat.id;
      const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

      if (isGroup) {
        KNOWN_CHATS.set(chatId, msg.chat.title || `Чат ${chatId}`);
      }

      const chatSettings = await getChatSettings(env, chatId);

      // Специальное правило для чата 9А: маты и капс полностью отключены!
      if (msg.chat.title && /9\s*[аa]/i.test(msg.chat.title)) {
        chatSettings.enable_profanity = false;
        chatSettings.enable_caps = false;
      }

      // Чистка системных уведомлений (вход/выход)
      if (msg.new_chat_members || msg.left_chat_member || msg.pinned_message) {
        if (chatSettings.clean_service) {
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
        }
        return new Response("OK");
      }

      if (!msg.from) {
        return new Response("OK");
      }

      const userId = msg.from.id;
      const username = msg.from.username ? msg.from.username.toLowerCase() : "";
      const isOwner = username === "deathh1337";

      // ==========================================
      // ЛИЧНЫЕ СООБЩЕНИЯ С БОТОМ (Личный кабинет)
      // ==========================================
      if (msg.chat.type === "private") {
        const text = (msg.text || "").trim();

        // 1. Пересылка сообщения из любой группы: сразу дает кнопки управления этой группой!
        if (msg.forward_from_chat) {
          const targetChatId = msg.forward_from_chat.id;
          const targetTitle = msg.forward_from_chat.title || "этой группе";
          KNOWN_CHATS.set(targetChatId, targetTitle);

          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `📍 <b>Обнаружен чат: «${targetTitle}»</b>\nID: <code>${targetChatId}</code>\n\nВыберите действие:`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: `🚪 Выйти из «${targetTitle}»`, callback_data: `leave_chat_${targetChatId}` }],
                [{ text: `🔊 Снять с меня мут в «${targetTitle}»`, callback_data: `unmute_chat_${targetChatId}` }],
                [{ text: "⬅️ В кабинет", callback_data: "act_back_dashboard" }]
              ]
            }
          });
          return new Response("OK");
        }

        // 2. Команды вызова кабинета
        const dash = renderDashboard(userId, msg.from.username);
        await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: dash.text,
          parse_mode: "HTML",
          reply_markup: dash.reply_markup
        });
        return new Response("OK");
      }

      // ==========================================
      // ОБРАБОТКА КОМАНД В ГРУППЕ
      // ==========================================
      const rawText = (msg.text || msg.caption || "").trim();
      const lowerText = rawText.toLowerCase();
      const parts = rawText.split(/\s+/);
      const firstWord = parts[0].toLowerCase().replace(/@.+$/, '');

      // Команды выхода бота из группы (понимает: /leave, /leavechat, выйди, бот выйди, ливни)
      if (firstWord === "/leave" || firstWord === "/leavechat" || lowerText === "выйди" || lowerText === "бот выйди" || lowerText === "ливни") {
        await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: "👋 До свидания! Бот выходит из чата.",
          parse_mode: "HTML"
        });
        await tgApi(token, "leaveChat", { chat_id: chatId });
        return new Response("OK");
      }

      // Проверка: является ли сообщение командой
      const isCommand = firstWord.startsWith("/") ||
        ["мут", "размут", "бан", "кик", "дел", "варн", "правила", "настройки"].includes(firstWord);

      if (isCommand) {
        // Команда /rules или "правила"
        if (firstWord === "/rules" || firstWord === "правила") {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "📜 <b>ПРАВИЛА НАШЕГО ЧАТА:</b>\n\n" +
                  "1. 🚨 <b>Спам, реклама, криптовалюты и схемы заработка</b> — бан.\n" +
                  `2. 🔗 <b>Ссылки</b> — ${chatSettings.enable_links ? `мут на ${formatDuration(chatSettings.mute_links_sec)}` : 'разрешены'}.\n` +
                  `3. 🤬 <b>Мат</b> — ${chatSettings.enable_profanity ? 'запрещен' : 'разрешен'}.\n` +
                  `4. 📢 <b>Капслок</b> — ${chatSettings.enable_caps ? 'запрещен' : 'разрешен'}.\n\n` +
                  "<i>Бот модерирует группу автоматически.</i>",
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        // Проверяем права отправителя (владелец @deathh1337 всегда имеет права)
        const userIsAdmin = isOwner || await isAdmin(token, chatId, userId);

        // Команда /settings или "настройки"
        if (firstWord === "/settings" || firstWord === "/config" || firstWord === "настройки") {
          if (!userIsAdmin) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ <b>Панель /settings доступна только администраторам группы!</b>",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }

          const payload = renderMainMenu(chatId, msg.chat.title, chatSettings);
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: payload.text,
            parse_mode: "HTML",
            reply_markup: payload.reply_markup
          });
          return new Response("OK");
        }

        // Если команду вызвал не админ, не выполняем модераторские команды
        if (!userIsAdmin) {
          return new Response("OK");
        }

        // Команда /del или "дел"
        if (firstWord === "/del" || firstWord === "дел" || firstWord === "удалить") {
          if (msg.reply_to_message) {
            await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.reply_to_message.message_id });
          }
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          return new Response("OK");
        }

        // Команда /kick или "кик"
        if (firstWord === "/kick" || firstWord === "кик" || firstWord === "выгнать") {
          if (!msg.reply_to_message || !msg.reply_to_message.from) {
            await tgApi(token, "sendMessage", { chat_id: chatId, text: "⚠️ Ответьте на сообщение участника: <code>кик</code>", parse_mode: "HTML" });
            return new Response("OK");
          }
          const targetUser = msg.reply_to_message.from;
          await tgApi(token, "banChatMember", { chat_id: chatId, user_id: targetUser.id });
          await tgApi(token, "unbanChatMember", { chat_id: chatId, user_id: targetUser.id });
          const mention = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;
          await tgApi(token, "sendMessage", { chat_id: chatId, text: `👢 Пользователь ${mention} выгнан из группы.`, parse_mode: "HTML" });
          return new Response("OK");
        }

        // Команда /ban или "бан"
        if (firstWord === "/ban" || firstWord === "бан") {
          if (!msg.reply_to_message || !msg.reply_to_message.from) {
            await tgApi(token, "sendMessage", { chat_id: chatId, text: "⚠️ Ответьте на сообщение участника: <code>бан</code>", parse_mode: "HTML" });
            return new Response("OK");
          }
          const targetUser = msg.reply_to_message.from;
          await tgApi(token, "banChatMember", { chat_id: chatId, user_id: targetUser.id });
          const mention = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;
          await tgApi(token, "sendMessage", { chat_id: chatId, text: `⛔ Пользователь ${mention} навсегда забанен.`, parse_mode: "HTML" });
          return new Response("OK");
        }

        // Команда /mute или "мут" (пример: мут 30м, мут 2ч, мут 1д)
        if (firstWord === "/mute" || firstWord === "мут") {
          if (!msg.reply_to_message || !msg.reply_to_message.from) {
            await tgApi(token, "sendMessage", { chat_id: chatId, text: "⚠️ Ответьте на сообщение нарушителя: <code>мут 30м</code> (или <code>2h</code>, <code>1d</code>)", parse_mode: "HTML" });
            return new Response("OK");
          }
          const targetUser = msg.reply_to_message.from;
          const durationStr = parts[1] || "24h";
          const seconds = parseDurationInput(durationStr) || 86400;
          const untilDate = Math.floor(Date.now() / 1000) + seconds;
          await tgApi(token, "restrictChatMember", {
            chat_id: chatId,
            user_id: targetUser.id,
            permissions: { can_send_messages: false },
            until_date: untilDate
          });
          const mention = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `🔇 Пользователь ${mention} замучен на <b>${durationStr}</b>.`,
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        // Команда /unmute или "размут"
        if (firstWord === "/unmute" || firstWord === "размут" || firstWord === "размутить") {
          let targetUser = msg.reply_to_message?.from;
          let targetId = targetUser?.id || parts[1];

          if (!targetId) {
            await tgApi(token, "sendMessage", { chat_id: chatId, text: "⚠️ Ответьте на сообщение пользователя или укажите ID: <code>размут [ID]</code>", parse_mode: "HTML" });
            return new Response("OK");
          }

          await tgApi(token, "restrictChatMember", {
            chat_id: chatId,
            user_id: targetId,
            permissions: {
              can_send_messages: true,
              can_send_audios: true,
              can_send_documents: true,
              can_send_photos: true,
              can_send_videos: true,
              can_send_other_messages: true,
              can_add_web_page_previews: true
            }
          });
          const mention = targetUser ? (targetUser.username ? `@${targetUser.username}` : targetUser.first_name) : `ID ${targetId}`;
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `🔊 Мут с пользователя ${mention} снят!`,
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        return new Response("OK");
      }

      // ==========================================
      // АВТО-МОДЕРАЦИЯ СООБЩЕНИЙ УЧАСТНИКОВ
      // ==========================================
      // Владелец @deathh1337 и администраторы имеют полный иммунитет
      if (isOwner) {
        return new Response("OK");
      }

      const senderIsAdmin = await isAdmin(token, chatId, userId);
      if (senderIsAdmin) {
        return new Response("OK");
      }

      const mention = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

      // 1. Проверка на спам/скам/рекламу -> БАН НАВСЕГДА
      if (chatSettings.enable_spam) {
        const scamReason = checkScamOrPromo(msg);
        if (scamReason) {
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          await tgApi(token, "banChatMember", { chat_id: chatId, user_id: userId });

          const alertRes = await (await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `🚨 <b>Нарушитель заблокирован!</b>\n` +
                  `👤 ${mention} нарушил: <b>${scamReason}</b>`,
            parse_mode: "HTML"
          })).json();

          if (alertRes.ok && alertRes.result?.message_id) {
            ctx.waitUntil(new Promise(resolve => {
              setTimeout(async () => {
                await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: alertRes.result.message_id });
                resolve();
              }, chatSettings.auto_delete_sec * 1000);
            }));
          }
          return new Response("OK");
        }
      }

      // 2. Проверка на ссылки -> МУТ
      if (chatSettings.enable_links && hasLinks(msg)) {
        await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
        const untilDate = Math.floor(Date.now() / 1000) + chatSettings.mute_links_sec;
        await tgApi(token, "restrictChatMember", {
          chat_id: chatId,
          user_id: userId,
          permissions: { can_send_messages: false },
          until_date: untilDate
        });

        const alertRes = await (await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: `🔇 ${mention} <b>отправлен в мут на ${formatDuration(chatSettings.mute_links_sec)}!</b>\n` +
                `⛔ Причина: <b>Ссылки запрещены</b>`,
          parse_mode: "HTML"
        })).json();

        if (alertRes.ok && alertRes.result?.message_id) {
          ctx.waitUntil(new Promise(resolve => {
            setTimeout(async () => {
              await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: alertRes.result.message_id });
              resolve();
            }, chatSettings.auto_delete_sec * 1000);
          }));
        }
        return new Response("OK");
      }

    } catch (err) {
      console.error(err);
    }

    return new Response("OK");
  }
};
