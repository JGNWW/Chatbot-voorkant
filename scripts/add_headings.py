"""Verrijkt het bestaande corpus.json met de koppenstructuur (h1-h3) per pagina.

Belangrijk: de bestaande pagina's worden IN VOLGORDE behouden en de velden
url/title/desc/text blijven ongewijzigd, zodat embeddings.bin (dat dezelfde
volgorde aanhoudt) blijft kloppen. Er wordt alleen een veld "headings" toegevoegd:
een lijst van [niveau, tekst]-paren, bv. [[1, "Paspoort aanvragen"], [2, "..."]].

Pagina's die nu niet (meer) op te halen zijn, krijgen "headings": [].
"""
import asyncio
import json
import sys
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

CORPUS = Path(__file__).resolve().parent.parent / "docs" / "data" / "corpus.json"
CONCURRENCY = 12


def headings_of(html: str) -> list[list]:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.body
    out: list[list] = []
    if main:
        for h in main.find_all(["h1", "h2", "h3"]):
            t = " ".join(h.get_text(separator=" ", strip=True).split())
            if t:
                out.append([int(h.name[1]), t])
    return out


async def run():
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    print(f"{len(corpus)} pagina's verrijken met koppen", flush=True)
    headers = {"User-Agent": "VoorlichterBot/1.0 (testomgeving; contact via klantcontactcentrum)"}
    sem = asyncio.Semaphore(CONCURRENCY)
    done = 0
    failed = 0

    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        async def one(entry: dict):
            nonlocal done, failed
            async with sem:
                for attempt in range(2):
                    try:
                        r = await client.get(entry["url"], timeout=25)
                        r.raise_for_status()
                        entry["headings"] = headings_of(r.text)
                        break
                    except Exception:
                        if attempt == 1:
                            failed += 1
                            entry.setdefault("headings", [])
                        await asyncio.sleep(0.5)
                done += 1
                if done % 200 == 0:
                    print(f"  {done}/{len(corpus)} (mislukt: {failed})", flush=True)

        await asyncio.gather(*(one(e) for e in corpus))

    CORPUS.write_text(json.dumps(corpus, ensure_ascii=False), encoding="utf-8")
    size_mb = CORPUS.stat().st_size / 1_000_000
    print(f"KLAAR: {len(corpus)} pagina's, {failed} mislukt, {size_mb:.1f} MB -> {CORPUS}", flush=True)


if __name__ == "__main__":
    asyncio.run(run())
    sys.exit(0)
