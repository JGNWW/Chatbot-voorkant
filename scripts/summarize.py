"""(Optioneel) Genereer AI-samenvattingen voor alle gecrawlde pagina's.

De zoek-index gebruikt standaard de meta-omschrijving (`desc`) van elke pagina.
Dit script voegt een rijkere, AI-gegenereerde `summary` toe die beschrijft
*welke vragen* een pagina beantwoordt — dat verbetert de zoekrelevantie verder.

Gebruik (kies één provider via omgevingsvariabele):

    GEMINI_API_KEY=...   python scripts/summarize.py     # gratis tier
    OPENAI_API_KEY=...   python scripts/summarize.py
    ANTHROPIC_API_KEY=... python scripts/summarize.py

Het script is hervatbaar: pagina's die al een `summary` hebben, worden
overgeslagen. Voortgang wordt regelmatig weggeschreven.

Let op: de gratis Gemini-tier kent een laag aantal verzoeken per minuut, dus
het samenvatten van alle ~4400 pagina's kan lang duren. Het script respecteert
een instelbare snelheid (REQUESTS_PER_MINUTE).
"""
import asyncio
import json
import os
import time
from pathlib import Path

import httpx

CORPUS = Path(__file__).resolve().parent.parent / "docs" / "data" / "corpus.json"
SAVE_EVERY = 25
REQUESTS_PER_MINUTE = int(os.environ.get("REQUESTS_PER_MINUTE", "12"))

PROMPT = (
    "Vat in maximaal 2 zinnen samen welke concrete vragen deze pagina van "
    "NederlandWereldwijd beantwoordt. Noem de belangrijkste onderwerpen en "
    "trefwoorden. Schrijf in het Nederlands, zonder inleiding."
)


def pick_provider():
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini", os.environ["GEMINI_API_KEY"]
    if os.environ.get("OPENAI_API_KEY"):
        return "openai", os.environ["OPENAI_API_KEY"]
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic", os.environ["ANTHROPIC_API_KEY"]
    raise SystemExit("Geen API-sleutel gevonden. Zet GEMINI_API_KEY, OPENAI_API_KEY of ANTHROPIC_API_KEY.")


async def summarize(client, provider, key, title, text) -> str:
    content = f"Titel: {title}\n\nPaginatekst:\n{text[:4000]}"
    if provider == "gemini":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"
        body = {
            "systemInstruction": {"parts": [{"text": PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": content}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 200},
        }
        r = await client.post(url, json=body, timeout=60)
        r.raise_for_status()
        d = r.json()
        return "".join(p.get("text", "") for p in d["candidates"][0]["content"]["parts"]).strip()
    if provider == "openai":
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"authorization": f"Bearer {key}"},
            json={"model": "gpt-4o-mini", "temperature": 0, "max_tokens": 200,
                  "messages": [{"role": "system", "content": PROMPT}, {"role": "user", "content": content}]},
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()
    # anthropic
    r = await client.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        json={"model": "claude-haiku-4-5-20251001", "max_tokens": 200,
              "system": PROMPT, "messages": [{"role": "user", "content": content}]},
        timeout=60,
    )
    r.raise_for_status()
    return "".join(c.get("text", "") for c in r.json()["content"]).strip()


async def main():
    provider, key = pick_provider()
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    todo = [p for p in corpus if not p.get("summary")]
    print(f"Provider: {provider} | te doen: {len(todo)}/{len(corpus)} | snelheid: {REQUESTS_PER_MINUTE}/min", flush=True)

    delay = 60.0 / max(REQUESTS_PER_MINUTE, 1)
    done = 0
    async with httpx.AsyncClient() as client:
        for page in todo:
            try:
                page["summary"] = await summarize(client, provider, key, page["title"], page["text"])
            except Exception as exc:  # noqa: BLE001
                print(f"  fout bij {page['url']}: {exc}", flush=True)
            done += 1
            if done % SAVE_EVERY == 0:
                CORPUS.write_text(json.dumps(corpus, ensure_ascii=False), encoding="utf-8")
                print(f"  {done}/{len(todo)} (tussentijds opgeslagen)", flush=True)
            await asyncio.sleep(delay)

    CORPUS.write_text(json.dumps(corpus, ensure_ascii=False), encoding="utf-8")
    print(f"KLAAR: {done} samenvattingen toegevoegd -> {CORPUS}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
