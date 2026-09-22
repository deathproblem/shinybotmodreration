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
const SPAM_PHRASES = [
  /пассивн(?:ый|ого|ому|ом|ым)\s+доход/i,
  /заработ(?:ок|ать|ай|ывай)\s+(?:в\s+день|от|в\s+лс|онлайн)/i,
  /пиши(?:те)?\s+в\s+лс/i,
  /слив\s+приват/i,
  /сигнал[ыов]+\s+по\s+крипт/i,
  /инвестици[иях]\s+от/i,
  /переходи\s+по\s+ссылке/i,
  /легкие\s+деньги/i,
  /отдам\s+даром/i,
  /дарю\s+крипт/i
];

function hasSpam(msg) {
  const text = msg.text || msg.caption || "";
  
  // Рекламные пересылки из каналов
  if (msg.forward_origin?.type === "channel" || msg.forward_from_chat?.type === "channel") {
    return "Реклама из каналов";
  }

  // Стоп-фразы спамеров и мошенников
  for (let reg of SPAM_PHRASES) {
    if (reg.test(text)) return "Рекламный спам / мошенничество";
  }

  // CAPS LOCK
  const letters = text.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '');
  if (letters.length >= 12) {
    const upper = letters.replace(/[^A-ZА-ЯЁ]/g, '').length;
    if ((upper / letters.length) * 100 >= SETTINGS.MAX_CAPS_PERCENT) {
      return "Злоупотребление CAPS LOCK";
    }
  }

  // Повторяющиеся символы (аааааа...)
  if (/(.)\1{25,}/.test(text)) return "Спам повторяющимися символами";

  // Массовые упоминания (@user1 @user2 @user3...)
  const mentions = (msg.entities || []).filter(e => e.type === "mention" || e.type === "text_mention");
  if (mentions.length >= 4) return "Массовое упоминание пользователей";

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
        { command: "help", description: "Справка по командам модератора" },
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
      return new Response("Telegram Moderator Bot is running on Cloudflare Workers!\nVisit /set-webhook to link bot.", { status: 200 });
    }

    try {
      const update = await request.json();
      const msg = update.message;
      if (!msg || !msg.chat) {
        return new Response("OK");
      }

      const chatId = msg.chat.id;

      // Авто-удаление служебных сообщений "Пользователь вступил в группу / покинул группу"
      if (msg.new_chat_members || msg.left_chat_member) {
        await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
        return new Response("OK");
      }

      if (!msg.from) {
        return new Response("OK");
      }

      const userId = msg.from.id;

      // Ответ на /start и сообщения в ЛС
      if (msg.chat.type === "private") {
        let botUsername = "shinymoderation_bot";
        try {
          const meRes = await (await tgApi(token, "getMe", {})).json();
          if (meRes.ok && meRes.result?.username) {
            botUsername = meRes.result.username;
          }
        } catch (e) {}

        const welcomeText =
          "🛡️ <b>Привет! Я бот-модератор для групп Telegram.</b>\n\n" +
          "<b>Что я делаю в группе автоматически:</b>\n" +
          "• 🔗 <b>Блокирую любые ссылки</b> (сайты, t.me, скрытые и замаскированные ссылки)\n" +
          "• 🤬 <b>Удаляю маты</b> (с защитой от обхода латиницей, точками, пробелами и цифрами)\n" +
          "• 🚫 <b>Блокирую спам</b> (CAPS LOCK, спам символами, рекламные пересылки из каналов)\n\n" +
          "<b>Команды администраторов (в группе):</b>\n" +
          "• <code>/mute [время]</code> — замутить (ответом на сообщение: <code>/mute 30m</code>, <code>/mute 2h</code>, <code>/mute 1d</code>)\n" +
          "• <code>/unmute</code> — снять мут (ответом на сообщение)\n" +
          "• <code>/ban</code> — забанить нарушителя (ответом на сообщение)\n" +
          "• <code>/unban &lt;ID&gt;</code> — разбанить пользователя\n" +
          "• <code>/warn [причина]</code> — выдать предупреждение\n\n" +
          "<b>Как меня запустить:</b>\n" +
          "1. Нажмите кнопку ниже или добавьте меня в группу.\n" +
          "2. Назначьте меня <b>Администратором</b> с правами <b>Удаление сообщений</b> и <b>Блокировка пользователей</b>.";

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

      // Обработка команд администраторов в группе
      if (await isAdmin(token, chatId, userId)) {
        const text = (msg.text || "").trim();
        const parts = text.split(/\s+/);
        const cmd = parts[0].toLowerCase().replace(/@.+$/, ''); // убираем @botname из /mute@botname

        if (cmd === "/start" || cmd === "/help") {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "🛡️ <b>Бот-модератор активен!</b>\n\n" +
                  "Команды администратора (ответом на сообщение нарушителя):\n" +
                  "• <code>/rules</code> — показать правила чата\n" +
                  "• <code>/mute 30m / 2h / 1d</code> — замутить пользователя\n" +
                  "• <code>/unmute</code> — снять мут\n" +
                  "• <code>/kick</code> — выгнать пользователя из группы\n" +
                  "• <code>/ban</code> — забанить навсегда\n" +
                  "• <code>/warn [причина]</code> — выдать предупреждение\n" +
                  "• <code>/del</code> — быстро удалить сообщение\n" +
                  "• <code>/unban &lt;ID&gt;</code> — разбанить пользователя",
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        // Команда /rules
        if (cmd === "/rules") {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "📜 <b>Правила нашего чата:</b>\n\n" +
                  "1. 🔗 <b>Никаких ссылок</b> (на сайты, каналы, ботов, чаты).\n" +
                  "2. 🤬 <b>Уважайте участников</b> — нецензурная лексика и оскорбления запрещены.\n" +
                  "3. 🚫 <b>Без спама</b> — флуд, капслок, реклама и заработки немедленно удаляются.\n\n" +
                  "<i>За нарушения бот автоматически выдает мут!</i>",
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        // Команда /del (быстрое удаление сообщения)
        if (cmd === "/del") {
          if (msg.reply_to_message) {
            await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.reply_to_message.message_id });
          }
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          return new Response("OK");
        }

        // Команда /kick (выгнать из чата)
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

        // Команда /mute
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
          let seconds = 86400;
          const match = durationStr.match(/^(\d+)\s*([smhdдчмс]?)$/i);
          if (match) {
            const val = parseInt(match[1], 10);
            const unit = (match[2] || "").toLowerCase();
            if (unit === 's' || unit === 'с') seconds = val;
            else if (unit === 'm' || unit === 'м') seconds = val * 60;
            else if (unit === 'h' || unit === 'ч') seconds = val * 3600;
            else if (unit === 'd' || unit === 'д') seconds = val * 86400;
          }
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

        // Команда /unmute
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

        // Команда /ban
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

        // Команда /unban
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

        // Команда /warn
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
