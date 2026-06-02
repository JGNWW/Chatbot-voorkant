"""Selecteer kandidaat-pagina's uit de sitemap op basis van de vraag.

Eerst een goedkope trefwoord-ranking (op de slugs) om de 4000+ pagina's terug te
brengen tot een handvol kandidaten. Het LLM kiest daarna de definitieve pagina.
"""
import re

from .sitemap import Page

# Veelvoorkomende Nederlandse stopwoorden die niets toevoegen aan de match.
_STOPWORDS = {
    "de", "het", "een", "en", "van", "in", "op", "te", "voor", "met", "aan",
    "is", "ik", "je", "u", "hoe", "wat", "waar", "wanneer", "kan", "moet",
    "mijn", "uw", "ben", "wil", "naar", "om", "dat", "die", "er", "ook",
    "als", "of", "bij", "dan", "zijn", "heb", "heeft", "wordt", "worden",
    "the", "a", "to", "of",
}


def _tokenize(text: str) -> list[str]:
    words = re.split(r"[^a-z0-9]+", text.lower())
    return [w for w in words if len(w) > 2 and w not in _STOPWORDS]


def rank_pages(question: str, pages: list[Page], limit: int = 25) -> list[Page]:
    """Geeft de best scorende pagina's terug, gesorteerd op relevantie."""
    q_tokens = _tokenize(question)
    if not q_tokens:
        return []

    scored: list[tuple[float, Page]] = []
    for page in pages:
        overlap = sum(1 for t in q_tokens if t in page.tokens)
        if overlap == 0:
            continue
        # Normaliseer licht zodat kortere, specifiekere paden niet benadeeld worden.
        score = overlap + overlap / (len(page.tokens) + 1)
        scored.append((score, page))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored[:limit]]
