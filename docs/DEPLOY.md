# Testomgeving hosten op GitHub Pages

Deze map (`docs/`) is een **volledig client-side** testomgeving over de hele
NederlandWereldwijd-site. Geen server nodig.

- `index.html` — de app (UI + zoeklogica + AI-aanroep in de browser)
- `data/corpus.json` — de gecrawlde tekst van alle pagina's
- `.nojekyll` — voorkomt Jekyll-verwerking door GitHub Pages

## Publiceren (eenmalige instelling)

1. Ga in GitHub naar **Settings → Pages**.
2. Bij **Build and deployment → Source**: kies **Deploy from a branch**.
3. Kies branch `claude/pensive-lamport-IfOUT` (of `main` na mergen) en map **`/docs`**.
4. Klik **Save**. Na ~1 minuut staat de site op:
   `https://jgnww.github.io/chatbot-voorkant/`

## Semantisch zoeken (embeddings)

De zoekmachine werkt op **betekenis** in plaats van losse trefwoorden:

- Per pagina is er een vooraf berekende vector (`docs/data/embeddings.bin`,
  int8, ~1,7 MB) van titel + samenvatting, met het model
  `Xenova/multilingual-e5-small`.
- In de browser wordt datzelfde model (via transformers.js, ~eenmalige download)
  geladen om de **vraag** te embedden; daarna kiest cosine-similariteit de best
  passende pagina's.
- Lukt het model niet te laden, dan valt de app terug op trefwoord-zoeken. De
  status staat bovenin ("semantisch zoeken ✓" of "trefwoord-zoeken").

Embeddings (her)genereren na een nieuwe crawl:

```bash
cd /tmp && mkdir embgen && cd embgen && npm init -y && npm i @huggingface/transformers@3
cp <repo>/scripts/embed.mjs . && node embed.mjs   # schrijft docs/data/embeddings.bin + .json
```

## Hoe het antwoord wordt opgebouwd

1. **Semantisch zoeken** — de vraag wordt vergeleken met de paginavectoren
   (zie hierboven); de best passende pagina's gaan door naar het model.
2. **Volledige pagina's laden** — de best passende pagina's (hun volledige
   tekst zit al in `corpus.json`) gaan naar het AI-model.
3. **Antwoord samenstellen** — het model levert:
   - een korte **natuurlijke inleidende zin** die de vraag herpakt
     ("U vraagt een ID-kaart aan door:");
   - één of meer **letterlijke citaten** uit de pagina('s) — exact overgenomen,
     niets verzonnen, eventueel uit meerdere bronnen gecombineerd.
4. **Verificatie** — elk citaat wordt gecontroleerd: staat het letterlijk op de
   bronpagina? Zo niet, dan oranje gemarkeerd.
5. **Onder het antwoord**: *Lees meer — gebruikte bronnen* en *Misschien ook
   relevant*.

## Gebruiken

- De site laadt eerst de corpus (eenmalig, daarna gecachet).
- **Provider/model** kies je bovenin. **Google Gemini** is gratis (sleutel via
  Google AI Studio). OpenAI en Anthropic kunnen ook.
- **Demo-modus** (zonder sleutel): toont alleen het begin van de best-matchende
  pagina, zonder AI-inleiding of geselecteerde citaten.

## (Optioneel) AI-samenvattingen genereren

De zoekrelevantie kan verder omhoog met AI-samenvattingen per pagina:

```bash
GEMINI_API_KEY=...  python scripts/summarize.py    # gratis tier (langzaam)
```

Dit voegt een `summary`-veld toe aan `corpus.json`. De frontend gebruikt die
automatisch zodra hij aanwezig is. Zonder dit script wordt de meta-omschrijving
gebruikt — die werkt ook prima.

## Let op

- De API-sleutel staat in de browser (`localStorage`). Prima voor een besloten
  test, **niet** voor productie — gebruik daarvoor de server-side backend
  (`backend/`), waar de sleutel veilig blijft.
- De corpus is een momentopname van de crawl. Voer `scripts/crawl.py` opnieuw uit
  om hem te verversen.
