import re
from typing import Optional, Tuple
from aiogram.types import Message
from aiogram.enums import MessageEntityType
from config import settings


def is_caps_abuse(text: str) -> bool:
    """Detects if message is written in excessive Caps Lock."""
    if not text or len(text) < settings.MIN_CAPS_LEN:
        return False

    letters = [ch for ch in text if ch.isalpha()]
    if not letters or len(letters) < settings.MIN_CAPS_LEN:
        return False

    upper_count = sum(1 for ch in letters if ch.isupper())
    percentage = (upper_count / len(letters)) * 100

    return percentage >= settings.MAX_CAPS_PERCENT


def is_mass_mention(message: Message) -> bool:
    """Checks if message contains mass mentions intended for spam/harassment."""
    entities = message.entities or message.caption_entities or []
    mention_count = sum(
        1 for e in entities if e.type in (MessageEntityType.MENTION, MessageEntityType.TEXT_MENTION)
    )

    if mention_count > settings.MAX_MENTIONS:
        return True

    # Fallback regex for raw text @mentions
    text = message.text or message.caption or ""
    raw_mentions = len(re.findall(r'(?<!\w)@[a-zA-Z0-9_]{3,}', text))
    return raw_mentions > settings.MAX_MENTIONS


def is_channel_forward(message: Message) -> bool:
    """Checks if message is forwarded from a public channel (often used for ad spam)."""
    if not settings.BLOCK_FORWARD_FROM_CHANNELS:
        return False

    # aiogram 3 MessageOrigin check
    if message.forward_origin:
        origin_type = getattr(message.forward_origin, 'type', None)
        if origin_type == 'channel':
            return True

    # Backward compatibility check
    if getattr(message, 'forward_from_chat', None) and message.forward_from_chat.type == 'channel':
        return True

    return False


def is_character_spam(text: str) -> bool:
    """Detects character flooding, e.g. repeating same character 30+ times."""
    if not text:
        return False
    # 30+ identical consecutive characters
    if re.search(r'(.)\1{29,}', text):
        return True
    return False


def check_spam(message: Message) -> Tuple[bool, Optional[str]]:
    """
    Checks message for various spam patterns.
    Returns (is_spam, reason).
    """
    if not settings.ENABLE_SPAM_FILTER:
        return False, None

    text = message.text or message.caption or ""

    if is_channel_forward(message):
        return True, "Пересылка рекламы из канала"

    if is_mass_mention(message):
        return True, f"Массовое упоминание пользователей (более {settings.MAX_MENTIONS})"

    if is_caps_abuse(text):
        return True, "Злоупотребление CAPS LOCK"

    if is_character_spam(text):
        return True, "Спам повторяющимися символами"

    return False, None
