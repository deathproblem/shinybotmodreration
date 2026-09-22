import re
from typing import Set, List

# Homoglyphs and leetspeak substitution map
HOMOGLYPHS = {
    'a': 'а', '@': 'а',
    'b': 'в', '6': 'б',
    'c': 'с', 's': 'с', '$': 'с',
    'd': 'д',
    'e': 'е', '3': 'з', 'ë': 'е', 'ё': 'е',
    'h': 'н',
    'i': 'и', '1': 'и', '!': 'и', '|': 'и', 'j': 'й',
    'k': 'к',
    'm': 'м',
    'n': 'п',
    'o': 'о', '0': 'о',
    'p': 'р',
    'r': 'г',
    't': 'т', '7': 'т',
    'u': 'у', 'y': 'у',
    'v': 'в',
    'w': 'в',
    'x': 'х',
    'z': 'з',
    '4': 'ч',
    'g': 'г'
}

COLLAPSE_REPEATS = re.compile(r'(.)\1{2,}', re.IGNORECASE)

# Roots that are inherently obscene in Russian (sub-string matching safe with whitelist)
INHERENT_OBSCENE_ROOTS = [
    r'п[иеё]зд',           # пизда, пиздец, распиздяй
    r'залуп',              # залупа, залупился
    r'шлюх',               # шлюха, шлюхи
    r'шлюш',               # шлюшка
    r'п[ие]д[ао]р',        # пидор, пидар, пидорас
    r'педик',              # педик
    r'дроч',               # дрочить, задрот
    r'елда',               # елда
    r'манда',              # манда
    r'муд[аио]к',          # мудак, мудило
    r'мудозвон',           # мудозвон
    r'г[ао]ндон',          # гондон, гандон
]

# Patterns with word context
WORD_PROFANITY_PATTERNS = [
    # х*й / х*е / х*я / х*ю / х*и
    r'\bху[йиеёяю]',
    r'\bпоху[йиеёяю]',
    r'\bнаху[йи]',
    r'\bниху[яе]',
    r'\bоху[еёеел]',
    r'\bдоху[яе]',
    r'\bхер(?:[а-яё]*)?\b',

    # *бать, *бал, *бло, etc.
    r'\b[её]б[а-яё]*\b',
    r'\bвыеб[а-яё]*\b',
    r'\bзаеб[а-яё]*\b',
    r'\bнаеб[а-яё]*\b',
    r'\bперееб[а-яё]*\b',
    r'\bпоеб[а-яё]*\b',
    r'\bподъеб[а-яё]*\b',
    r'\bпроеб[а-яё]*\b',
    r'\bразъеб[а-яё]*\b',
    r'\bуеб[а-яё]*\b',
    r'\bс[ъь]?еб[а-яё]*\b',
    r'\bебл[а-яё]*\b',
    r'\bебуч[а-яё]*\b',
    r'\bебн[а-яё]*\b',
    r'\b[ие]б[аеёиуыл]',

    # бл*дь, бл*ть, бл*т
    r'\bбл[яе][дт][а-яё]*\b',
    r'\bбля\b',
    r'\bблэт\b',

    # с*ка, с*чка
    r'\bсук[аиоеуы]\b',
    r'\bсучк[а-яё]*\b',
    r'\bсучар[а-яё]*\b',

    r'\bмраз[ььея]\b',
]

INHERENT_REGEXES = [re.compile(p, re.IGNORECASE) for p in INHERENT_OBSCENE_ROOTS]
WORD_REGEXES = [re.compile(p, re.IGNORECASE) for p in WORD_PROFANITY_PATTERNS]

WHITELIST: Set[str] = {
    'рубль', 'рубля', 'рубли', 'рублей', 'рублик',
    'употреблять', 'употребление', 'употребляет', 'употребить', 'злоупотреблять',
    'колебаться', 'колебание', 'колебания', 'поколебать', 'колеблется',
    'хлеб', 'хлеба', 'хлебом', 'хлебный', 'хлебобулочный',
    'гребля', 'выгребать', 'загребать', 'погребальный', 'погреб',
    'стебель', 'стебли', 'стеблевой',
    'теребить', 'теребит',
    'скрести', 'скребок', 'выскребать',
    'страховка', 'страхование', 'застраховать', 'страховать', 'страху', 'страх',
    'скипидар',
    'педиатрия', 'педиатр',
    'мудрость', 'мудрый', 'мудрец', 'смудрить',
    'бляха', 'сабля', 'саблями',
    'сукно', 'суккулент', 'суккуленты',
    'шахматы', 'эрудит', 'рябчик', 'ястреб',
    'парикмахер', 'парикмахерская',
    'команда', 'командовать', 'командир', 'командование', 'мандат', 'мандарин', 'мандарины'
}


def normalize_text(text: str) -> str:
    """Replaces homoglyphs and leetspeak numbers."""
    text = text.lower()
    chars = [HOMOGLYPHS.get(ch, ch) for ch in text]
    return "".join(chars)


def is_whitelisted(word: str) -> bool:
    """Checks if a word or phrase is in the whitelist."""
    clean = re.sub(r'[^а-яё]', '', word.lower())
    if clean in WHITELIST:
        return True
    for item in WHITELIST:
        if clean == item or (len(item) >= 4 and item in clean):
            return True
    return False


def _extract_word_variations(text: str) -> List[str]:
    """
    Extracts words from text including:
    - Normal space-separated words
    - Reconstructed words where single characters were spaced or separated by dots/symbols (e.g. п.и.з.д.е.ц or п о х у й)
    """
    # Replace punctuation and symbols with space
    cleaned = re.sub(r'[\s_.,!?:;\-\*\+~`\"\'\\/|@#%^&()\[\]{}]+', ' ', text)
    tokens = cleaned.split()

    variations = []
    # Standard words with repeated characters collapsed
    for t in tokens:
        clean_t = re.sub(r'[^а-яё]', '', t)
        if clean_t:
            variations.append(clean_t)
            c1 = re.sub(r'(.)\1+', r'\1', clean_t)
            variations.append(c1)
            c2 = re.sub(r'(.)\1{2,}', r'\1\1', clean_t)
            variations.append(c2)

    # Reconstruct single-letter runs (e.g. ['п', 'и', 'з', 'д', 'е', 'ц'])
    single_buffer = []
    for t in tokens:
        clean_t = re.sub(r'[^а-яё]', '', t)
        if len(clean_t) == 1:
            single_buffer.append(clean_t)
        else:
            if len(single_buffer) >= 2:
                joined = ''.join(single_buffer)
                variations.append(joined)
                variations.append(re.sub(r'(.)\1+', r'\1', joined))
            single_buffer = []
    if len(single_buffer) >= 2:
        joined = ''.join(single_buffer)
        variations.append(joined)
        variations.append(re.sub(r'(.)\1+', r'\1', joined))

    return list(set(variations))


def contains_profanity(text: str) -> bool:
    """
    Checks if given text contains profanity.
    Protects against obfuscation (spaces, dots, homoglyphs, repeated chars).
    """
    if not text:
        return False

    normalized = normalize_text(text)
    words = _extract_word_variations(normalized)

    for word in words:
        if is_whitelisted(word):
            continue

        # Check inherent obscene roots (e.g. пизд, залуп, etc.)
        for regex in INHERENT_REGEXES:
            if regex.search(word):
                return True

        # Check word-bounded patterns (хуй, ебать, бля, сука, etc.)
        for regex in WORD_REGEXES:
            if regex.search(word):
                return True

    # Also test the completely compacted text against inherent roots
    compacted = re.sub(r'[^а-яё]', '', normalized)
    if compacted and not is_whitelisted(compacted):
        for regex in INHERENT_REGEXES:
            if regex.search(compacted):
                return True

    return False
