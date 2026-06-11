#!/usr/bin/env python3
"""Verrijkt het bestaande corpus met een 'links'-veld per pagina (linktekst -> href),
zodat de bron-viewer dezelfde links kan tonen als de echte NederlandWereldwijd-pagina's.

Belangrijk: de TEKST en HEADINGS van het corpus blijven ONGEWIJZIGD (zodat bestaande
citaten en embeddings blijven kloppen). We voegen alleen 'links' toe.

Gebruik: python add_links.py [aantal]   (aantal = optioneel, voor een testrun)
"""
import asyncio, json, sys
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

CORPUS = Path(__file__).resolve().parent.parent / "docs" / "data" / "corpus.json"
BASE = "https://www.nederlandwereldwijd.nl"
CONCURRENCY = 10

def extract_links(html: str):
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.body
    if not main:
        return []
    out, seen = [], set()
    for a in main.find_all("a", href=True):
        t = " ".join(a.get_text(" ", strip=True).split())
        href = a["href"].strip()
        if len(t) < 5 or href.startswith("#") or href.startswith("javascript"):
            continue
        if href.startswith("/"):
            href = BASE + href
        key = (t, href)
        if key in seen:
            continue
        seen.add(key)
        out.append([t, href])
    return out

async def main():
    data = json.loads(CORPUS.read_text(encoding="utf-8"))
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(data)
    records = data[:limit]
    print(f"Pagina's verrijken: {len(records)}", flush=True)
    headers = {"User-Agent": "VoorlichterBot/1.0 (testomgeving; links voor bron-viewer)"}
    sem = asyncio.Semaphore(CONCURRENCY)
    done = {"n": 0, "fail": 0, "links": 0}
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=20) as client:
        async def one(rec):
            async with sem:
                try:
                    r = await client.get(rec["url"])
                    r.raise_for_status()
                    rec["links"] = extract_links(r.text)
                    done["links"] += len(rec["links"])
                except Exception:
                    rec["links"] = []
                    done["fail"] += 1
                done["n"] += 1
                if done["n"] % 250 == 0:
                    print(f"  {done['n']}/{len(records)} (links: {done['links']}, fouten: {done['fail']})", flush=True)
        await asyncio.gather(*(one(r) for r in records))
    CORPUS.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"KLAAR: {done['n']} pagina's, {done['links']} links totaal, {done['fail']} fouten", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
