from aiogram import Router, Bot, F
from aiogram.filters import Command
from aiogram.types import Message

from config import settings
from database.db import db
from utils.chat_helpers import is_admin, parse_time_duration, mute_user, unmute_user, delete_message_safe

router = Router(name="admin_commands")


@router.message(Command("start", "help"))
async def cmd_help(message: Message, bot: Bot):
    """Provides information and command list."""
    if message.chat.type == "private":
        text = (
            "🛡️ <b>Привет! Я бот-модератор для групп Telegram.</b>\n\n"
            "<b>Что я умею делать автоматически:</b>\n"
            "• 🔗 <b>Блокировать любые ссылки</b> (сайты, t.me, замаскированные домены);\n"
            "• 🤬 <b>Удалять маты и оскорбления</b> (с защитой от обхода латиницей, пробелами и цифрами);\n"
            "• 🚫 <b>Останавливать спам</b> (флуд, капслок, спам репостами из каналов, массовые теги);\n"
            "• ⚠️ <b>Система варнов</b>: за 3 нарушения пользователь автоматически отправляется в мут на 24 часа.\n\n"
            "<b>Как меня запустить в группе:</b>\n"
            "1. Добавьте меня в вашу группу или супергруппу.\n"
            "2. Назначьте меня <b>Администратором</b> с правами:\n"
            "   - <i>Удаление сообщений (Delete Messages)</i>\n"
            "   - <i>Блокировка пользователей (Ban/Restrict Users)</i>\n\n"
            "<b>Команды администраторов в чате:</b>\n"
            "• <code>/warn [причина]</code> — выдать варн (ответом на сообщение);\n"
            "• <code>/unwarn</code> — снять один варн (ответом на сообщение);\n"
            "• <code>/warns</code> — посмотреть варны пользователя;\n"
            "• <code>/mute &lt;время&gt;</code> — замутить (пример: <code>/mute 30m</code>, <code>/mute 2h</code>, <code>/mute 1d</code>);\n"
            "• <code>/unmute</code> — снять мут (ответом на сообщение);\n"
            "• <code>/ban</code> — забанить пользователя (ответом на сообщение);\n"
            "• <code>/unban</code> — разбанить пользователя."
        )
        await message.answer(text, parse_mode="HTML")
        return

    # In group chat
    if await is_admin(bot, message.chat.id, message.from_user.id):
        text = (
            "🛡️ <b>Бот-модератор активен!</b>\n\n"
            "Команды управления (ответом на сообщение):\n"
            "• <code>/warn</code> — выдать варн\n"
            "• <code>/unwarn</code> — снять варн\n"
            "• <code>/warns</code> — узнать статус варнов\n"
            "• <code>/mute 30m / 2h / 1d</code> — замутить\n"
            "• <code>/unmute</code> — размутить\n"
            "• <code>/ban</code> — забанить"
        )
        await message.reply(text, parse_mode="HTML")


@router.message(Command("warn"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_warn(message: Message, bot: Bot):
    if not await is_admin(bot, message.chat.id, message.from_user.id):
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Используйте эту команду <b>в ответ</b> на сообщение нарушителя!")
        return

    target_user = message.reply_to_message.from_user
    if target_user.id == message.from_user.id:
        await message.reply("❌ Вы не можете выдать варн самому себе.")
        return

    if await is_admin(bot, message.chat.id, target_user.id):
        await message.reply("❌ Нельзя выдать варн администратору чата.")
        return

    # Extract reason if provided
    args = message.text.split(maxsplit=1)
    reason = args[1] if len(args) > 1 else "Нарушение правил чата"

    count, _ = await db.add_warning(message.chat.id, target_user.id, reason)
    user_mention = target_user.mention_html()

    if count >= settings.MAX_WARNINGS:
        duration_seconds = settings.MUTE_DURATION_HOURS * 3600
        await mute_user(bot, message.chat.id, target_user.id, duration_seconds)
        await db.reset_warnings(message.chat.id, target_user.id)
        await message.reply(
            f"🚫 {user_mention} замучен на {settings.MUTE_DURATION_HOURS} ч. за достижение {settings.MAX_WARNINGS} предупреждений!\n"
            f"Причина: {reason}",
            parse_mode="HTML"
        )
    else:
        await message.reply(
            f"⚠️ Администратор выдал предупреждение {user_mention}!\n"
            f"Причина: <b>{reason}</b>\n"
            f"Предупреждения: <b>{count}/{settings.MAX_WARNINGS}</b>",
            parse_mode="HTML"
        )


@router.message(Command("unwarn"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_unwarn(message: Message, bot: Bot):
    if not await is_admin(bot, message.chat.id, message.from_user.id):
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Ответьте на сообщение пользователя, чтобы снять варн.")
        return

    target_user = message.reply_to_message.from_user
    new_count = await db.remove_warning(message.chat.id, target_user.id)
    user_mention = target_user.mention_html()

    await message.reply(
        f"✅ С {user_mention} снято одно предупреждение. Текущие варны: <b>{new_count}/{settings.MAX_WARNINGS}</b>",
        parse_mode="HTML"
    )


@router.message(Command("warns"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_warns_status(message: Message, bot: Bot):
    target_user = message.reply_to_message.from_user if message.reply_to_message else message.from_user
    count, reasons = await db.get_warnings(message.chat.id, target_user.id)
    user_mention = target_user.mention_html()

    if count == 0:
        await message.reply(f"ℹ️ У {user_mention} нет активных предупреждений.", parse_mode="HTML")
        return

    reasons_formatted = "\n".join([f"• {r}" for r in reasons[-5:]])
    await message.reply(
        f"⚠️ Предупреждения {user_mention}: <b>{count}/{settings.MAX_WARNINGS}</b>\n\n"
        f"Последние причины:\n{reasons_formatted}",
        parse_mode="HTML"
    )


@router.message(Command("mute"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_mute(message: Message, bot: Bot):
    if not await is_admin(bot, message.chat.id, message.from_user.id):
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Ответьте на сообщение нарушителя: <code>/mute [время, напр. 15m, 2h, 1d]</code>", parse_mode="HTML")
        return

    target_user = message.reply_to_message.from_user
    if await is_admin(bot, message.chat.id, target_user.id):
        await message.reply("❌ Нельзя замутить администратора.")
        return

    args = message.text.split()
    duration_seconds = 3600 * settings.MUTE_DURATION_HOURS  # default
    duration_str = f"{settings.MUTE_DURATION_HOURS} ч."

    if len(args) > 1:
        parsed_sec = parse_time_duration(args[1])
        if parsed_sec:
            duration_seconds = parsed_sec
            duration_str = args[1]

    success = await mute_user(bot, message.chat.id, target_user.id, duration_seconds)
    user_mention = target_user.mention_html()

    if success:
        await message.reply(f"🔇 {user_mention} замучен на <b>{duration_str}</b>.", parse_mode="HTML")
    else:
        await message.reply("❌ Не удалось ограничить пользователя. Убедитесь, что у бота есть права на блокировку пользователей.")


@router.message(Command("unmute"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_unmute(message: Message, bot: Bot):
    if not await is_admin(bot, message.chat.id, message.from_user.id):
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Ответьте на сообщение пользователя, чтобы снять мут.")
        return

    target_user = message.reply_to_message.from_user
    success = await unmute_user(bot, message.chat.id, target_user.id)
    user_mention = target_user.mention_html()

    if success:
        await message.reply(f"🔊 Мут с {user_mention} снят.", parse_mode="HTML")
    else:
        await message.reply("❌ Ошибка при снятии ограничений.")


@router.message(Command("ban"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_ban(message: Message, bot: Bot):
    if not await is_admin(bot, message.chat.id, message.from_user.id):
        return

    if not message.reply_to_message or not message.reply_to_message.from_user:
        await message.reply("⚠️ Ответьте на сообщение нарушителя, чтобы забанить его.")
        return

    target_user = message.reply_to_message.from_user
    if await is_admin(bot, message.chat.id, target_user.id):
        await message.reply("❌ Нельзя забанить администратора.")
        return

    try:
        await bot.ban_chat_member(chat_id=message.chat.id, user_id=target_user.id)
        user_mention = target_user.mention_html()
        await message.reply(f"⛔ {user_mention} навсегда забанен в чате.", parse_mode="HTML")
    except Exception as e:
        await message.reply(f"❌ Ошибка бана: проверьте права бота на блокировку участников.")


@router.message(Command("unban"), F.chat.type.in_({"group", "supergroup"}))
async def cmd_unban(message: Message, bot: Bot):
    if not await is_admin(bot, message.chat.id, message.from_user.id):
        return

    user_id = None
    if message.reply_to_message and message.reply_to_message.from_user:
        user_id = message.reply_to_message.from_user.id
    else:
        args = message.text.split()
        if len(args) > 1 and args[1].isdigit():
            user_id = int(args[1])

    if not user_id:
        await message.reply("⚠️ Укажите ID пользователя или ответьте на его сообщение: <code>/unban &lt;user_id&gt;</code>", parse_mode="HTML")
        return

    try:
        await bot.unban_chat_member(chat_id=message.chat.id, user_id=user_id, only_if_banned=True)
        await message.reply(f"✅ Пользователь с ID <code>{user_id}</code> разбанен.", parse_mode="HTML")
    except Exception as e:
        await message.reply(f"❌ Не удалось разбанить пользователя: {e}")
