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

## Aandachtspunten / vervolg

- De trefwoord-ranking is een eenvoudige eerste stap. Voor betere relevantie kan
  later een embedding-/vectorzoekmechanisme worden toegevoegd.
- Antwoorden worden geverifieerd als letterlijk citaat; markeer onbevestigde
  antwoorden duidelijk richting de voorlichter.
- Houd rekening met de gebruiksvoorwaarden van NederlandWereldwijd.nl bij het
  live ophalen van pagina's.
