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
OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "corpus.json"
CONCURRENCY = 12
MAX_TEXT = 5000
LOC_RE = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.IGNORECASE)


async def fetch_urls(client: httpx.AsyncClient) -> list[str]:
    r = await client.get(SITEMAP_URL, timeout=30)
    r.raise_for_status()
    return [u for u in LOC_RE.findall(r.text) if not u.endswith(".xml")]


def extract(html: str, url: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(strip=True) if soup.title else url
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.body
    text = main.get_text(separator="\n", strip=True) if main else ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return title, "\n".join(lines)[:MAX_TEXT]


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
                        title, text = extract(r.text, url)
                        if text:
                            corpus.append({"url": url, "title": title, "text": text})
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
