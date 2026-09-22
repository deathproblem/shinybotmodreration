from aiogram import Router, Bot, F
from aiogram.types import Message

from config import settings
from database.db import db
from filters.link_filter import contains_links
from filters.profanity_filter import contains_profanity
from filters.spam_filter import check_spam
from utils.chat_helpers import is_admin, delete_message_safe, send_temp_message, mute_user

router = Router(name="moderation")


@router.message(F.chat.type.in_({"group", "supergroup"}))
async def moderate_chat_message(message: Message, bot: Bot):
    # Ignore messages without sender (e.g. anonymous channel posts or system messages)
    if not message.from_user:
        return

    chat_id = message.chat.id
    user_id = message.from_user.id

    # Check if user is administrator
    if settings.ALLOW_ADMINS_BYPASS and await is_admin(bot, chat_id, user_id):
        return

    text_content = message.text or message.caption or ""
    violation_reason = None

    # 1. Link Filter Check
    if settings.ENABLE_LINK_FILTER and contains_links(message):
        violation_reason = "Отправка ссылок запрещена правилами чата"

    # 2. Profanity Filter Check
    elif settings.ENABLE_PROFANITY_FILTER and text_content and contains_profanity(text_content):
        violation_reason = "Нецензурная лексика запрещена"

    # 3. Spam Filter Check
    elif settings.ENABLE_SPAM_FILTER:
        is_spam, reason = check_spam(message)
        if is_spam:
            violation_reason = reason or "Спам / реклама запрещены"

    # If no violation found, pass through
    if not violation_reason:
        return

    # Violation detected: Delete original message immediately
    await delete_message_safe(bot, chat_id, message.message_id)

    # Issue a warning in database
    warn_count, _ = await db.add_warning(chat_id, user_id, violation_reason)
    user_mention = message.from_user.mention_html()

    # Check if max warnings threshold reached
    if warn_count >= settings.MAX_WARNINGS:
        duration_seconds = settings.MUTE_DURATION_HOURS * 3600
        muted = await mute_user(bot, chat_id, user_id, duration_seconds)
        
        # Reset warnings after punishment
        await db.reset_warnings(chat_id, user_id)

        if muted:
            alert = (
                f"🚫 {user_mention} заблокирован (мут на {settings.MUTE_DURATION_HOURS} ч.) "
                f"за превышение лимита предупреждений ({warn_count}/{settings.MAX_WARNINGS}).\n"
                f"Причина: <i>{violation_reason}</i>"
            )
        else:
            alert = (
                f"⚠️ {user_mention} превысил лимит предупреждений ({warn_count}/{settings.MAX_WARNINGS}), "
                f"но боту не хватает прав для выдачи мута! Выдайте боту права администратора (Restrict Users)."
            )
        await send_temp_message(bot, chat_id, alert, delay=15)
    else:
        alert = (
            f"⚠️ {user_mention}, ваше сообщение удалено!\n"
            f"Причина: <b>{violation_reason}</b>\n"
            f"Предупреждение: <b>{warn_count}/{settings.MAX_WARNINGS}</b>"
        )
        await send_temp_message(bot, chat_id, alert, delay=settings.AUTO_DELETE_ALERT_SECONDS)
