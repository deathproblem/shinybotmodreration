import asyncio
import re
from datetime import datetime, timedelta
from typing import Optional

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import Message, ChatPermissions, ChatMemberAdministrator, ChatMemberOwner
from config import settings


async def is_admin(bot: Bot, chat_id: int, user_id: int) -> bool:
    """Checks if a user is an administrator or owner of the chat."""
    if user_id in settings.ADMIN_IDS:
        return True

    try:
        member = await bot.get_chat_member(chat_id=chat_id, user_id=user_id)
        return isinstance(member, (ChatMemberAdministrator, ChatMemberOwner))
    except Exception:
        return False


async def delete_message_safe(bot: Bot, chat_id: int, message_id: int) -> bool:
    """Safely deletes a message without crashing if already deleted or lacking rights."""
    try:
        await bot.delete_message(chat_id=chat_id, message_id=message_id)
        return True
    except TelegramBadRequest:
        return False
    except Exception:
        return False


async def send_temp_message(bot: Bot, chat_id: int, text: str, delay: int = settings.AUTO_DELETE_ALERT_SECONDS):
    """Sends a notification message to the chat and deletes it automatically after `delay` seconds."""
    try:
        msg = await bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")

        async def _delete_later():
            await asyncio.sleep(delay)
            await delete_message_safe(bot, chat_id, msg.message_id)

        asyncio.create_task(_delete_later())
    except Exception:
        pass


def parse_time_duration(time_str: str) -> Optional[int]:
    """
    Parses duration string like '10m', '2h', '1d', '30s'.
    Returns seconds.
    """
    match = re.match(r'^(\d+)\s*([smhdдчмс]?)$', time_str.strip().lower())
    if not match:
        return None

    value = int(match.group(1))
    unit = match.group(2)

    if unit in ('s', 'с'):
        return value
    elif unit in ('m', 'м', ''): # Default minutes
        return value * 60
    elif unit in ('h', 'ч'):
        return value * 3600
    elif unit in ('d', 'д'):
        return value * 86400

    return value * 60


async def mute_user(bot: Bot, chat_id: int, user_id: int, duration_seconds: int) -> bool:
    """Mutes a user for the specified number of seconds."""
    try:
        until_date = datetime.utcnow() + timedelta(seconds=duration_seconds)
        permissions = ChatPermissions(
            can_send_messages=False,
            can_send_audios=False,
            can_send_documents=False,
            can_send_photos=False,
            can_send_videos=False,
            can_send_video_notes=False,
            can_send_voice_notes=False,
            can_send_polls=False,
            can_send_other_messages=False,
            can_add_web_page_previews=False
        )
        await bot.restrict_chat_member(
            chat_id=chat_id,
            user_id=user_id,
            permissions=permissions,
            until_date=until_date
        )
        return True
    except Exception as e:
        print(f"Failed to mute user {user_id}: {e}")
        return False


async def unmute_user(bot: Bot, chat_id: int, user_id: int) -> bool:
    """Restores standard user permissions in the chat."""
    try:
        permissions = ChatPermissions(
            can_send_messages=True,
            can_send_audios=True,
            can_send_documents=True,
            can_send_photos=True,
            can_send_videos=True,
            can_send_video_notes=True,
            can_send_voice_notes=True,
            can_send_polls=True,
            can_send_other_messages=True,
            can_add_web_page_previews=True
        )
        await bot.restrict_chat_member(
            chat_id=chat_id,
            user_id=user_id,
            permissions=permissions
        )
        return True
    except Exception as e:
        print(f"Failed to unmute user {user_id}: {e}")
        return False
