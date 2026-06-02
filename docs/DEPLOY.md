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

## Gebruiken

- De site laadt eerst de corpus (eenmalig, daarna gecachet).
- **Demo-modus** (zonder sleutel): toont het begin van de best-matchende pagina.
- **AI-modus**: plak je `ANTHROPIC_API_KEY` in de balk bovenin. De browser roept
  dan Claude rechtstreeks aan; die kiest de juiste pagina en neemt het relevante
  fragment **letterlijk** over, met bronvermelding en verwante bronnen.

## Let op

- De API-sleutel staat in de browser (`localStorage`). Prima voor een besloten
  test, **niet** voor productie — gebruik daarvoor de server-side backend
  (`backend/`), waar de sleutel veilig blijft.
- De corpus is een momentopname van de crawl. Voer `scripts/crawl.py` opnieuw uit
  om hem te verversen.
