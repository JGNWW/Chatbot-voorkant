#!/usr/bin/env python3
"""Verwijder terugkerende footer-blokken ('Contact' en 'Ook nuttig') uit het corpus.

Deze blokken staan op bijna elke pagina van NederlandWereldwijd en horen niet bij
de inhoudelijke tekst. We halen ze weg uit zowel de paginatekst (viewer) als de
headings-lijst, zodat ze ook niet meer meetellen in het trefwoord-zoeken (dat uit
het corpus wordt opgebouwd).

Een blok = de kop-regel ('Contact' of 'Ook nuttig', niveau 2) plus alle regels
daarna tot de volgende kop of het einde van de pagina.
"""
import json, sys, os

REMOVE = {"Contact", "Ook nuttig"}
CORPUS = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "corpus.json")


def clean_record(rec):
    headings = rec.get("headings") or []
    # kop-tekst -> niveau (eerste voorkomen)
    htext = {}
    for lvl, t in headings:
        htext.setdefault(t, lvl)
    lines = rec.get("text", "").split("\n")

    def is_heading(line):
        return line in htext

    out, i, removed = [], 0, False
    while i < len(lines):
        line = lines[i]
        if line in REMOVE and htext.get(line) == 2:
            # sla de kop + alle volgende regels over tot de volgende kop/einde
            i += 1
            while i < len(lines) and not is_heading(lines[i]):
                i += 1
            removed = True
            continue
        out.append(line)
        i += 1

    rec["text"] = "\n".join(out).strip("\n")
    rec["headings"] = [[lvl, t] for lvl, t in headings if not (t in REMOVE and lvl == 2)]
    return removed


def main():
    with open(CORPUS, encoding="utf-8") as f:
        data = json.load(f)
    before = sum(len(r.get("text", "")) for r in data)
    n_changed = sum(1 for r in data if clean_record(r))
    after = sum(len(r.get("text", "")) for r in data)
    empty = sum(1 for r in data if not r.get("text", "").strip())
    with open(CORPUS, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"records: {len(data)}, opgeschoond: {n_changed}")
    print(f"tekens: {before:,} -> {after:,} (-{before-after:,})")
    print(f"lege records na opschonen: {empty}")


if __name__ == "__main__":
    main()
