// Cloudflare Worker: Telegram Moderator Bot
// Handles incoming Webhooks from Telegram Bot API

// Settings
const SETTINGS = {
  ENABLE_LINKS: true,
  ENABLE_PROFANITY: true,
  ENABLE_SPAM: true,
  MAX_CAPS_PERCENT: 70,
  AUTO_DELETE_SEC: 8
};

// Whitelist of words containing letter combinations that look like profanity roots
const WHITELIST = [
  "рубл", "употреб", "колеб", "хлеб", "гребл", "стебл", "тереб",
  "скреб", "страх", "скипидар", "педиатр", "мудр", "бляха", "сабл",
  "сукно", "суккулент", "шахмат", "эрудит", "парикмахер", "команд", "мандарин"
];

// Homoglyphs and leetspeak translation
const HOMOGLYPHS = {
  'a': 'а', '@': 'а', 'b': 'в', '6': 'б', 'c': 'с', 's': 'с', '$': 'с',
  'e': 'е', '3': 'з', 'i': 'и', '1': 'и', '!': 'и', 'k': 'к', 'm': 'м',
  'o': 'о', '0': 'о', 'p': 'р', 't': 'т', '7': 'т', 'u': 'у', 'y': 'у',
  'x': 'х', '4': 'ч'
};

function normalizeText(text) {
  let str = (text || "").toLowerCase();
  let res = "";
  for (let ch of str) res += HOMOGLYPHS[ch] || ch;
  return res;
}

// 1. Link Check
function hasLinks(msg) {
  const entities = (msg.entities || []).concat(msg.caption_entities || []);
  for (let e of entities) {
    if (e.type === "url" || e.type === "text_link") return true;
  }
  const text = msg.text || msg.caption || "";
  const urlRegex = /(?:https?:\/\/|www\.|t\.me\/|[a-z0-9-]+\.(?:com|ru|org|net|xyz|top|online|site|pro|app|io|me|link|live|fun|vip|to|tv|cc|gg))\b/i;
  const obfuscatedRegex = /[a-z0-9-]+\s*(?:\[\.\]|\(\.\)|\s+dot\s+|\s+точка\s+)\s*(?:com|ru|org|net|xyz|top|site)/i;
  return urlRegex.test(text) || obfuscatedRegex.test(text);
}

// 2. Profanity Check
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

  const profaneRoots = [
    /п[иеё]зд/i, /залуп/i, /шлюх/i, /шлюш/i, /п[ие]д[ао]р/i, /педик/i,
    /дроч/i, /елда/i, /манда/i, /муд[аио]к/i, /гондон/i, /гандон/i,
    /\bху[йиеёяю]/i, /\bпоху/i, /\bнаху/i, /\bниху/i, /\bоху/i, /\bдоху/i,
    /\bхер/i, /\b[её]б/i, /\bвыеб/i, /\bзаеб/i, /\bнаеб/i, /\bпроеб/i,
    /\bбл[яе][дт]/i, /\bбля\b/i, /\bсук[аиоеуы]\b/i, /\bсучк/i, /\bсучар/i, /\bмраз/i
  ];

  for (let v of variations) {
    if (WHITELIST.some(w => v.includes(w))) continue;
    for (let r of profaneRoots) {
      if (r.test(v)) return true;
    }
  }
  return false;
}

// 3. Spam Check
function hasSpam(msg) {
  const text = msg.text || msg.caption || "";
  if (msg.forward_origin?.type === "channel" || msg.forward_from_chat?.type === "channel") {
    return "Реклама из каналов";
  }
  const letters = text.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '');
  if (letters.length >= 12) {
    const upper = letters.replace(/[^A-ZА-ЯЁ]/g, '').length;
    if ((upper / letters.length) * 100 >= SETTINGS.MAX_CAPS_PERCENT) {
      return "Злоупотребление CAPS LOCK";
    }
  }
  if (/(.)\1{25,}/.test(text)) return "Спам повторяющимися символами";
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

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Telegram Moderator Bot is running on Cloudflare Workers!", { status: 200 });
    }

    const token = env.BOT_TOKEN;
    if (!token) {
      return new Response("BOT_TOKEN is not configured in Environment Variables", { status: 500 });
    }

    try {
      const update = await request.json();
      const msg = update.message;
      if (!msg || !msg.chat || msg.chat.type === "private" || !msg.from) {
        return new Response("OK");
      }

      const chatId = msg.chat.id;
      const userId = msg.from.id;

      if (await isAdmin(token, chatId, userId)) {
        return new Response("OK");
      }

      let reason = null;
      const text = msg.text || msg.caption || "";

      if (SETTINGS.ENABLE_LINKS && hasLinks(msg)) {
        reason = "Ссылки запрещены правилами чата";
      } else if (SETTINGS.ENABLE_PROFANITY && hasProfanity(text)) {
        reason = "Нецензурная лексика запрещена";
      } else if (SETTINGS.ENABLE_SPAM) {
        const spamReason = hasSpam(msg);
        if (spamReason) reason = spamReason;
      }

      if (reason) {
        await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });

        const mention = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
        const alertRes = await (await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: `⚠️ ${mention}, ваше сообщение удалено!\nПричина: <b>${reason}</b>`,
          parse_mode: "HTML"
        })).json();

        if (alertRes.ok && alertRes.result?.message_id) {
          ctx.waitUntil(new Promise(resolve => {
            setTimeout(async () => {
              await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: alertRes.result.message_id });
              resolve();
            }, SETTINGS.AUTO_DELETE_SEC * 1000);
          }));
        }
      }
    } catch (err) {
      console.error(err);
    }

    return new Response("OK");
  }
};
