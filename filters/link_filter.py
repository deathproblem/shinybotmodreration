import re
from aiogram.types import Message
from aiogram.enums import MessageEntityType

# Regular expression to match standard and disguised URLs
URL_PATTERN = re.compile(
    r'(?i)\b(?:'
    r'(?:https?|ftp|tg)://[^\s<>"]+|'
    r'www\.[^\s<>"]+|'
    r't\.me/[^\s<>"]+|'
    r'telegram\.me/[^\s<>"]+|'
    r'telegra\.ph/[^\s<>"]+|'
    r'[a-z0-9][a-z0-9\-]{1,62}\.(?:com|ru|org|net|xyz|io|me|info|biz|top|online|site|pro|shop|click|app|club|link|live|fun|vip|co|in|ua|by|kz|tech|dev|su|space|store|agency|bot|cc|gg|to|tv|fm|ai)(?:/[^\s<>"]*)?'
    r')\b'
)

# Detect obfuscated URLs like "example[.]com", "example(.)ru", "example . com", "example dot ru", "site точка ru"
OBFUSCATED_URL_PATTERN = re.compile(
    r'(?i)[a-z0-9][a-z0-9\-]{1,62}\s*(?:\[\.\]|\(\.\)|\{\.\}|\.\s+|\s+\.|\s+(?:dot|точка)\s+)\s*(?:com|ru|org|net|xyz|io|me|info|biz|top|online|site|pro|shop|click|app|club|link|live|fun|vip|co|in|ua|by|kz|tech|dev|su)\b'
)


def contains_links(message: Message) -> bool:
    """
    Checks if a Telegram message contains any links.
    Inspects:
    1. Message entities (URL, TEXT_LINK)
    2. Caption entities (if media message)
    3. Raw text with URL regex
    4. Obfuscated / disguised URLs
    """
    # 1. Check message entities
    entities = message.entities or message.caption_entities or []
    for entity in entities:
        if entity.type in (MessageEntityType.URL, MessageEntityType.TEXT_LINK):
            return True

    # 2. Check text or caption content
    content = message.text or message.caption or ""
    if not content:
        return False

    # Standard URL search
    if URL_PATTERN.search(content):
        return True

    # Disguised / obfuscated domain search
    if OBFUSCATED_URL_PATTERN.search(content):
        return True

    return False
