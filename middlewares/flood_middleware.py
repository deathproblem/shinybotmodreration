import time
from typing import Dict, List, Tuple, Callable, Any, Awaitable
from aiogram import BaseMiddleware, Bot
from aiogram.types import Message, TelegramObject
from config import settings
from utils.chat_helpers import is_admin, delete_message_safe, send_temp_message


class AntiFloodMiddleware(BaseMiddleware):
    def __init__(self):
        super().__init__()
        # Store message timestamps: (chat_id, user_id) -> List[float]
        self.user_timestamps: Dict[Tuple[int, int], List[float]] = {}
        # Store mute/warn state to avoid multiple alert messages on fast flood
        self.muted_flood_until: Dict[Tuple[int, int], float] = {}

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any]
    ) -> Any:
        if not isinstance(event, Message) or not event.from_user or not event.chat:
            return await handler(event, data)

        # Ignore private chats
        if event.chat.type == "private":
            return await handler(event, data)

        if not settings.ENABLE_FLOOD_FILTER:
            return await handler(event, data)

        bot: Bot = data["bot"]
        chat_id = event.chat.id
        user_id = event.from_user.id
        now = time.time()
        key = (chat_id, user_id)

        # Allow admins to bypass if enabled
        if settings.ALLOW_ADMINS_BYPASS and await is_admin(bot, chat_id, user_id):
            return await handler(event, data)

        # Check if currently flagged for flood
        flagged_until = self.muted_flood_until.get(key, 0)
        if now < flagged_until:
            await delete_message_safe(bot, chat_id, event.message_id)
            return

        # Clean old timestamps outside the window
        timestamps = self.user_timestamps.get(key, [])
        cutoff = now - settings.FLOOD_TIME_SECONDS
        timestamps = [t for t in timestamps if t > cutoff]
        timestamps.append(now)
        self.user_timestamps[key] = timestamps

        if len(timestamps) > settings.FLOOD_MESSAGE_LIMIT:
            # Flood limit exceeded!
            self.muted_flood_until[key] = now + settings.FLOOD_TIME_SECONDS
            await delete_message_safe(bot, chat_id, event.message_id)
            
            user_mention = event.from_user.mention_html()
            await send_temp_message(
                bot,
                chat_id,
                f"⚠️ {user_mention}, прекратите флуд! Сообщения удалены."
            )
            return

        return await handler(event, data)
