// Cloudflare Worker: Telegram Moderator Bot (ShinyModeration)
// Ультимативный, безопасный бот-модератор с разграничением прав доступа (Владелец vs Обычные пользователи)

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
  enable_links: true,        // Блокировка ссылок и рекламы
  enable_profanity: false,   // Маты отключены (по умолчанию не мутить)
  enable_spam: true,         // Блокировка скама/крипты/заработка
  enable_caps: false,        // Капс отключен (по умолчанию не мутить)
  clean_service: false,      // Чистка сервисных сообщений (вход/выход)
  max_caps_percent: 85,
  auto_delete_sec: 5,        // Быстрое исчезновение алертов (5 сек)
  mute_links_sec: 86400,     // 24 часа
  mute_profanity_sec: 7200,  // 2 часа
  mute_caps_sec: 900         // 15 минут
};

// Единственные официальные владельцы бота с полным глобальным иммунитетом
const OWNER_USERNAMES = ["fuckingmyhearts", "deathh1337"];

// Хранилище настроек, известных чатов и проверенных ID владельцев
const CHAT_SETTINGS = new Map();
const KNOWN_CHATS = new Map();
const OWNER_IDS = new Set();

// Проверка: является ли пользователь владельцем бота
function checkIsOwner(userId, username) {
  if (username && OWNER_USERNAMES.includes(username.toLowerCase())) {
    return true;
  }
  if (userId && OWNER_IDS.has(userId)) {
    return true;
  }
  return false;
}

// Предзагрузка известных чатов и прав из кэша Cloudflare Edge
async function loadCacheState() {
  try {
    const cache = caches.default;
    const req = new Request("https://shiny-storage.internal/state");
    const res = await cache.match(req);
    if (res) {
      const data = await res.json();
      if (data.chats) {
        for (const [id, title] of Object.entries(data.chats)) {
          KNOWN_CHATS.set(parseInt(id, 10), title);
        }
      }
      if (data.settings) {
        for (const [id, s] of Object.entries(data.settings)) {
          CHAT_SETTINGS.set(parseInt(id, 10), s);
        }
      }
      if (data.owners && Array.isArray(data.owners)) {
        for (const id of data.owners) {
          OWNER_IDS.add(id);
        }
      }
    }
  } catch (e) {}
}

async function saveCacheState(ctx) {
  try {
    const cache = caches.default;
    const req = new Request("https://shiny-storage.internal/state");
    const data = {
      chats: Object.fromEntries(KNOWN_CHATS),
      settings: Object.fromEntries(CHAT_SETTINGS),
      owners: Array.from(OWNER_IDS)
    };
    const res = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "max-age=2592000"
      }
    });
    if (ctx?.waitUntil) {
      ctx.waitUntil(cache.put(req, res));
    } else {
      await cache.put(req, res);
    }
  } catch (e) {}
}

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

async function saveChatSettings(env, ctx, chatId, newSettings) {
  const merged = { ...DEFAULT_SETTINGS, ...newSettings };
  CHAT_SETTINGS.set(chatId, merged);
  if (env?.SETTINGS_KV) {
    try {
      await env.SETTINGS_KV.put(`settings_${chatId}`, JSON.stringify(merged));
    } catch (e) {}
  }
  await saveCacheState(ctx);
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

// Запросы к Telegram API
async function tgApi(token, method, data) {
  return await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

// Проверка: является ли пользователь админом группы
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

// Личный кабинет в ЛС с четким разделением прав (Владелец vs Обычные пользователи)
function renderDashboard(userId, username, isOwner) {
  const botUsername = "shinymoderation_bot";
  const addUrl = `https://t.me/${botUsername}?startgroup=true&admin=delete_messages+restrict_members`;

  if (isOwner) {
    // Панель только для реального владельца (@fuckingmyhearts / @deathh1337)
    const text =
      `👑 <b>Панель Главного Владельца</b>\n\n` +
      `👤 <b>Пользователь:</b> @${username || userId}\n` +
      `⚡ <b>Статус:</b> Главный создатель бота (Полный иммунитет активен)\n\n` +
      `<i>Вам доступен полный контроль над ботом и всеми подключенными группами:</i>`;

    const reply_markup = {
      inline_keyboard: [
        [
          { text: "➕ Добавить в группу (с правами)", url: addUrl }
        ],
        [
          { text: "⚙️ Настройки модерации", callback_data: "act_settings_menu" },
          { text: "🔊 Снять с меня мут", callback_data: "act_unmuteme" }
        ],
        [
          { text: "🚪 Выйти из группы", callback_data: "act_leave_menu" },
          { text: "📖 Список команд", callback_data: "act_commands_help" }
        ]
      ]
    };
    return { text, reply_markup };
  } else {
    // Панель для ВСЕХ остальных пользователей (без иммунитета и без прав управления)
    const text =
      `🛡️ <b>ShinyModeration — Бот-модератор для групп</b>\n\n` +
      `👤 <b>Пользователь:</b> @${username || userId}\n` +
      `🔰 <b>Статус:</b> Пользователь (Иммунитета нет)\n\n` +
      `Я защищаю группы Telegram от спама, скама, рекламы и нарушителей 24/7.\n\n` +
      `<b>Хотите подключить бота в свою группу?</b>\n` +
      `Нажмите кнопку ниже и назначьте бота Администратором.`;

    const reply_markup = {
      inline_keyboard: [
        [
          { text: "➕ Добавить бота в группу", url: addUrl }
        ],
        [
          { text: "📖 Список команд и правил", callback_data: "act_commands_help" }
        ]
      ]
    };
    return { text, reply_markup };
  }
}

// Панель настроек модерации для конкретного чата (используется и в группе, и в ЛС)
function renderChatSettingsPanel(chatId, chatTitle, s, isPm = false) {
  const text =
    `⚙️ <b>Настройки модератора для группы:</b>\n` +
    `📍 <b>${chatTitle || "Этот чат"}</b> (ID: <code>${chatId}</code>)\n\n` +
    `🔗 <b>Ссылки и реклама:</b> ${s.enable_links ? '✅ ВКЛ' : '❌ ВЫКЛ'} (Мут: <b>${formatDuration(s.mute_links_sec)}</b>)\n` +
    `🚨 <b>Анти-скам / крипта:</b> ${s.enable_spam ? '✅ ВКЛ' : '❌ ВЫКЛ'} (Кара: <b>БАН</b>)\n` +
    `🤬 <b>Анти-мат:</b> ${s.enable_profanity ? '✅ ВКЛ' : '❌ ВЫКЛ'}\n` +
    `📢 <b>Анти-капс:</b> ${s.enable_caps ? '✅ ВКЛ' : '❌ ВЫКЛ'}\n` +
    `🧹 <b>Чистка сервисных:</b> ${s.clean_service ? '✅ ВКЛ' : '❌ ВЫКЛ'}\n\n` +
    `<i>Нажмите на кнопку, чтобы мгновенно переключить:</i>`;

  const prefix = isPm ? `pm_cfg_${chatId}_` : "cfg_";

  const buttons = [
    [
      { text: s.enable_links ? "🔗 Ссылки: ВКЛ" : "🔗 Ссылки: ВЫКЛ", callback_data: `${prefix}toggle_links` },
      { text: `⏱️ Мут: ${formatDuration(s.mute_links_sec)}`, callback_data: `${prefix}menu_links` }
    ],
    [
      { text: s.enable_spam ? "🚨 Скам: ВКЛ" : "🚨 Скам: ВЫКЛ", callback_data: `${prefix}toggle_spam` },
      { text: s.clean_service ? "🧹 Чистка: ВКЛ" : "🧹 Чистка: ВЫКЛ", callback_data: `${prefix}toggle_service` }
    ],
    [
      { text: s.enable_profanity ? "🤬 Мат: ВКЛ" : "🤬 Мат: ВЫКЛ", callback_data: `${prefix}toggle_prof` },
      { text: s.enable_caps ? "📢 Капс: ВКЛ" : "📢 Капс: ВЫКЛ", callback_data: `${prefix}toggle_caps` }
    ]
  ];

  if (isPm) {
    buttons.push([
      { text: `🔊 Снять мут в чате`, callback_data: `unmute_chat_${chatId}` },
      { text: `🚪 Выйти из чата`, callback_data: `leave_chat_${chatId}` }
    ]);
    buttons.push([
      { text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }
    ]);
  } else {
    buttons.push([
      { text: "🔄 Сброс", callback_data: "cfg_reset" },
      { text: "❌ Закрыть панель", callback_data: "cfg_close" }
    ]);
  }

  return { text, reply_markup: { inline_keyboard: buttons } };
}

// Меню выбора длительности мута за ссылки
function renderMuteLinksMenu(s, chatId, isPm = false) {
  const prefix = isPm ? `pm_cfg_${chatId}_` : "cfg_";
  const backCallback = isPm ? `pm_cfg_chat_${chatId}` : "cfg_main";

  const text =
    `⏱️ <b>Длительность мута за ссылки:</b>\n` +
    `Текущее значение: <b>${formatDuration(s.mute_links_sec)}</b>\n\n` +
    `<i>Выберите время мута:</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "15 мин", callback_data: `${prefix}set_links_900` },
        { text: "1 час", callback_data: `${prefix}set_links_3600` },
        { text: "6 часов", callback_data: `${prefix}set_links_21600` }
      ],
      [
        { text: "12 часов", callback_data: `${prefix}set_links_43200` },
        { text: "24 часа (1 д)", callback_data: `${prefix}set_links_86400` },
        { text: "7 дней", callback_data: `${prefix}set_links_604800` }
      ],
      [
        { text: "⬅️ Назад к настройкам", callback_data: backCallback }
      ]
    ]
  };
  return { text, reply_markup };
}

// Обработка инлайн-кнопок
async function handleCallbackQuery(token, env, ctx, cq) {
  const chatId = cq.message?.chat?.id;
  const userId = cq.from?.id;
  const username = cq.from?.username ? cq.from.username.toLowerCase() : "";
  const isOwner = checkIsOwner(userId, username);
  if (isOwner && userId) {
    OWNER_IDS.add(userId);
  }
  const messageId = cq.message?.message_id;
  const data = cq.data || "";

  if (!chatId || !userId) return new Response("OK");

  // 1. Снять с меня мут (ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА)
  if (data === "act_unmuteme") {
    if (!isOwner) {
      await tgApi(token, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "❌ Функция саморазмута доступна только создателю бота!",
        show_alert: true
      });
      return new Response("OK");
    }

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

    const alertMsg = unmutedCount > 0
      ? `🔊 Мут снят в ${unmutedCount} группах! Вы можете писать сообщения.`
      : "🔊 Мут снят!";

    await tgApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: alertMsg,
      show_alert: true
    });

    if (cq.message?.chat?.type === "private") {
      const dash = renderDashboard(userId, cq.from?.username, isOwner);
      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: `🔊 <b>Мут успешно снят!</b>\nВсе ограничения сняты.\n\n` + dash.text,
        parse_mode: "HTML",
        reply_markup: dash.reply_markup
      });
    }
    return new Response("OK");
  }

  // 2. Меню "Выйти из группы" (ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА)
  if (data === "act_leave_menu") {
    if (!isOwner) {
      await tgApi(token, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "❌ Управление выходом доступно только владельцу бота!",
        show_alert: true
      });
      return new Response("OK");
    }

    if (KNOWN_CHATS.size > 0) {
      const buttons = [];
      for (const [cId, title] of KNOWN_CHATS.entries()) {
        buttons.push([{ text: `🚪 Выйти из «${title}»`, callback_data: `leave_chat_${cId}` }]);
      }
      buttons.push([{ text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }]);

      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text:
          "🚪 <b>Выберите группу, из которой боту нужно выйти:</b>\n\n" +
          "<i>💡 Вы также можете просто написать «выйди» прямо в самом чате группы!</i>",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text:
          "🚪 <b>Как попросить бота выйти из группы:</b>\n\n" +
          "1️⃣ <b>Самый простой способ:</b> Напишите в самом чате (например, в «9А») слово: <code>выйди</code> — бот сразу выйдет!\n\n" +
          "2️⃣ <b>Либо перешлите сюда</b> любое сообщение из этой группы — появится кнопка выхода в один клик.",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }]]
        }
      });
    }
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("OK");
  }

  // 3. Меню "Настройки модерации" в ЛС (ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА)
  if (data === "act_settings_menu") {
    if (!isOwner) {
      await tgApi(token, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "❌ Настройки групп доступны только владельцу бота!",
        show_alert: true
      });
      return new Response("OK");
    }

    if (KNOWN_CHATS.size === 1) {
      const [onlyChatId, onlyTitle] = Array.from(KNOWN_CHATS.entries())[0];
      const settings = await getChatSettings(env, onlyChatId);
      const payload = renderChatSettingsPanel(onlyChatId, onlyTitle, settings, true);
      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: payload.text,
        parse_mode: "HTML",
        reply_markup: payload.reply_markup
      });
    } else if (KNOWN_CHATS.size > 1) {
      const buttons = [];
      for (const [cId, title] of KNOWN_CHATS.entries()) {
        buttons.push([{ text: `📍 ${title}`, callback_data: `pm_cfg_chat_${cId}` }]);
      }
      buttons.push([{ text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }]);

      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "⚙️ <b>Выберите группу для настройки фильтров:</b>",
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
      });
    } else {
      await tgApi(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text:
          "⚙️ <b>Настройки модерации групп</b>\n\n" +
          "У вас пока нет сохраненных групп.\n\n" +
          "<b>Как подключить группу:</b>\n" +
          "1. Добавьте бота в чат и сделайте Администратором.\n" +
          "2. Либо просто <b>перешлите сюда любое сообщение</b> из группы!\n\n" +
          "<i>После этого вы сможете включать/выключать фильтры прямо отсюда.</i>",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "➕ Добавить в группу", url: "https://t.me/shinymoderation_bot?startgroup=true&admin=delete_messages+restrict_members" }],
            [{ text: "⬅️ Назад в кабинет", callback_data: "act_back_dashboard" }]
          ]
        }
      });
    }
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("OK");
  }

  // 4. Открытие настроек конкретного чата из ЛС (ТОЛЬКО ВЛАДЕЛЕЦ)
  if (data.startsWith("pm_cfg_chat_")) {
    if (!isOwner) {
      await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "❌ Доступ запрещен!", show_alert: true });
      return new Response("OK");
    }
    const targetChatId = parseInt(data.replace("pm_cfg_chat_", ""), 10);
    const title = KNOWN_CHATS.get(targetChatId) || `Чат ${targetChatId}`;
    const settings = await getChatSettings(env, targetChatId);
    const payload = renderChatSettingsPanel(targetChatId, title, settings, true);
    await tgApi(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: payload.text,
      parse_mode: "HTML",
      reply_markup: payload.reply_markup
    });
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("OK");
  }

  // 5. Обработка переключателей настроек из ЛС (pm_cfg_<chatId>_<action>) (ТОЛЬКО ВЛАДЕЛЕЦ)
  if (data.startsWith("pm_cfg_")) {
    if (!isOwner) {
      await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "❌ Доступ запрещен!", show_alert: true });
      return new Response("OK");
    }
    const parts = data.replace("pm_cfg_", "").split("_");
    const targetChatId = parseInt(parts[0], 10);
    const action = parts.slice(1).join("_");
    const settings = await getChatSettings(env, targetChatId);
    const title = KNOWN_CHATS.get(targetChatId) || `Чат ${targetChatId}`;

    let changed = false;
    let showLinksMenu = false;

    if (action === "toggle_links") {
      settings.enable_links = !settings.enable_links;
      changed = true;
    } else if (action === "toggle_spam") {
      settings.enable_spam = !settings.enable_spam;
      changed = true;
    } else if (action === "toggle_prof") {
      settings.enable_profanity = !settings.enable_profanity;
      changed = true;
    } else if (action === "toggle_caps") {
      settings.enable_caps = !settings.enable_caps;
      changed = true;
    } else if (action === "toggle_service") {
      settings.clean_service = !settings.clean_service;
      changed = true;
    } else if (action === "menu_links") {
      showLinksMenu = true;
    } else if (action.startsWith("set_links_")) {
      settings.mute_links_sec = parseInt(action.replace("set_links_", ""), 10);
      changed = true;
    }

    if (changed) {
      await saveChatSettings(env, ctx, targetChatId, settings);
      await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "✅ Сохранено!" });
    } else {
      await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    }

    let payload;
    if (showLinksMenu) {
      payload = renderMuteLinksMenu(settings, targetChatId, true);
    } else {
      payload = renderChatSettingsPanel(targetChatId, title, settings, true);
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

  // 6. Выход из группы по кнопке
  if (data.startsWith("leave_chat_")) {
    const targetChatId = data.replace("leave_chat_", "");
    const canLeave = isOwner || await isAdmin(token, targetChatId, userId);
    if (!canLeave) {
      await tgApi(token, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "❌ У вас нет прав на управление этой группой!",
        show_alert: true
      });
      return new Response("OK");
    }

    try {
      const res = await tgApi(token, "leaveChat", { chat_id: targetChatId });
      const resData = await res.json();
      if (resData.ok) {
        KNOWN_CHATS.delete(parseInt(targetChatId, 10));
        await saveCacheState(ctx);
        await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "✅ Бот покинул чат!" });
        await tgApi(token, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: `🚪 <b>Бот успешно покинул группу (ID: <code>${targetChatId}</code>)!</b>`,
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

  // 7. Размут в конкретном чате по кнопке
  if (data.startsWith("unmute_chat_")) {
    const targetChatId = data.replace("unmute_chat_", "");
    if (!isOwner && !await isAdmin(token, targetChatId, userId)) {
      await tgApi(token, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: "❌ Снять мут может только владелец бота или администратор группы!",
        show_alert: true
      });
      return new Response("OK");
    }

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

  // 8. Возврат в кабинет
  if (data === "act_back_dashboard") {
    const dash = renderDashboard(userId, cq.from?.username, isOwner);
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

  // 9. Справка по командам
  if (data === "act_commands_help") {
    const helpText =
      "📖 <b>Команды модератора (ответом на сообщение нарушителя):</b>\n\n" +
      "• <code>мут 30м</code> или <code>/mute 30m</code> — замутить\n" +
      "• <code>размут</code> или <code>/unmute</code> — снять ограничения\n" +
      "• <code>кик</code> или <code>/kick</code> — выгнать из группы\n" +
      "• <code>бан</code> или <code>/ban</code> — заблокировать навсегда\n" +
      "• <code>дел</code> или <code>/del</code> — быстро удалить спам\n" +
      "• <code>выйди</code> или <code>/leave</code> — бот выйдет из группы\n" +
      "• <code>/settings</code> — открыть меню настроек\n\n" +
      "<i>Бот понимает как английские команды со слешем (/), так и обычные русские слова!</i>";

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

  // 10. Кнопка "Закрыть" меню настроек в группе
  if (data === "cfg_close") {
    await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Панель закрыта" });
    return new Response("OK");
  }

  // 11. Настройки внутри группы: проверка прав администратора
  if (!isOwner && !await isAdmin(token, chatId, userId)) {
    await tgApi(token, "answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "❌ Только администраторы группы могут менять настройки!",
      show_alert: true
    });
    return new Response("OK");
  }

  const settings = await getChatSettings(env, chatId);
  let changed = false;
  let subMenu = null;

  if (data === "cfg_main") {
    const payload = renderChatSettingsPanel(chatId, cq.message?.chat?.title, settings, false);
    await tgApi(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: payload.text,
      parse_mode: "HTML",
      reply_markup: payload.reply_markup
    });
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    return new Response("OK");
  }

  if (data === "cfg_reset") {
    await saveChatSettings(env, ctx, chatId, DEFAULT_SETTINGS);
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Настройки сброшены!" });
    const payload = renderChatSettingsPanel(chatId, cq.message?.chat?.title, DEFAULT_SETTINGS, false);
    await tgApi(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: payload.text,
      parse_mode: "HTML",
      reply_markup: payload.reply_markup
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
    await saveChatSettings(env, ctx, chatId, settings);
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "✅ Сохранено!" });
  } else {
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
  }

  const chatTitle = cq.message?.chat?.title || "Этот чат";
  let payload;
  if (subMenu === "links") {
    payload = renderMuteLinksMenu(settings, chatId, false);
  } else {
    payload = renderChatSettingsPanel(chatId, chatTitle, settings, false);
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

    // Инициализация кэша
    await loadCacheState();

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

    if (url.pathname === "/debug-chats") {
      return new Response(JSON.stringify({
        known_chats: Object.fromEntries(KNOWN_CHATS),
        owner_ids: Array.from(OWNER_IDS)
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/set-commands") {
      const commands = [
        { command: "start", description: "Личный кабинет / Информация" },
        { command: "settings", description: "Настройки модератора и мутов" },
        { command: "rules", description: "Показать правила чата" },
        { command: "help", description: "Помощь по командам" },
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
      return new Response("ShinyModeration Bot is active and healthy!", { status: 200 });
    }

    try {
      const update = await request.json();

      // 1. Обработка кликов по инлайн-кнопкам
      if (update.callback_query) {
        return await handleCallbackQuery(token, env, ctx, update.callback_query);
      }

      const msg = update.message;
      if (!msg || !msg.chat) {
        return new Response("OK");
      }

      const chatId = msg.chat.id;
      const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

      if (isGroup) {
        KNOWN_CHATS.set(chatId, msg.chat.title || `Чат ${chatId}`);
        await saveCacheState(ctx);
      }

      const chatSettings = await getChatSettings(env, chatId);

      // Специальное правило для чата 9А: маты и капс полностью отключены!
      if (msg.chat.title && /9\s*[аa]/i.test(msg.chat.title)) {
        chatSettings.enable_profanity = false;
        chatSettings.enable_caps = false;
      }

      // Приветствие при добавлении бота в новую группу
      if (msg.new_chat_members) {
        const botJoined = msg.new_chat_members.some(u => u.is_bot && (u.username === "shinymoderation_bot" || u.id === 8227600059));
        if (botJoined) {
          KNOWN_CHATS.set(chatId, msg.chat.title || `Чат ${chatId}`);
          await saveCacheState(ctx);

          const welcomeText =
            `🛡️ <b>Всем привет! Я ShinyModeration — ваш бот-модератор.</b>\n\n` +
            `Я защищаю группу от спама, рекламы, ссылок и нарушителей 24/7.\n\n` +
            `⚡ <b>Для работы защиты:</b>\n` +
            `Назначьте меня <b>Администратором</b> с правами:\n` +
            `• <i>Удаление сообщений</i>\n` +
            `• <i>Блокировка участников</i>\n\n` +
            `⚙️ <b>Настройки:</b> <code>/settings</code> | 📜 <b>Правила:</b> <code>/rules</code> | 🚪 <b>Выход:</b> <code>выйди</code>`;

          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: welcomeText,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "⚙️ Настройки чата", callback_data: "cfg_main" },
                  { text: "📖 Список команд", callback_data: "act_commands_help" }
                ],
                [
                  { text: "👤 Личный кабинет (в ЛС)", url: "https://t.me/shinymoderation_bot?start=panel" }
                ]
              ]
            }
          });
          return new Response("OK");
        }

        // Если включена чистка сервисных сообщений
        if (chatSettings.clean_service) {
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          return new Response("OK");
        }
      }

      // Чистка сервисных сообщений (выход, закреп)
      if (msg.left_chat_member || msg.pinned_message) {
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

      // Строгое определение владельца: ТОЛЬКО @fuckingmyhearts и @deathh1337
      const isOwner = checkIsOwner(userId, username);

      if (isOwner && userId) {
        OWNER_IDS.add(userId);
      }

      // ==========================================
      // ЛИЧНЫЕ СООБЩЕНИЯ С БОТОМ (Личный кабинет)
      // ==========================================
      if (msg.chat.type === "private") {
        const text = (msg.text || "").trim();
        const lower = text.toLowerCase();

        // 1. Пересылка сообщения из любой группы (доступна только владельцу)
        if (msg.forward_from_chat) {
          if (!isOwner) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ Управление ботом через пересылку сообщений доступно только владельцу бота.",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }

          const targetChatId = msg.forward_from_chat.id;
          const targetTitle = msg.forward_from_chat.title || "этой группе";
          KNOWN_CHATS.set(targetChatId, targetTitle);
          await saveCacheState(ctx);

          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text:
              `📍 <b>Обнаружена группа: «${targetTitle}»</b>\n` +
              `ID: <code>${targetChatId}</code>\n\n` +
              `<i>Что вы хотите сделать?</i>`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: `⚙️ Настройки «${targetTitle}»`, callback_data: `pm_cfg_chat_${targetChatId}` }
                ],
                [
                  { text: `🔊 Снять с меня мут`, callback_data: `unmute_chat_${targetChatId}` },
                  { text: `🚪 Выйти из группы`, callback_data: `leave_chat_${targetChatId}` }
                ],
                [
                  { text: "⬅️ В главный кабинет", callback_data: "act_back_dashboard" }
                ]
              ]
            }
          });
          return new Response("OK");
        }

        // 2. Обработка текстовых команд на выход из группы в ЛС (только владелец)
        if (lower.includes("выйди") || lower.includes("выйти") || lower.includes("leave") || lower.includes("ливай")) {
          if (!isOwner) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "❌ Выход из групп через личные сообщения доступен только владельцу бота.",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }

          let matchedChatId = null;
          let matchedTitle = null;

          for (const [cId, title] of KNOWN_CHATS.entries()) {
            if (lower.includes(title.toLowerCase()) || (/9\s*[аa]/i.test(title) && /9\s*[аa]/i.test(lower))) {
              matchedChatId = cId;
              matchedTitle = title;
              break;
            }
          }

          if (matchedChatId) {
            try {
              await tgApi(token, "leaveChat", { chat_id: matchedChatId });
              KNOWN_CHATS.delete(matchedChatId);
              await saveCacheState(ctx);
              await tgApi(token, "sendMessage", {
                chat_id: chatId,
                text: `🚪 <b>Бот успешно покинул группу «${matchedTitle}»!</b>`,
                parse_mode: "HTML",
                reply_markup: {
                  inline_keyboard: [[{ text: "⬅️ В кабинет", callback_data: "act_back_dashboard" }]]
                }
              });
            } catch (e) {
              await tgApi(token, "sendMessage", {
                chat_id: chatId,
                text: `❌ Ошибка при выходе: ${e.message}`,
                parse_mode: "HTML"
              });
            }
            return new Response("OK");
          }

          if (KNOWN_CHATS.size > 0) {
            const buttons = [];
            for (const [cId, title] of KNOWN_CHATS.entries()) {
              buttons.push([{ text: `🚪 Выйти из «${title}»`, callback_data: `leave_chat_${cId}` }]);
            }
            buttons.push([{ text: "⬅️ В кабинет", callback_data: "act_back_dashboard" }]);

            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "🚪 <b>Выберите группу, из которой боту нужно выйти:</b>",
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: buttons }
            });
            return new Response("OK");
          } else {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text:
                "🚪 <b>Как сделать так, чтобы бот вышел:</b>\n\n" +
                "1️⃣ <b>Самый быстрый способ:</b> Напишите в самом чате (например, в «9А») слово: <code>выйди</code> — бот сразу покинет чат!\n\n" +
                "2️⃣ <b>Либо перешлите сюда</b> любое сообщение из вашей группы, чтобы бот увидел её ID.",
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[{ text: "⬅️ В кабинет", callback_data: "act_back_dashboard" }]]
              }
            });
            return new Response("OK");
          }
        }

        // 3. Обработка текстового размута в ЛС (только владелец)
        if (lower.includes("размут") || lower.includes("сними мут") || lower.includes("unmute")) {
          if (!isOwner) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "❌ Саморазмут через ЛС доступен только владельцу бота. Обратитесь к администраторам группы.",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }

          let count = 0;
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
              count++;
            } catch (e) {}
          }
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `🔊 <b>Мут снят!</b> Все ограничения на отправку сообщений сняты. Можете писать в чат!`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "⬅️ В кабинет", callback_data: "act_back_dashboard" }]]
            }
          });
          return new Response("OK");
        }

        // 4. Показ личного кабинета (адаптирован под статус: Владелец vs Обычный пользователь)
        const dash = renderDashboard(userId, msg.from.username, isOwner);
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

      // Команды выхода бота из группы (понимает: выйди, выйти, бот выйди, ливни, пока, /leave, /leavechat)
      if (
        lowerText === "выйди" ||
        lowerText === "выйти" ||
        lowerText === "бот выйди" ||
        lowerText === "ливни" ||
        lowerText === "пока" ||
        lowerText.startsWith("выйди из") ||
        firstWord === "/leave" ||
        firstWord === "/leavechat"
      ) {
        const canLeave = isOwner || await isAdmin(token, chatId, userId);
        if (canLeave) {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "👋 <b>До свидания! Бот выходит из чата по просьбе администратора.</b>",
            parse_mode: "HTML"
          });
          KNOWN_CHATS.delete(chatId);
          await saveCacheState(ctx);
          await tgApi(token, "leaveChat", { chat_id: chatId });
        } else {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "⚠️ Только администраторы чата могут попросить бота выйти.",
            parse_mode: "HTML"
          });
        }
        return new Response("OK");
      }

      // Проверка на /start, /help, помощь в группе
      if (firstWord === "/start" || firstWord === "/help" || firstWord === "помощь" || firstWord === "старт") {
        const helpText =
          `🛡️ <b>ShinyModeration — Модератор чата</b>\n\n` +
          `📍 <b>Чат:</b> ${msg.chat.title || "Этот чат"}\n\n` +
          `<b>Быстрые команды (ответом на сообщение нарушителя):</b>\n` +
          `• <code>мут 30м</code> (или <code>/mute 1h</code>, <code>2d</code>) — замутить\n` +
          `• <code>размут</code> (или <code>/unmute</code>) — снять мут\n` +
          `• <code>кик</code> (или <code>/kick</code>) — выгнать из группы\n` +
          `• <code>бан</code> (или <code>/ban</code>) — забанить навсегда\n` +
          `• <code>дел</code> (или <code>/del</code>) — быстро удалить спам\n` +
          `• <code>выйди</code> (или <code>/leave</code>) — бот покинет чат\n` +
          `• <code>/settings</code> — открыть настройки чата\n\n` +
          `<i>💡 Управлять фильтрами и снимать мут можно также в ЛС у бота!</i>`;

        await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: helpText,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "⚙️ Настройки чата", callback_data: "cfg_main" },
                { text: "📜 Правила", callback_data: "act_show_rules" }
              ],
              [
                { text: "👤 Личный кабинет (в ЛС)", url: "https://t.me/shinymoderation_bot?start=panel" }
              ]
            ]
          }
        });
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
            text:
              "📜 <b>ПРАВИЛА НАШЕГО ЧАТА:</b>\n\n" +
              "1. 🚨 <b>Спам, реклама, криптовалюты и схемы заработка</b> — бан.\n" +
              `2. 🔗 <b>Ссылки</b> — ${chatSettings.enable_links ? `мут на ${formatDuration(chatSettings.mute_links_sec)}` : 'разрешены'}.\n` +
              `3. 🤬 <b>Мат</b> — ${chatSettings.enable_profanity ? 'запрещен' : 'разрешен'}.\n` +
              `4. 📢 <b>Капслок</b> — ${chatSettings.enable_caps ? 'запрещен' : 'разрешен'}.\n\n` +
              "<i>Бот модерирует группу автоматически.</i>",
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        // Проверяем права отправителя (владелец всегда имеет права)
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

          const payload = renderChatSettingsPanel(chatId, msg.chat.title, chatSettings, false);
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

        // Команда /mute или "мут"
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
      // 1. ТОЛЬКО Владельцы (@fuckingmyhearts, @deathh1337) имеют ПОСТОЯННЫЙ ГЛОБАЛЬНЫЙ ИММУНИТЕТ
      if (isOwner) {
        return new Response("OK");
      }

      // 2. Администраторы конкретной группы имеют локальный иммунитет в своем чате
      const senderIsAdmin = await isAdmin(token, chatId, userId);
      if (senderIsAdmin) {
        return new Response("OK");
      }

      // 3. У обычных участников группы ИММУНИТЕТА НЕТ! Все сообщения проверяются:
      const mention = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

      // 1. Проверка на спам/скам/рекламу -> БАН НАВСЕГДА
      if (chatSettings.enable_spam) {
        const scamReason = checkScamOrPromo(msg);
        if (scamReason) {
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          await tgApi(token, "banChatMember", { chat_id: chatId, user_id: userId });

          const alertRes = await (await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text:
              `🚨 <b>Нарушитель заблокирован!</b>\n` +
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
          text:
            `🔇 ${mention} <b>отправлен в мут на ${formatDuration(chatSettings.mute_links_sec)}!</b>\n` +
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
