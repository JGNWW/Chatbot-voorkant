"""Ophalen en cachen van de sitemap van NederlandWereldwijd.nl.

De zoekfunctie van de site draait client-side (JavaScript) en is daarom niet
server-side bruikbaar. De sitemap bevat wel alle pagina-URL's met beschrijvende
slugs en dient als vindmechanisme voor de juiste pagina bij een vraag.
"""
import re
import time

import httpx

from .config import settings

_LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.IGNORECASE)


class Page:
    """Een vindbare pagina: URL, een uit de slug afgeleide titel en zoek-tokens."""

    __slots__ = ("url", "title", "tokens")

    def __init__(self, url: str) -> None:
        self.url = url
        path = url.split("//", 1)[-1].split("/", 1)[-1].rstrip("/")
        slug = path.rsplit("/", 1)[-1] if path else ""
        self.title = slug.replace("-", " ").strip().capitalize() or url
        # Tokens uit het hele pad, zodat ook bovenliggende onderwerpen meetellen.
        self.tokens = set(re.split(r"[-/]", path.lower()))


_cache: dict[str, object] = {"pages": [], "fetched_at": 0.0}


async def _fetch_xml(client: httpx.AsyncClient, url: str) -> str:
    resp = await client.get(url, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


async def get_pages(force: bool = False) -> list[Page]:
    """Geeft de (gecachete) lijst met pagina's terug; ververst na de TTL."""
    age = time.time() - float(_cache["fetched_at"])  # type: ignore[arg-type]
    if not force and _cache["pages"] and age < settings.sitemap_ttl_seconds:
        return _cache["pages"]  # type: ignore[return-value]

    async with httpx.AsyncClient(headers={"User-Agent": "VoorlichterBot/1.0"}) as client:
        index_xml = await _fetch_xml(client, settings.sitemap_url)
        sub_sitemaps = _LOC_RE.findall(index_xml)

        urls: set[str] = set()
        if sub_sitemaps and all(s.endswith(".xml") for s in sub_sitemaps):
            # Het is een sitemap-index: haal de onderliggende sitemaps op.
            for sm in sub_sitemaps:
                try:
                    xml = await _fetch_xml(client, sm)
                except httpx.HTTPError:
                    continue
                for loc in _LOC_RE.findall(xml):
                    if not loc.endswith(".xml"):
                        urls.add(loc)
        else:
            urls.update(sub_sitemaps)

    pages = [Page(u) for u in sorted(urls)]
    _cache["pages"] = pages
    _cache["fetched_at"] = time.time()
    return pages
