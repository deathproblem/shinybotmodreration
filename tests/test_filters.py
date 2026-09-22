import unittest
from aiogram.types import Message, MessageEntity, Chat, User
from filters.link_filter import contains_links
from filters.profanity_filter import contains_profanity, normalize_text
from filters.spam_filter import is_caps_abuse, is_character_spam


class DummyMessage:
    def __init__(self, text="", entities=None, caption=None, caption_entities=None):
        self.text = text
        self.entities = entities or []
        self.caption = caption
        self.caption_entities = caption_entities or []


class TestModeratorFilters(unittest.TestCase):
    def test_link_filter_positive(self):
        links = [
            "Заходи на https://example.com прямо сейчас",
            "Мой канал: t.me/super_channel",
            "Подписывайтесь www.mywebsite.org",
            "Сайт: test[.]ru",
            "Сайт: test(.)com",
            "Ссылка test . ru здесь",
            "Ссылка shop dot ru"
        ]
        for link_text in links:
            msg = DummyMessage(text=link_text)
            self.assertTrue(
                contains_links(msg),
                f"Failed to detect link in: {link_text}"
            )

    def test_link_filter_entities(self):
        from aiogram.enums import MessageEntityType
        # Test entity URL
        e_url = MessageEntity(type=MessageEntityType.URL, offset=0, length=10)
        msg_url = DummyMessage(text="Нажми тут", entities=[e_url])
        self.assertTrue(contains_links(msg_url))

        # Test entity TEXT_LINK (hyperlink)
        e_tlink = MessageEntity(type=MessageEntityType.TEXT_LINK, offset=0, length=5, url="http://spam.ru")
        msg_tlink = DummyMessage(text="Клик!", entities=[e_tlink])
        self.assertTrue(contains_links(msg_tlink))

    def test_link_filter_negative(self):
        clean_texts = [
            "Привет всем в этом чате!",
            "У меня есть вопрос по Python 3.11",
            "Сегодня хорошая погода, 15.5 градусов",
            "Встречаемся в 18:00!",
            "Версия программы 2.0.4 вышла вчера"
        ]
        for clean_text in clean_texts:
            msg = DummyMessage(text=clean_text)
            self.assertFalse(
                contains_links(msg),
                f"False positive on link: {clean_text}"
            )

    def test_profanity_filter_positive(self):
        profane_texts = [
            "Ты просто пиздец какой странный",
            "Пошел на хуй отсюда",
            "Какая же ты сyка",          # mixed latin 'y'
            "Ты сук@ конченая",           # symbol '@'
            "Ну ты и п.и.з.д.е.ц",       # dots inside word
            "п о х у й на все",          # spaced letters
            "хуевый день",
            "суууукааааа",               # repeated letters
            "б л я т ь",
            "ну и мудак"
        ]
        for prof_text in profane_texts:
            self.assertTrue(
                contains_profanity(prof_text),
                f"Failed to detect profanity in: {prof_text}"
            )

    def test_profanity_filter_whitelist(self):
        clean_texts = [
            "Я заплатил один рубль за проезд",
            "Не надо употреблять вредную еду",
            "Колебания курса валют продолжаются",
            "Хлеб всему голова",
            "Академическая гребля — отличный спорт",
            "Оформил ОСАГО и страхование жизни",
            "Играем в шахматы сегодня вечером",
            "В комнате растет суккулент"
        ]
        for clean_text in clean_texts:
            self.assertFalse(
                contains_profanity(clean_text),
                f"False positive on clean text: {clean_text}"
            )

    def test_spam_caps(self):
        caps_spam = "СРОЧНО ВСЕ СЮДА БЕСПЛАТНО КУПИТЕ ЭТО ПРЯМО СЕЙЧАС"
        normal_text = "Привет всем, это нормальное сообщение с Caps."
        short_caps = "OK!"
        self.assertTrue(is_caps_abuse(caps_spam))
        self.assertFalse(is_caps_abuse(normal_text))
        self.assertFalse(is_caps_abuse(short_caps))

    def test_spam_char_flood(self):
        char_spam = "а" * 35
        normal_text = "ураааа!"
        self.assertTrue(is_character_spam(char_spam))
        self.assertFalse(is_character_spam(normal_text))


if __name__ == '__main__':
    unittest.main()
