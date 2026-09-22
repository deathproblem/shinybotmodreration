import asyncio
import logging
import sys

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from config import settings
from database.db import db
from handlers.admin import router as admin_router
from handlers.moderation import router as moderation_router
from middlewares.flood_middleware import AntiFloodMiddleware


async def main():
    # Setup structured logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout)
        ]
    )
    logger = logging.getLogger("ModeratorBot")

    if not settings.BOT_TOKEN or settings.BOT_TOKEN == "YOUR_TELEGRAM_BOT_TOKEN_HERE":
        logger.error(
            "CRITICAL: BOT_TOKEN не указан! Укажите токен вашего бота в файле .env "
            "(получите его у @BotFather в Telegram)."
        )
        sys.exit(1)

    # Initialize SQLite database
    logger.info("Инициализация базы данных...")
    await db.init()

    # Create Bot & Dispatcher instances
    bot = Bot(
        token=settings.BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML)
    )
    dp = Dispatcher()

    # Register Middlewares
    dp.message.middleware(AntiFloodMiddleware())

    # Register Routers (order matters: admin commands first, then moderation filter)
    dp.include_router(admin_router)
    dp.include_router(moderation_router)

    try:
        # Drop pending updates to avoid processing backlog
        await bot.delete_webhook(drop_pending_updates=True)
        bot_info = await bot.get_me()
        logger.info(f"🚀 Бот успешно запущен: @{bot_info.username} (ID: {bot_info.id})")
        logger.info("Мониторинг групп и фильтрация спама/ссылок/мата активны.")
        
        # Start long polling
        await dp.start_polling(bot)
    finally:
        await bot.session.close()
        logger.info("Бот остановлен.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logging.info("Работа бота завершена.")
