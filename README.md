# Voorlichter-chatbot — NederlandWereldwijd

Een AI-assistent voor voorlichters van het klantcontactcentrum van
NederlandWereldwijd. De voorlichter stelt een vraag; de assistent zoekt de
juiste pagina op **NederlandWereldwijd.nl**, neemt het relevante gedeelte
**letterlijk** over en toont daaronder de bronvermelding en andere relevante
bronnen.

## Hoe het werkt

Per vraag doorloopt de backend deze stappen:

1. **Vinden** — De sitemap van NederlandWereldwijd.nl (ruim 4400 pagina's) wordt
   gecachet. De vraag wordt op trefwoorden gematcht tegen de pagina-slugs om een
   handvol kandidaten te selecteren. (De zoekfunctie van de site zelf draait
   client-side en is niet server-side bruikbaar; de sitemap wel.)
2. **Kiezen** — Claude kiest uit de kandidaten de beste pagina + maximaal 3
   verwante bronnen, en herformuleert de vraag kort.
3. **Live ophalen** — De gekozen pagina wordt op dat moment opgehaald en de
   hoofdtekst (`<main>`) wordt geëxtraheerd.
4. **Letterlijk overnemen** — Claude neemt het relevante fragment **letterlijk**
   over uit de paginatekst (geen parafrase, niets verzonnen).
5. **Verifiëren** — De backend controleert dat het citaat daadwerkelijk in de
   opgehaalde tekst voorkomt. Lukt dat niet, dan wordt het antwoord gemarkeerd
   als "niet geverifieerd".

```
Voorlichter ──► Frontend (React) ──► Backend (FastAPI)
                                        │
                          ┌─────────────┼─────────────┐
                          ▼             ▼             ▼
                       Sitemap     Claude API    NederlandWereldwijd.nl
                      (kandidaten) (kies+citeer)   (live pagina)
```

## Projectstructuur

```
backend/          FastAPI-backend (RAG-pipeline + Claude)
  app/
    main.py         API-endpoints (/api/ask, /api/health)
    sitemap.py      Sitemap ophalen & cachen
    retrieval.py    Trefwoord-ranking van kandidaat-pagina's
    fetcher.py      Live pagina ophalen + tekst-extractie
    claude_client.py  Claude-aanroepen (selectie + letterlijk antwoord)
    models.py       API-schema's
    config.py       Instellingen (.env)
frontend/         React + Vite + TypeScript chat-UI
```

## Aan de slag

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # vul je ANTHROPIC_API_KEY in
uvicorn app.main:app --reload
```

De backend draait op `http://localhost:8000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

De frontend draait op `http://localhost:5173` en stuurt `/api`-verzoeken door
naar de backend.

## Configuratie (`.env`)

| Variabele | Omschrijving | Standaard |
|---|---|---|
| `ANTHROPIC_API_KEY` | Je Anthropic API-sleutel (verplicht) | — |
| `SELECTION_MODEL` | Model voor paginaselectie | `claude-haiku-4-5-20251001` |
| `ANSWER_MODEL` | Model voor letterlijk antwoord | `claude-sonnet-4-6` |
| `SITEMAP_URL` | Sitemap met alle pagina's | NederlandWereldwijd-sitemap |
| `SITEMAP_TTL_SECONDS` | Cache-duur sitemap | `86400` (1 dag) |
| `CORS_ORIGINS` | Toegestane frontend-origins | `http://localhost:5173` |

## Meten: zoekt hij goed, en komt er ook echt een antwoord uit?

Twee harnassen, en ze meten verschillende dingen:

```bash
node scripts/eval.mjs --no-sem              # welke PAGINA vindt de zoeker? (recall@6, MRR)
node scripts/antwoord_eval.mjs --no-sem     # komt er op een standaardvraag een ANTWOORD uit?
node scripts/antwoord_eval.mjs              # idem, mét het semantische model erbij
```

`antwoord_eval.mjs` loopt per standaardvraag de hele keten na die zonder
API-sleutel te meten is: staat de juiste pagina in de top 6, levert de
citaatlogica daar een citaat uit op, staat het antwoord (het bedrag, de termijn)
daar letterlijk in, en is het citaat leesbaar en compleet. De vragenlijst staat
in `scripts/standaardvragen.json`: ruim honderd vragen die de site zelf als
standaardvraag voert, met per vraag het stukje tekst dat in het antwoord hoort te
staan. Staat dat stukje niet letterlijk op de opgegeven pagina, dan faalt de test
op zichzelf — zo kan de meetlat niet stilletjes verschuiven.

Waarom apart van `eval.mjs`: de zoeker kan de juiste pagina op plek 1 zetten en
de voorlichter tóch "Wij hebben geen informatie over dit onderwerp" geven. Dat
gebeurde bij elke vraag waarvan het antwoord in een TABEL staat — "wat kost een
paspoort?" voorop. Een zoek-eval ziet dat niet; deze wel.

## Hoe een citaat op het scherm komt

Een citaat is altijd letterlijke brontekst, maar de VORM komt terug: alinea's blijven alinea's,
opsommingen worden opsommingen en tabellen worden tabellen. Dat is nodig omdat de crawler een
tabel als losse regels aanlevert — "Document", "Kosten", "Paspoort 18 jaar en ouder",
"€ 169,15" — en zo onder elkaar moet de voorlichter aan de telefoon zelf uitzoeken welk bedrag
bij welk document hoort.

`citaatBlokken()` in `docs/index.html` bepaalt die opbouw, en alle plekken gebruiken dezelfde:
het citaatblok in het antwoord, de hover-kaart onder de bron, het gearceerde citaat in de
bronviewer, en de tekst die op het klembord belandt (daar wordt een tabelrij
"omschrijving: waarde"). Een tabel wordt alleen als tabel getoond als de tweede kolom
consequent waarden bevat (bedragen, periodes, iets tussen haakjes) en de eerste niet; anders
blijft het een opsomming, want twee kolommen suggereren een verband dat er dan niet is.

```bash
node scripts/opmaak_proef.mjs [uitvoermap]   # schermafdrukken van citaat + bronviewer
```

Die beeldproef hoort bij deze regels: "onoverzichtelijk" is geen assertie, daar moet je naar
kijken. `scripts/quote_test.mjs` bewaakt de regels zelf (tabel of opsomming, bolletjes,
kolomkoppen, platte tekst).

## Aandachtspunten / vervolg

- De trefwoord-ranking is een eenvoudige eerste stap. Voor betere relevantie kan
  later een embedding-/vectorzoekmechanisme worden toegevoegd.
- Antwoorden worden geverifieerd als letterlijk citaat; markeer onbevestigde
  antwoorden duidelijk richting de voorlichter.
- Houd rekening met de gebruiksvoorwaarden van NederlandWereldwijd.nl bij het
  live ophalen van pagina's.
