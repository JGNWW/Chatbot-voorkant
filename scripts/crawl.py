"""Crawlt alle pagina's uit de NederlandWereldwijd-sitemap en bouwt een corpus.

Output: site/data/corpus.json  ->  [{"url","title","text"}, ...]

Beleefd: beperkte concurrency, eigen User-Agent, time-outs, en een korte pauze.
"""
import asyncio
import json
import re
import sys
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

SITEMAP_URL = "https://www.nederlandwereldwijd.nl/paginas/sitemap.xml"
OUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "corpus.json"
CONCURRENCY = 12
MAX_TEXT = 20000   # ruim: 23% van de pagina's liep tegen de oude limiet van 5000 aan
LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.IGNORECASE)


async def fetch_urls(client: httpx.AsyncClient) -> list[str]:
    r = await client.get(SITEMAP_URL, timeout=30)
    r.raise_for_status()
    return [u for u in LOC_RE.findall(r.text) if not u.endswith(".xml")]


BASE = "https://www.nederlandwereldwijd.nl"
# Terugkerende footer-blokken die op bijna elke pagina staan en geen inhoud toevoegen.
DROP_HEADINGS = {"Contact", "Ook nuttig"}


def extract(html: str, url: str) -> tuple[str, str, str, list, list]:
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(strip=True) if soup.title else url
    # Meta-omschrijving = beknopte, redactioneel geschreven samenvatting (zoek-index).
    desc_tag = soup.find("meta", attrs={"name": "description"})
    desc = desc_tag.get("content", "").strip() if desc_tag else ""
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.body
    # Koppen (h1-h3) bewaren als [niveau, tekst] zodat de preview de structuur kan tonen.
    headings: list = []
    if main:
        for h in main.find_all(["h1", "h2", "h3"]):
            t = " ".join(h.get_text(separator=" ", strip=True).split())
            if t:
                headings.append([int(h.name[1]), t])
    # Links uit de hoofdinhoud (linktekst -> absolute href), voor de bron-viewer.
    links: list = []
    seen = set()
    if main:
        for a in main.find_all("a", href=True):
            t = " ".join(a.get_text(" ", strip=True).split())
            href = a["href"].strip()
            if len(t) < 5 or href.startswith("#") or href.startswith("javascript"):
                continue
            if href.startswith("/"):
                href = BASE + href
            if (t, href) in seen:
                continue
            seen.add((t, href))
            links.append([t, href])

    text = main.get_text(separator="\n", strip=True) if main else ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Footer-blokken ('Contact', 'Ook nuttig') meteen weglaten: kop + alles tot de volgende kop.
    htexts = {t for _, t in headings}
    out, i = [], 0
    while i < len(lines):
        if lines[i] in DROP_HEADINGS and any(lvl == 2 and t == lines[i] for lvl, t in headings):
            i += 1
            while i < len(lines) and lines[i] not in htexts:
                i += 1
            continue
        out.append(lines[i])
        i += 1
    headings = [[lvl, t] for lvl, t in headings if t not in DROP_HEADINGS]
    return title, desc, "\n".join(out)[:MAX_TEXT], headings, links


async def crawl():
    headers = {"User-Agent": "VoorlichterBot/1.0 (testomgeving; contact via klantcontactcentrum)"}
    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        urls = await fetch_urls(client)
        print(f"Sitemap: {len(urls)} pagina's", flush=True)

        sem = asyncio.Semaphore(CONCURRENCY)
        corpus: list[dict] = []
        done = 0
        failed = 0

        async def one(url: str):
            nonlocal done, failed
            async with sem:
                for attempt in range(2):
                    try:
                        r = await client.get(url, timeout=25)
                        r.raise_for_status()
                        title, desc, text, headings, links = extract(r.text, url)
                        if text:
                            corpus.append({"url": url, "title": title, "desc": desc, "text": text,
                                           "headings": headings, "links": links})
                        break
                    except Exception:
                        if attempt == 1:
                            failed += 1
                        await asyncio.sleep(0.5)
                done += 1
                if done % 200 == 0:
                    print(f"  {done}/{len(urls)} (mislukt: {failed})", flush=True)

        await asyncio.gather(*(one(u) for u in urls))

        corpus.sort(key=lambda c: c["url"])
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(corpus, ensure_ascii=False), encoding="utf-8")
        size_mb = OUT.stat().st_size / 1_000_000
        print(f"KLAAR: {len(corpus)} pagina's, {failed} mislukt, {size_mb:.1f} MB -> {OUT}", flush=True)


if __name__ == "__main__":
    asyncio.run(crawl())
    sys.exit(0)
