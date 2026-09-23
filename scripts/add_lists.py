"""Verrijkt het bestaande corpus.json met de OPSOMMINGEN (<ol>/<ul>) per pagina.

Waarom: de crawler haalt de paginatekst op met get_text(), en daarbij verdwijnt de lijstopmaak.
Een genummerd stappenplan ("1. Open uw DigiD app ...", "2. Klik op ...") kwam in het corpus
terecht als losse regels zonder nummer, en de app moest raden wat een opsomming was. Dat ging
mis: stappen werden bolletjes, een stap van twee zinnen werd twee bolletjes, en een "Let op:"-
blok eronder werd ook een bolletje.

Net als add_headings.py en add_links.py blijven de bestaande pagina's IN VOLGORDE staan en
blijven url/title/desc/text ONGEWIJZIGD, zodat bm25.bin en de embeddings blijven kloppen. Er
komt alleen een veld "lists" bij, met tekstposities in "text":

    "lists": [[genummerd, s1, e1, s2, e2, ...], ...]

genummerd is 1 voor <ol> en 0 voor <ul>; (s, e) is het bereik van één lijstitem in "text".
Een lijst die niet (meer) regel voor regel in de opgeslagen tekst terug te vinden is, valt weg:
liever geen opmaak dan een verkeerde. Pagina's die nu niet op te halen zijn krijgen GEEN veld,
zodat de app daar op de oude herkenning terugvalt; een lege lijst betekent "gecontroleerd,
er staan geen opsommingen op deze pagina".

Gebruik: python scripts/add_lists.py   (daarna: node scripts/split_corpus.mjs)
"""
import asyncio
import copy
import json
import sys
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

CORPUS = Path(__file__).resolve().parent.parent / "docs" / "data" / "corpus.json"
CONCURRENCY = 12


def norm(s: str) -> str:
    return " ".join(s.split())


def regels_van(el) -> list[str]:
    regels = [norm(r) for r in el.get_text(separator="\n", strip=True).splitlines()]
    return [r for r in regels if r]


def lists_of(html: str) -> list[tuple[int, list[tuple[list[str], list[str]]]]]:
    """Alle opsommingen in de hoofdinhoud, in documentvolgorde, als (genummerd, items).

    Elk item is (eigen regels, alle regels): bij een geneste lijst staan de subitems in de tekst
    direct onder het item. Die horen bij het zoeken wel mee te tellen, maar niet bij het item.
    """
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.body
    out = []
    if not main:
        return out
    for lst in main.find_all(["ol", "ul"]):
        items = []
        for li in lst.find_all("li", recursive=False):
            # Een geneste lijst is een eigen lijst (die komt zelf ook langs in find_all); in het
            # item van de buitenste lijst hoort alleen de eigen tekst.
            alle = regels_van(li)
            eigen_li = copy.copy(li)
            for sub in eigen_li.find_all(["ol", "ul"]):
                sub.decompose()
            eigen = regels_van(eigen_li)
            if eigen:
                # Staat de geneste lijst niet ONDER de eigen tekst maar ertussen, dan telt het
                # hele item als één bereik.
                items.append((eigen if alle[:len(eigen)] == eigen else alle, alle))
        if items:
            out.append((1 if lst.name == "ol" else 0, items))
    return out


def locate(text: str, lists) -> list[list[int]]:
    """Zoekt elke lijst regel voor regel terug in de opgeslagen tekst en geeft tekstposities."""
    lines, starts, pos = [], [], 0
    for raw in text.split("\n"):
        lines.append(norm(raw))
        starts.append(pos)
        pos += len(raw) + 1
    raw_lines = text.split("\n")
    ends = [starts[k] + len(raw_lines[k]) for k in range(len(lines))]

    def match_at(k: int, items) -> list[tuple[int, int]] | None:
        rng = []
        for eigen, alle in items:
            # Lege regels in de tekst overslaan, net als get_text(strip=True) doet.
            while k < len(lines) and not lines[k]:
                k += 1
            if lines[k:k + len(alle)] != alle:
                return None
            rng.append((starts[k], ends[k + len(eigen) - 1]))
            k += len(alle)
        return rng

    out, cursor = [], 0
    for genummerd, items in lists:
        eerste = items[0][1][0]
        gevonden = None
        # Eerst vanaf waar de vorige lijst ophield (documentvolgorde), dan desnoods overal.
        for van in (cursor, 0):
            for k in range(van, len(lines)):
                if lines[k] == eerste:
                    gevonden = match_at(k, items)
                    if gevonden:
                        break
            if gevonden:
                break
        if not gevonden:
            continue
        # Twee keer dezelfde lijst (bv. een geneste die ook in zijn ouder stond) niet dubbel.
        if any(r[1] == gevonden[0][0] for r in out):
            continue
        rij = [genummerd]
        for s, e in gevonden:
            rij += [s, e]
        out.append(rij)
        cursor = starts.index(gevonden[-1][0]) + 1
    out.sort(key=lambda r: r[1])
    # De app rekent in JavaScript, en daar telt een teken buiten het BMP (een emoji) als twee.
    if any(ord(c) > 0xFFFF for c in text):
        u16 = lambda o: len(text[:o].encode("utf-16-le")) // 2
        out = [[r[0]] + [u16(o) for o in r[1:]] for r in out]
    return out


async def run():
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    print(f"{len(corpus)} pagina's verrijken met opsommingen", flush=True)
    headers = {"User-Agent": "VoorlichterBot/1.0 (testomgeving; contact via klantcontactcentrum)"}
    sem = asyncio.Semaphore(CONCURRENCY)
    done = failed = 0
    stats = {"lijsten": 0, "weg": 0}

    async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
        async def one(entry: dict):
            nonlocal done, failed
            async with sem:
                for attempt in range(2):
                    try:
                        r = await client.get(entry["url"], timeout=25)
                        r.raise_for_status()
                        gevonden = lists_of(r.text)
                        entry["lists"] = locate(entry.get("text", ""), gevonden)
                        stats["lijsten"] += len(entry["lists"])
                        stats["weg"] += len(gevonden) - len(entry["lists"])
                        break
                    except Exception:
                        if attempt == 1:
                            failed += 1
                            entry.pop("lists", None)
                        await asyncio.sleep(0.5)
                done += 1
                if done % 200 == 0:
                    print(f"  {done}/{len(corpus)} (mislukt: {failed})", flush=True)

        await asyncio.gather(*(one(e) for e in corpus))

    CORPUS.write_text(json.dumps(corpus, ensure_ascii=False), encoding="utf-8")
    print(f"KLAAR: {stats['lijsten']} opsommingen gevonden, {stats['weg']} niet terug te vinden "
          f"in de opgeslagen tekst, {failed} pagina's mislukt", flush=True)


if __name__ == "__main__":
    asyncio.run(run())
    sys.exit(0)
