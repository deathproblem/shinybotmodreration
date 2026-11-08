// Cloudflare Worker: Telegram Hardcore Moderator Bot
// Strict zero-tolerance moderation system for groups and supergroups

// Hardcore Settings
const SETTINGS = {
  ENABLE_LINKS: true,
  ENABLE_PROFANITY: true,
  ENABLE_SPAM: true,
  MAX_CAPS_PERCENT: 65,      // Снижен порог капса для жесткости (от 8 букв)
  AUTO_DELETE_SEC: 6,        // Авто-удаление алертов бота через 6 секунд (стерильный чат)
  MUTE_LINKS_SEC: 86400,     // Мут за ссылки: 24 часа
  MUTE_PROFANITY_SEC: 7200,  // Мут за мат/оскорбления: 2 часа
  MUTE_CAPS_SEC: 900         // Мут за капс/флуд: 15 минут
};

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
  // Заработок / деньги / удаленка
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

  // Призывы писать в личку
  /пиши(?:те)?\s+(?:мне\s+)?в\s+(?:лс|личку|директ|тг)/i,
  /жду\s+в\s+(?:лс|личке)/i,
  /отве(?:тил|тила)\s+в\s+лс/i,
  /скинул[а]?\s+в\s+лс/i,
  /подробност[ией]+\s+в\s+(?:лс|профиле|описании|закрепе)/i,
  /ссылк[аеу]\s+в\s+(?:профиле|шапке|био|закрепе)/i,

  // Крипто-скам / пампы / сигналы / арбитраж
  /сигнал[ыов]+\s+по\s+крипт/i,
  /инвестици[иях]\s+от/i,
  /дарю\s+(?:крипт|usdt|тон|ton|btc|биткоин)/i,
  /раздач[аеи]\s+(?:крипт|usdt|ton|монет|денег)/i,
  /арбитраж\s+(?:крипт|валют|p2p)/i,
  /связк[аи]\s+(?:p2p|п2п|крипт)/i,
  /раскрутк[аеи]\s+(?:счета|депозита)/i,
  /удвою\s+(?:баланс|депозит)/i,
  /эйрдроп|airdrop|whitelist|вайтлист/i,

  // 18+ / сливы / порно
  /слив\s+(?:приват|шкур|фото|видео|переписок)/i,
  /интим\s*(?:фото|видео|знакомств)/i,
  /порно|проститутка|эскорт/i,
  /меф|гашиш|бошки|закладк[иа]/i,

  // Накрутка / читы / взлом
  /накрутк[аеи]\s+(?:подписчиков|лайков|ботов)/i,
  /взлом\s+(?:вк|тг|телеграм|аккаунт)/i,
  /продам\s+аккаунт/i,
  /кардинг|залив\s+на\s+карту/i
];

function checkScamOrPromo(msg) {
  const text = msg.text || msg.caption || "";

  // Рекламные пересылки из других каналов
  if (msg.forward_origin?.type === "channel" || msg.forward_from_chat?.type === "channel") {
    return "Рекламный репост из стороннего канала";
  }

  // Стоп-фразы скамеров
  for (let reg of SCAM_PATTERNS) {
    if (reg.test(text)) return "Рекламный спам / мошенничество";
  }

  // Массовые упоминания (@user1 @user2 @user3...)
  const mentions = (msg.entities || []).filter(e => e.type === "mention" || e.type === "text_mention");
  if (mentions.length >= 3) return "Массовый спам упоминаниями пользователей";

  return null;
}

// 4. Проверка капса и спама символами
function checkCapsOrFlooding(msg) {
  const text = msg.text || msg.caption || "";

  // CAPS LOCK
  const letters = text.replace(/[^a-zA-Zа-яёА-ЯЁ]/g, '');
  if (letters.length >= 8) {
    const upper = letters.replace(/[^A-ZА-ЯЁ]/g, '').length;
    if ((upper / letters.length) * 100 >= SETTINGS.MAX_CAPS_PERCENT) {
      return "Злоупотребление CAPS LOCK";
    }
  }

  // Повторяющиеся символы (аааааа...)
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
        { command: "rules", description: "Показать правила чата (Жесткий режим)" },
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
      const msg = update.message;
      if (!msg || !msg.chat) {
        return new Response("OK");
      }

      const chatId = msg.chat.id;

      // 🧹 Стерильность: Мгновенное авто-удаление системных сообщений
      if (msg.new_chat_members || msg.left_chat_member || msg.pinned_message) {
        await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });

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
          "🛡️ <b>Привет! Я бот с жестким режимом модерации групп.</b>\n\n" +
          "<b>Правила жесткой системы:</b>\n" +
          "• 🚨 <b>Спам, реклама, крипта, заработок</b> $\\rightarrow$ <b>БАН НАВСЕГДА</b>\n" +
          "• 🔗 <b>Любые ссылки, скрытые ссылки и теги</b> $\\rightarrow$ <b>МУТ НА 24 ЧАСА</b>\n" +
          "• 🤬 <b>Нецензурная лексика и оскорбления</b> $\\rightarrow$ <b>МУТ НА 2 ЧАСА</b>\n" +
          "• 📢 <b>Капслок и спам символами</b> $\\rightarrow$ <b>МУТ НА 15 МИНУТ</b>\n" +
          "• 🧹 <b>Стерильный чат</b>: системные сообщения входа/выхода удаляются сразу.\n\n" +
          "<b>Команды администраторов:</b>\n" +
          "• <code>/rules</code> — правила чата\n" +
          "• <code>/mute [время]</code> — замутить нарушителя\n" +
          "• <code>/unmute</code> — снять мут\n" +
          "• <code>/kick</code> — выгнать из группы\n" +
          "• <code>/ban</code> — забанить навсегда\n" +
          "• <code>/del</code> — удалить сообщение\n" +
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

      // Администраторыチャта имеют иммунитет к фильтрам
      if (await isAdmin(token, chatId, userId)) {
        const text = (msg.text || "").trim();
        const parts = text.split(/\s+/);
        const cmd = parts[0].toLowerCase().replace(/@.+$/, '');

        if (cmd === "/start" || cmd === "/help") {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "🛡️ <b>Жесткая система модерации активна!</b>\n\n" +
                  "Нарушители караются мгновенно:\n" +
                  "• Реклама/Скам $\\rightarrow$ <b>БАН</b>\n" +
                  "• Ссылки $\\rightarrow$ <b>МУТ 24ч</b>\n" +
                  "• Мат $\\rightarrow$ <b>МУТ 2ч</b>\n" +
                  "• Капс $\\rightarrow$ <b>МУТ 15м</b>\n\n" +
                  "Команды администратора (ответом на сообщение):\n" +
                  "• <code>/rules</code> — показать правила чата\n" +
                  "• <code>/mute 30m / 2h / 1d</code> — замутить\n" +
                  "• <code>/unmute</code> — снять мут\n" +
                  "• <code>/kick</code> — выгнать\n" +
                  "• <code>/ban</code> — забанить\n" +
                  "• <code>/del</code> — быстро удалить сообщение\n" +
                  "• <code>/unban &lt;ID&gt;</code> — разбанить по ID",
            parse_mode: "HTML"
          });
          return new Response("OK");
        }

        if (cmd === "/rules") {
          await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: "📜 <b>ПРАВИЛА НАШЕГО ЧАТА (ЖЕСТКИЙ РЕЖИМ):</b>\n\n" +
                  "1. 🚨 <b>Никакого спама, рекламы, криптовалют и заработков</b> — карается <b>перманентным баном</b>.\n" +
                  "2. 🔗 <b>Никаких ссылок и сторонних упоминаний</b> — карается <b>мутом на 24 часа</b>.\n" +
                  "3. 🤬 <b>Уважайте участников</b> — нецензурная брань и оскорбления караются <b>мутом на 2 часа</b>.\n" +
                  "4. 📢 <b>Без капса и флуда</b> — карается <b>мутом на 15 минут</b>.\n\n" +
                  "<i>Бот модерирует группу в реальном времени. Нарушения удаляются моментально!</i>",
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
      // ЖЕСТКАЯ АВТО-МОДЕРАЦИЯ СООБЩЕНИЙ УЧАСТНИКОВ
      // ==========================================
      const text = msg.text || msg.caption || "";
      const mention = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

      // 1. ПРОВЕРКА НА СПАМ, СКАМ, РЕКЛАМУ И КРИПТУ -> БАН НАВСЕГДА
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
            }, SETTINGS.AUTO_DELETE_SEC * 1000);
          }));
        }
        return new Response("OK");
      }

      // 2. ПРОВЕРКА НА ССЫЛКИ И ТЕГИ -> МУТ НА 24 ЧАСА
      if (SETTINGS.ENABLE_LINKS && hasLinks(msg)) {
        await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
        const untilDate = Math.floor(Date.now() / 1000) + SETTINGS.MUTE_LINKS_SEC;
        await tgApi(token, "restrictChatMember", {
          chat_id: chatId,
          user_id: userId,
          permissions: { can_send_messages: false },
          until_date: untilDate
        });

        const alertRes = await (await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: `🔇 ${mention} <b>отправлен в мут на 24 часа!</b>\n` +
                `⛔ Причина: <b>Публикация ссылок и упоминаний запрещена</b>`,
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
        return new Response("OK");
      }

      // 3. ПРОВЕРКА НА МАТ И ОСКОРБЛЕНИЯ -> МУТ НА 2 ЧАСА
      if (SETTINGS.ENABLE_PROFANITY && hasProfanity(text)) {
        await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
        const untilDate = Math.floor(Date.now() / 1000) + SETTINGS.MUTE_PROFANITY_SEC;
        await tgApi(token, "restrictChatMember", {
          chat_id: chatId,
          user_id: userId,
          permissions: { can_send_messages: false },
          until_date: untilDate
        });

        const alertRes = await (await tgApi(token, "sendMessage", {
          chat_id: chatId,
          text: `🤬 ${mention} <b>замучен на 2 часа!</b>\n` +
                `⛔ Причина: <b>Нецензурная брань и оскорбления</b>`,
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
        return new Response("OK");
      }

      // 4. ПРОВЕРКА НА КАПС И СПАМ СИМВОЛАМИ -> МУТ НА 15 МИНУТ
      if (SETTINGS.ENABLE_SPAM) {
        const capsReason = checkCapsOrFlooding(msg);
        if (capsReason) {
          await tgApi(token, "deleteMessage", { chat_id: chatId, message_id: msg.message_id });
          const untilDate = Math.floor(Date.now() / 1000) + SETTINGS.MUTE_CAPS_SEC;
          await tgApi(token, "restrictChatMember", {
            chat_id: chatId,
            user_id: userId,
            permissions: { can_send_messages: false },
            until_date: untilDate
          });

          const alertRes = await (await tgApi(token, "sendMessage", {
            chat_id: chatId,
            text: `⚠️ ${mention} <b>замучен на 15 минут!</b>\n` +
                  `⛔ Причина: <b>${capsReason}</b>`,
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
          return new Response("OK");
        }
      }

    } catch (err) {
      console.error(err);
    }

    return new Response("OK");
  }
};
