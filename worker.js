// Cloudflare Worker: Telegram Hardcore Moderator Bot
// Strict zero-tolerance moderation system with customizable settings per chat

// Default Settings
const DEFAULT_SETTINGS = {
  enable_links: true,
  enable_profanity: true,
  enable_spam: true,
  enable_caps: true,
  clean_service: true,
  max_caps_percent: 65,
  auto_delete_sec: 6,
  mute_links_sec: 86400,     // 24 часа
  mute_profanity_sec: 7200,  // 2 часа
  mute_caps_sec: 900         // 15 минут
};

// Global in-memory storage for settings per chat
const CHAT_SETTINGS = new Map();

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

// Whitelist of words containing roots that might trigger false positives
const WHITELIST = [
  "рубл", "употреб", "колеб", "хлеб", "гребл", "стебл", "тереб",
  "скреб", "страх", "скипидар", "педиатр", "мудр", "бляха", "сабл",
  "сукно", "суккулент", "шахмат", "эрудит", "парикмахер", "команд",
  "мандарин", "потреб", "ибо", "пароход", "страхов"
];

// Homoglyphs and leetspeak translation
const HOMOGLYPHS = {
  'a': 'а', '@': 'а', 'b': 'в', '6': 'б', 'c': 'с', 's': 'с', '$': 'с',
  'e': 'е', '3': 'з', 'i': 'и', '1': 'и', '!': 'и', '|': 'и', 'k': 'к',
  'm': 'м', 'n': 'п', 'o': 'о', '0': 'о', 'p': 'р', 'r': 'г', 't': 'т',
  '7': 'т', 'u': 'у', 'y': 'у', 'v': 'в', 'w': 'в', 'x': 'х', 'z': 'з',
  '4': 'ч'
};

function normalizeText(text) {
  let str = (text || "").toLowerCase();
  let res = "";
  for (let ch of str) res += HOMOGLYPHS[ch] || ch;
  return res;
}

// 1. Ультимативная проверка на ссылки и рекламу
function hasLinks(msg) {
  const entities = (msg.entities || []).concat(msg.caption_entities || []);
  for (let e of entities) {
    if (e.type === "url" || e.type === "text_link") return true;
    if (e.type === "mention") return true; // Блокировка тегов @каналов и @ботов
  }

  const text = msg.text || msg.caption || "";

  // Протоколы и ссылки telegram
  if (/(?:https?:\/\/|ftps?:\/\/|tg:\/\/|t\.me\/|telegram\.me\/|telegram\.dog\/)/i.test(text)) {
    return true;
  }

  // Расширенный список доменных зон интернета
  const domainRegex = /\b[a-z0-9-]{2,}\.(?:com|ru|org|net|xyz|top|online|site|pro|app|io|me|link|live|fun|vip|to|tv|cc|gg|su|kz|by|ua|info|biz|co|tech|space|club|shop|work|agency|dev|cloud|store|click|press|group|design|trade|wiki|monster|fit|icu|pw|rest|casa|buzz|best|ooo|cyou|cfd|art|lat|one|bar|sbs)\b/i;
  if (domainRegex.test(text)) return true;

  // Замаскированные ссылки: domain[.]ru, domain(dot)com, domain точка ру, domain/com
  const obfuscatedRegex = /[a-z0-9-]{2,}\s*(?:\[\.\]|\(\.\)|\s+dot\s+|\s+точка\s+|\s*\/\s*)(?:com|ru|org|net|xyz|top|site|online|me|io)/i;
  if (obfuscatedRegex.test(text)) return true;

  // Разреженные ссылки: "t . m e /" или "w w w ."
  if (/\b(?:t\s*\.\s*m\s*e|w\s*w\s*w)\b/i.test(text)) return true;

  // Любые юзернеймы через @ в обычном тексте
  if (/(?:^|\s)@[a-zA-Z0-9_]{4,}/.test(text)) return true;

  return false;
}

// 2. Жесткий мат-фильтр с детекцией маскировки
const PROFANE_ROOTS = [
  /п[иеё]зд/i, /залуп/i, /шлюх/i, /шлюш/i, /п[ие]д[ао]р/i, /педик/i,
  /дроч/i, /елда/i, /манда/i, /муд[аио]к/i, /гондон/i, /гандон/i,
  /\bху[йиеёяю]/i, /\bпоху/i, /\bнаху/i, /\bниху/i, /\bоху/i, /\bдоху/i,
  /\bхер/i, /\b[её]б/i, /\bвыеб/i, /\bзаеб/i, /\bнаеб/i, /\bпроеб/i,
  /\bразъеб/i, /\bподъеб/i, /\bс[ъь]?еб/i, /\bебл/i, /\bебуч/i, /\bебн/i,
  /\bбл[яе][дт]/i, /\bбля\b/i, /\bсук[аиоеуы]\b/i, /\bсучк/i, /\bсучар/i,
  /\bмраз/i, /\bублюд/i, /\bтварь\b/i, /\bчмо\b/i, /\bдолбо[её]б/i,
  /\bхуесос/i, /\bпиздюк/i, /\bшалав/i, /\bшмара/i, /\bдаун\b/i, /\bкончен/i
];

function hasProfanity(text) {
  if (!text) return false;
  const norm = normalizeText(text);

  const cleaned = norm.replace(/[\s_.,!?:;\-*+~`"'\\/|@#%^&()\[\]{}]+/g, ' ');
  const tokens = cleaned.split(' ');

  const variations = [];
  for (let t of tokens) {
    const cyr = t.replace(/[^а-яё]/g, '');
    if (cyr) {
      variations.push(cyr);
      variations.push(cyr.replace(/(.)\1+/g, '$1'));
    }
  }

  let single = [];
  for (let t of tokens) {
    const c = t.replace(/[^а-яё]/g, '');
    if (c.length === 1) single.push(c);
    else {
      if (single.length >= 2) variations.push(single.join(''));
      single = [];
    }
  }
  if (single.length >= 2) variations.push(single.join(''));

  for (let v of variations) {
    if (WHITELIST.some(w => v.includes(w))) continue;
    for (let r of PROFANE_ROOTS) {
      if (r.test(v)) return true;
    }
  }
  return false;
}

// 3. База стоп-фраз мошенников, спамеров и нежелательной рекламы (КАРА: БАН НАВСЕГДА)
const SCAM_PATTERNS = [
  /пассивн(?:ый|ого|ому|ом|ым)\s+доход/i,
  /заработ(?:ок|ать|ай|ывай|аем)/i,
  /(?:доход|заработок)\s+от\s+\d+/i,
  /\d+\s*(?:тыс|к|руб|\$|usdt|евро)\s+(?:в\s+день|в\s+сутки|ежедневно)/i,
  /легкие\s+деньги/i,
  /быстр(?:ый|ые)\s+деньги/i,
  /кнопка\s+бабло/i,
  /подработк[аеиу]\s+(?:для\s+всех|на\s+дому|онлайн)/i,
  /удаленн(?:ая|ой)\s+работ[аеы]/i,
  /работа\s+без\s+опыта/i,
  /ваканси[яи]\s+онлайн/i,
  /набираю\s+(?:в\s+команду|людей|сотрудников)/i,
  /требуются\s+(?:люди|девушки|парни|сотрудники)/i,
  /вложений\s+не\s+требуется/i,
  /без\s+вложений/i,
  /пиши(?:те)?\s+(?:мне\s+)?в\s+(?:лс|личку|директ|тг)/i,
  /жду\s+в\s+(?:лс|личке)/i,
  /отве(?:тил|тила)\s+в\s+лс/i,
  /скинул[а]?\s+в\s+лс/i,
  /подробност[ией]+\s+в\s+(?:лс|профиле|описании|закрепе)/i,
  /ссылк[аеу]\s+в\s+(?:профиле|шапке|био|закрепе)/i,
  /сигнал[ыов]+\s+по\s+крипт/i,
  /инвестици[иях]\s+от/i,
  /дарю\s+(?:крипт|usdt|тон|ton|btc|биткоин)/i,
  /раздач[аеи]\s+(?:крипт|usdt|ton|монет|денег)/i,
  /арбитраж\s+(?:крипт|валют|p2p)/i,
  /связк[аи]\s+(?:p2p|п2п|крипт)/i,
  /раскрутк[аеи]\s+(?:счета|депозита)/i,
  /удвою\s+(?:баланс|депозит)/i,
  /эйрдроп|airdrop|whitelist|вайтлист/i,
  /слив\s+(?:приват|шкур|фото|видео|переписок)/i,
  /интим\s*(?:фото|видео|знакомств)/i,
  /порно|проститутка|эскорт/i,
  /меф|гашиш|бошки|закладк[иа]/i,
  /накрутк[аеи]\s+(?:подписчиков|лайков|ботов)/i,
  /взлом\s+(?:вк|тг|телеграм|аккаунт)/i,
  /продам\s+аккаунт/i,
  /кардинг|залив\s+на\s+карту/i
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

// 4. Проверка капса и спама символами
function checkCapsOrFlooding(msg, maxCapsPercent) {
  const text = msg.text || msg.caption || "";

  const letters = text.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '');
  if (letters.length >= 8) {
    const upper = letters.replace(/[^A-ZА-ЯЁ]/g, '').length;
    if ((upper / letters.length) * 100 >= (maxCapsPercent || 65)) {
      return "Злоупотребление CAPS LOCK";
    }
  }

  if (/(.)\1{20,}/.test(text)) return "Спам повторяющимися символами";

  return null;
}

async function tgApi(token, method, data) {
  return await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

async function isAdmin(token, chatId, userId) {
  try {
    const res = await (await tgApi(token, "getChatMember", { chat_id: chatId, user_id: userId })).json();
    return res.ok && (res.result.status === "creator" || res.result.status === "administrator");
  } catch (e) {
    return false;
  }
}

// ==========================================
// РЕНДЕРИНГ МЕНЮ НАСТРОЕК (INLINE KEYBOARDS)
// ==========================================

function renderMainMenu(chatId, chatTitle, s) {
  const text =
    `⚙️ <b>Панель управления модерацией:</b>\n` +
    `📍 <b>${chatTitle || "Этот чат"}</b>\n\n` +
    `🔗 <b>Фильтр ссылок:</b> ${s.enable_links ? '✅ ВКЛ' : '❌ ВЫКЛ'} (Мут: <b>${formatDuration(s.mute_links_sec)}</b>)\n` +
    `🤬 <b>Фильтр мата:</b> ${s.enable_profanity ? '✅ ВКЛ' : '❌ ВЫКЛ'} (Мут: <b>${formatDuration(s.mute_profanity_sec)}</b>)\n` +
    `📢 <b>Анти-капс:</b> ${s.enable_caps ? '✅ ВКЛ' : '❌ ВЫКЛ'} (Мут: <b>${formatDuration(s.mute_caps_sec)}</b>)\n` +
    `🚨 <b>Анти-скам/реклама:</b> ${s.enable_spam ? '✅ ВКЛ' : '❌ ВЫКЛ'} (Наказание: <b>БАН</b>)\n` +
    `🧹 <b>Удаление входов/выходов:</b> ${s.clean_service ? '✅ ВКЛ' : '❌ ВЫКЛ'}\n\n` +
    `<i>Нажимайте кнопки для переключения фильтров или настройки длительности мутов:</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: s.enable_links ? "🔗 Ссылки: ВКЛ" : "🔗 Ссылки: ВЫКЛ", callback_data: "cfg_toggle_links" },
        { text: `⏱️ Мут: ${formatDuration(s.mute_links_sec)}`, callback_data: "cfg_menu_links" }
      ],
      [
        { text: s.enable_profanity ? "🤬 Мат: ВКЛ" : "🤬 Мат: ВЫКЛ", callback_data: "cfg_toggle_prof" },
        { text: `⏱️ Мут: ${formatDuration(s.mute_profanity_sec)}`, callback_data: "cfg_menu_prof" }
      ],
      [
        { text: s.enable_caps ? "📢 Капс: ВКЛ" : "📢 Капс: ВЫКЛ", callback_data: "cfg_toggle_caps" },
        { text: `⏱️ Мут: ${formatDuration(s.mute_caps_sec)}`, callback_data: "cfg_menu_caps" }
      ],
      [
        { text: s.enable_spam ? "🚨 Скам: ВКЛ" : "🚨 Скам: ВЫКЛ", callback_data: "cfg_toggle_spam" },
        { text: s.clean_service ? "🧹 Чистка: ВКЛ" : "🧹 Чистка: ВЫКЛ", callback_data: "cfg_toggle_service" }
      ],
      [
        { text: "🔄 Сброс настроек", callback_data: "cfg_reset" },
        { text: "❌ Закрыть панель", callback_data: "cfg_close" }
      ]
    ]
  };

  return { text, reply_markup };
}

function renderMuteLinksMenu(chatTitle, s) {
  const text =
    `⏱️ <b>Настройка мута за ссылки и упоминания:</b>\n` +
    `Текущее значение: <b>${formatDuration(s.mute_links_sec)}</b>\n\n` +
    `<i>Выберите новую длительность мута для нарушителей:</i>`;

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
        { text: "3 дня", callback_data: "cfg_set_links_259200" }
      ],
      [
        { text: "7 дней", callback_data: "cfg_set_links_604800" },
        { text: "30 дней", callback_data: "cfg_set_links_2592000" }
      ],
      [
        { text: "⬅️ Назад в главное меню", callback_data: "cfg_main" }
      ]
    ]
  };
  return { text, reply_markup };
}

function renderMuteProfMenu(chatTitle, s) {
  const text =
    `⏱️ <b>Настройка мута за мат и оскорбления:</b>\n` +
    `Текущее значение: <b>${formatDuration(s.mute_profanity_sec)}</b>\n\n` +
    `<i>Выберите новую длительность мута для нарушителей:</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "10 минут", callback_data: "cfg_set_prof_600" },
        { text: "30 минут", callback_data: "cfg_set_prof_1800" },
        { text: "1 час", callback_data: "cfg_set_prof_3600" }
      ],
      [
        { text: "2 часа", callback_data: "cfg_set_prof_7200" },
        { text: "6 часов", callback_data: "cfg_set_prof_21600" },
        { text: "24 часа (1 д)", callback_data: "cfg_set_prof_86400" }
      ],
      [
        { text: "3 дня", callback_data: "cfg_set_prof_259200" },
        { text: "7 дней", callback_data: "cfg_set_prof_604800" }
      ],
      [
        { text: "⬅️ Назад в главное меню", callback_data: "cfg_main" }
      ]
    ]
  };
  return { text, reply_markup };
}

function renderMuteCapsMenu(chatTitle, s) {
  const text =
    `⏱️ <b>Настройка мута за CAPS LOCK и флуд:</b>\n` +
    `Текущее значение: <b>${formatDuration(s.mute_caps_sec)}</b>\n\n` +
    `<i>Выберите новую длительность мута для нарушителей:</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "5 минут", callback_data: "cfg_set_caps_300" },
        { text: "15 минут", callback_data: "cfg_set_caps_900" },
        { text: "30 минут", callback_data: "cfg_set_caps_1800" }
      ],
      [
        { text: "1 час", callback_data: "cfg_set_caps_3600" },
        { text: "3 часа", callback_data: "cfg_set_caps_10800" },
        { text: "24 часа (1 д)", callback_data: "cfg_set_caps_86400" }
      ],
      [
        { text: "⬅️ Назад в главное меню", callback_data: "cfg_main" }
      ]
    ]
  };
  return { text, reply_markup };
}

// Обработка кликов по инлайн-кнопкам настроек
async function handleCallbackQuery(token, env, cq) {
  const chatId = cq.message?.chat?.id;
  const userId = cq.from?.id;
  const messageId = cq.message?.message_id;
  const data = cq.data || "";

  if (!chatId || !userId) {
    return new Response("OK");
  }

  // Только администраторы могут управлять настройками
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

  if (data === "cfg_close") {
    await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Панель настроек закрыта" });
    return new Response("OK");
  }

  if (data === "cfg_reset") {
    await saveChatSettings(env, chatId, DEFAULT_SETTINGS);
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Настройки сброшены по умолчанию!" });
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
  } else if (data === "cfg_menu_prof") {
    subMenu = "prof";
  } else if (data === "cfg_menu_caps") {
    subMenu = "caps";
  } else if (data.startsWith("cfg_set_links_")) {
    settings.mute_links_sec = parseInt(data.replace("cfg_set_links_", ""), 10);
    changed = true;
  } else if (data.startsWith("cfg_set_prof_")) {
    settings.mute_profanity_sec = parseInt(data.replace("cfg_set_prof_", ""), 10);
    changed = true;
  } else if (data.startsWith("cfg_set_caps_")) {
    settings.mute_caps_sec = parseInt(data.replace("cfg_set_caps_", ""), 10);
    changed = true;
  }

  if (changed) {
    await saveChatSettings(env, chatId, settings);
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "✅ Настройки сохранены!" });
  } else {
    await tgApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
  }

  const chatTitle = cq.message?.chat?.title || "Этот чат";
  let payload;
  if (subMenu === "links") {
    payload = renderMuteLinksMenu(chatTitle, settings);
  } else if (subMenu === "prof") {
    payload = renderMuteProfMenu(chatTitle, settings);
  } else if (subMenu === "caps") {
    payload = renderMuteCapsMenu(chatTitle, settings);
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
        { command: "start", description: "Запустить бота и получить информацию" },
        { command: "settings", description: "Настройки фильтров и времени мутов" },
        { command: "rules", description: "Показать правила чата" },
        { command: "mute", description: "Замутить (ответом: /mute 30m / 2h / 1d)" },
        { command: "unmute", description: "Снять мут с пользователя (ответом)" },
        { command: "kick", description: "Выгнать пользователя из группы (ответом)" },
        { command: "ban", description: "Навсегда забанить нарушителя (ответом)" },
        { command: "unban", description: "Разбанить пользователя по ID: /unban <ID>" },
        { command: "warn", description: "Выдать предупреждение (ответом)" },
        { command: "del", description: "Быстро удалить сообщение (ответом)" }
      ];
      const res = await tgApi(token, "setMyCommands", { commands });
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (request.method !== "POST") {
      return new Response("Telegram Hardcore Moderator Bot is active!\nVisit /set-webhook to link bot.", { status: 200 });
    }

    try {
      const update = await request.json();

      // 1. Обработка нажатий на кнопки в меню /settings
      if (update.callback_query) {
        return await handleCallbackQuery(token, env, update.callback_query);
      }

      const msg = update.message;
      if (!msg || !msg.chat) {
        return new Response("OK");
      }

      const chatId = msg.chat.id;
      const chatSettings = await getChatSettings(env, chatId);

      // 🧹 Стерильность: Мгновенное авто-удаление системных сообщений
      if (msg.new_chat_members || msg.left_chat_member || msg.pinned_message) {
        if (chatSettings.clean_service) {
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
        }

        // Анти-рейд: мгновенный БАН ботов со ссылками или рекламой в имени при входе
        if (msg.new_chat_members) {
          for (let u of msg.new_chat_members) {
            const fullName = `${u.first_name || ""} ${u.last_name || ""}`;
            if (hasLinks({ text: fullName }) || checkScamOrPromo({ text: fullName })) {
              await tgApi(token, "banChatMember", { chat_id: chatId, user_id: u.id });
            }
          }
        }
        return new Response("OK");
      }

      if (!msg.from) {
        return new Response("OK");
      }

      const userId = msg.from.id;

      // Ответ на /start в личных сообщениях
      if (msg.chat.type === "private") {
        let botUsername = "shinymoderation_bot";
        try {
          const meRes = await (await tgApi(token, "getMe", {})).json();
          if (meRes.ok && meRes.result?.username) {
            botUsername = meRes.result.username;
          }
        } catch (e) {}

        const welcomeText =
          "🛡️ <b>Привет! Я бот-модератор с гибкими настройками для групп.</b>\n\n" +
          "<b>Возможности:</b>\n" +
          "• ⚙️ <b>Интерактивная панель</b> <code>/settings</code> — настраивайте длительность мутов и фильтры кнопками!\n" +
          "• 🚨 <b>Анти-скам</b> — мгновенный бан за рекламу заработка, криптовалют и спам.\n" +
          "• 🔗 <b>Анти-ссылки</b> — блокировка любых доменов, скрытых ссылок и тегов.\n" +
          "• 🤬 <b>Анти-мат</b> — фильтр ненормативной лексики с защитой от обхода.\n" +
          "• 📢 <b>Анти-капс</b> — удаление сообщений капслоком и флуда.\n" +
          "• 🧹 <b>Чистка чата</b> — скрытие системных уведомлений входа/выхода.\n\n" +
          "<b>Команды администраторов:</b>\n" +
          "• <code>/settings</code> — открыть интерактивную панель настроек\n" +
          "• <code>/setmute links 12h</code> — настроить мут за ссылки\n" +
          "• <code>/setmute profanity 1h</code> — настроить мут за мат\n" +
          "• <code>/setmute caps 30m</code> — настроить мут за капс\n" +
          "• <code>/rules</code> — показать правила чата\n" +
          "• <code>/mute [время]</code> — замутить нарушителя вручную\n" +
          "• <code>/unmute</code> — снять мут\n" +
          "• <code>/kick</code> — выгнать из группы\n" +
          "• <code>/ban</code> — забанить навсегда\n" +
          "• <code>/del</code> — быстро удалить сообщение\n" +
          "• <code>/unban &lt;ID&gt;</code> — разбанить пользователя\n\n" +
          "<b>Как запустить:</b> добавьте бота в группу и назначьте <b>Администратором</b> с правами на удаление сообщений и блокировку пользователей.";

        await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: welcomeText,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Добавить бота в группу", url: `https://t.me/${botUsername}?startgroup=true` }]
            ]
          }
        });
        return new Response("OK");
      }

      // Администраторы чата имеют доступ к настройкам и иммунитет
      if (await isAdmin(token, chatId, userId)) {
        const text = (msg.text || "").trim();
        const parts = text.split(/\s+/);
        const cmd = parts[0].toLowerCase().replace(/@.+$/, '');

        // Открытие интерактивной панели настроек
        if (cmd === "/settings" || cmd === "/config") {
          const payload = renderMainMenu(chatId, msg.chat.title, chatSettings);
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: payload.text,
            parse_mode: "HTML",
            reply_markup: payload.reply_markup
          });
          return new Response("OK");
        }

        // Быстрая настройка мутов командой: /setmute links 12h / /setmute profanity 1h / /setmute caps 30m
        if (cmd === "/setmute") {
          const target = (parts[1] || "").toLowerCase();
          const durationStr = parts[2] || "";
          const seconds = parseDurationInput(durationStr);

          if (!target || !seconds) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ <b>Использование:</b> <code>/setmute &lt;тип&gt; &lt;время&gt;</code>\n\n" +
                    "<b>Типы:</b>\n" +
                    "• <code>links</code> — за ссылки (пример: <code>/setmute links 12h</code>, <code>1d</code>)\n" +
                    "• <code>profanity</code> (или <code>prof</code>) — за мат (пример: <code>/setmute prof 1h</code>)\n" +
                    "• <code>caps</code> — за капслок (пример: <code>/setmute caps 30m</code>)",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }

          if (target === "links" || target === "link") {
            chatSettings.mute_links_sec = seconds;
            await saveChatSettings(env, chatId, chatSettings);
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `✅ <b>Длительность мута за ссылки изменена:</b> <code>${formatDuration(seconds)}</code>`,
              parse_mode: "HTML"
            });
            return new Response("OK");
          }

          if (target === "profanity" || target === "prof" || target === "мат") {
            chatSettings.mute_profanity_sec = seconds;
            await saveChatSettings(env, chatId, chatSettings);
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `✅ <b>Длительность мута за мат изменена:</b> <code>${formatDuration(seconds)}</code>`,
              parse_mode: "HTML"
            });
            return new Response("OK");
          }

          if (target === "caps" || target === "капс") {
            chatSettings.mute_caps_sec = seconds;
            await saveChatSettings(env, chatId, chatSettings);
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `✅ <b>Длительность мута за капс изменена:</b> <code>${formatDuration(seconds)}</code>`,
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
        }

        // Быстрое переключение фильтров командой: /toggle <фильтр>
        if (cmd === "/toggle") {
          const target = (parts[1] || "").toLowerCase();
          if (target === "links" || target === "link") {
            chatSettings.enable_links = !chatSettings.enable_links;
            await saveChatSettings(env, chatId, chatSettings);
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `🔗 Фильтр ссылок: <b>${chatSettings.enable_links ? '✅ ВКЛЮЧЕН' : '❌ ВЫКЛЮЧЕН'}</b>`,
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
          if (target === "prof" || target === "profanity" || target === "мат") {
            chatSettings.enable_profanity = !chatSettings.enable_profanity;
            await saveChatSettings(env, chatId, chatSettings);
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `🤬 Фильтр мата: <b>${chatSettings.enable_profanity ? '✅ ВКЛЮЧЕН' : '❌ ВЫКЛЮЧЕН'}</b>`,
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
          if (target === "spam" || target === "скам") {
            chatSettings.enable_spam = !chatSettings.enable_spam;
            await saveChatSettings(env, chatId, chatSettings);
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `🚨 Анти-скам/реклама: <b>${chatSettings.enable_spam ? '✅ ВКЛЮЧЕН' : '❌ ВЫКЛЮЧЕН'}</b>`,
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
          if (target === "caps" || target === "капс") {
            chatSettings.enable_caps = !chatSettings.enable_caps;
            await saveChatSettings(env, chatId, chatSettings);
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `📢 Анти-капс: <b>${chatSettings.enable_caps ? '✅ ВКЛЮЧЕН' : '❌ ВЫКЛЮЧЕН'}</b>`,
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
          if (target === "service" || target === "чистка") {
            chatSettings.clean_service = !chatSettings.clean_service;
            await saveChatSettings(env, chatId, chatSettings);
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `🧹 Чистка входов/выходов: <b>${chatSettings.clean_service ? '✅ ВКЛЮЧЕНА' : '❌ ВЫКЛЮЧЕНА'}</b>`,
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
        }

        if (cmd === "/start" || cmd === "/help") {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "🛡️ <b>Бот-модератор активен!</b>\n\n" +
                  "<b>Управление настройками:</b>\n" +
                  "• <code>/settings</code> — открыть панель настройки фильтров и мутов\n" +
                  "• <code>/setmute links 12h</code> — настроить мут за ссылки\n" +
                  "• <code>/setmute prof 2h</code> — настроить мут за мат\n" +
                  "• <code>/setmute caps 15m</code> — настроить мут за капс\n\n" +
                  "<b>Команды модерации (ответом на сообщение):</b>\n" +
                  "• <code>/rules</code> — показать правила чата\n" +
                  "• <code>/mute 30m / 2h / 1d</code> — замутить нарушителя\n" +
                  "• <code>/unmute</code> — снять мут\n" +
                  "• <code>/kick</code> — выгнать из группы\n" +
                  "• <code>/ban</code> — забанить навсегда\n" +
                  "• <code>/del</code> — быстро удалить сообщение\n" +
                  "• <code>/unban &lt;ID&gt;</code> — разбанить по ID",
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        if (cmd === "/rules") {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "📜 <b>ПРАВИЛА НАШЕГО ЧАТА:</b>\n\n" +
                  "1. 🚨 <b>Спам, реклама, криптовалюты и схемы заработка</b> — перманентный бан.\n" +
                  `2. 🔗 <b>Ссылки и сторонние теги</b> — ${chatSettings.enable_links ? `мут на ${formatDuration(chatSettings.mute_links_sec)}` : 'разрешены'}.\n` +
                  `3. 🤬 <b>Нецензурная брань и оскорбления</b> — ${chatSettings.enable_profanity ? `мут на ${formatDuration(chatSettings.mute_profanity_sec)}` : 'разрешены'}.\n` +
                  `4. 📢 <b>Капслок и флуд</b> — ${chatSettings.enable_caps ? `мут на ${formatDuration(chatSettings.mute_caps_sec)}` : 'разрешены'}.\n\n` +
                  "<i>Бот модерирует группу в реальном времени. Нарушения удаляются автоматически.</i>",
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        if (cmd === "/del") {
          if (msg.reply_to_message) {
            await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.reply_to_message.message_id });
          }
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          return new Response("OK");
        }

        if (cmd === "/kick") {
          if (!msg.reply_to_message || !msg.reply_to_message.from) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ Ответьте на сообщение участника, которого хотите выгнать: <code>/kick</code>",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
          const targetUser = msg.reply_to_message.from;
          await tgApi(token, "banChatMember", { chat_id: chatId, user_id: targetUser.id });
          await tgApi(token, "unbanChatMember", { chat_id: chatId, user_id: targetUser.id });
          const mention = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `👢 Пользователь ${mention} выгнан из группы.`,
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        if (cmd === "/mute") {
          if (!msg.reply_to_message || !msg.reply_to_message.from) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ Используйте команду ответом на сообщение нарушителя: <code>/mute 30m</code> (или <code>2h</code>, <code>1d</code>)",
              parse_mode: "HTML"
            });
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

        if (cmd === "/unmute") {
          if (!msg.reply_to_message || !msg.reply_to_message.from) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ Ответьте на сообщение пользователя, чтобы снять мут.",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
          const targetUser = msg.reply_to_message.from;
          await tgApi(token, "restrictChatMember", {
            chat_id: chatId,
            user_id: targetUser.id,
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
          const mention = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `🔊 Мут с пользователя ${mention} снят!`,
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        if (cmd === "/ban") {
          if (!msg.reply_to_message || !msg.reply_to_message.from) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ Ответьте на сообщение нарушителя, чтобы забанить его.",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
          const targetUser = msg.reply_to_message.from;
          await tgApi(token, "banChatMember", { chat_id: chatId, user_id: targetUser.id });
          const mention = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `⛔ Пользователь ${mention} навсегда забанен в чате.`,
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        if (cmd === "/unban") {
          let targetId = parts[1];
          if (!targetId && msg.reply_to_message?.from) {
            targetId = msg.reply_to_message.from.id;
          }
          if (targetId) {
            await tgApi(token, "unbanChatMember", { chat_id: chatId, user_id: targetId, only_if_banned: true });
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: `✅ Пользователь с ID <code>${targetId}</code> разбанен.`,
              parse_mode: "HTML"
            });
          } else {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ Укажите ID или ответьте на сообщение: <code>/unban &lt;ID&gt;</code>",
              parse_mode: "HTML"
            });
          }
          return new Response("OK");
        }

        if (cmd === "/warn") {
          if (!msg.reply_to_message || !msg.reply_to_message.from) {
            await tgApi(token, "sendMessage", {
              chat_id: chatId,
              text: "⚠️ Ответьте на сообщение нарушителя: <code>/warn [причина]</code>",
              parse_mode: "HTML"
            });
            return new Response("OK");
          }
          const targetUser = msg.reply_to_message.from;
          const reason = parts.slice(1).join(" ") || "Нарушение правил чата";
          const mention = targetUser.username ? `@${targetUser.username}` : targetUser.first_name;
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `⚠️ Администратор выдал предупреждение ${mention}!\nПричина: <b>${reason}</b>`,
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        return new Response("OK");
      }

      // ==========================================
      // МОДЕРАЦИЯ СООБЩЕНИЙ ПО НАСТРОЙКАМ ЧАТА
      // ==========================================
      const text = msg.text || msg.caption || "";
      const mention = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

      // 1. ПРОВЕРКА НА СПАМ, СКАМ, РЕКЛАМУ И КРИПТУ -> БАН НАВСЕГДА
      if (chatSettings.enable_spam) {
        const scamReason = checkScamOrPromo(msg);
        if (scamReason) {
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          await tgApi(token, "banChatMember", { chat_id: chatId, user_id: userId });

          const alertRes = await (await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `🚨 <b>Нарушитель заблокирован навсегда!</b>\n` +
                  `👤 Пользователь: ${mention}\n` +
                  `⛔ Нарушение: <b>${scamReason}</b>\n` +
                  `<i>Реклама и спам пресекаются моментально.</i>`,
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

      // 2. ПРОВЕРКА НА ССЫЛКИ И ТЕГИ -> МУТ НА НАСТРОЕННЫЙ СРОК
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
                `⛔ Причина: <b>Публикация ссылок и упоминаний запрещена</b>`,
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

      // 3. ПРОВЕРКА НА МАТ И ОСКОРБЛЕНИЯ -> МУТ НА НАСТРОЕННЫЙ СРОК
      if (chatSettings.enable_profanity && hasProfanity(text)) {
        await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
        const untilDate = Math.floor(Date.now() / 1000) + chatSettings.mute_profanity_sec;
        await tgApi(token, "restrictChatMember", {
          chat_id: chatId,
          user_id: userId,
          permissions: { can_send_messages: false },
          until_date: untilDate
        });

        const alertRes = await (await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: `🤬 ${mention} <b>замучен на ${formatDuration(chatSettings.mute_profanity_sec)}!</b>\n` +
                `⛔ Причина: <b>Нецензурная брань и оскорбления</b>`,
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

      // 4. ПРОВЕРКА НА КАПС И СПАМ СИМВОЛАМИ -> МУТ НА НАСТРОЕННЫЙ СРОК
      if (chatSettings.enable_caps) {
        const capsReason = checkCapsOrFlooding(msg, chatSettings.max_caps_percent);
        if (capsReason) {
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          const untilDate = Math.floor(Date.now() / 1000) + chatSettings.mute_caps_sec;
          await tgApi(token, "restrictChatMember", {
            chat_id: chatId,
            user_id: userId,
            permissions: { can_send_messages: false },
            until_date: untilDate
          });

          const alertRes = await (await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `⚠️ ${mention} <b>замучен на ${formatDuration(chatSettings.mute_caps_sec)}!</b>\n` +
                  `⛔ Причина: <b>${capsReason}</b>`,
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

    } catch (err) {
      console.error(err);
    }

    return new Response("OK");
  }
};
