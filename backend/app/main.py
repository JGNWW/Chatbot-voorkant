"""FastAPI-backend voor de voorlichter-chatbot.

Flow per vraag:
  1. Sitemap (gecachet) -> trefwoord-ranking van kandidaat-pagina's.
  2. Claude kiest de beste pagina + verwante bronnen, herhaalt de vraag.
  3. De gekozen pagina wordt live opgehaald en de hoofdtekst geëxtraheerd.
  4. Claude neemt het relevante fragment LETTERLIJK over.
  5. De backend verifieert dat het citaat echt in de paginatekst staat.
"""
import re

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import claude_client, retrieval, sitemap
from .config import settings
from .fetcher import fetch_page_text
from .models import AskRequest, AskResponse, Source
from .sitemap import Page

app = FastAPI(title="Voorlichter Chatbot — NederlandWereldwijd")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _is_verbatim(answer: str, page_text: str) -> bool:
    """Controleert of het citaat (witruimte-genormaliseerd) in de pagina voorkomt."""
    a = _normalize(answer)
    return len(a) > 0 and a in _normalize(page_text)


@app.get("/api/health")
async def health() -> dict:
    pages = await sitemap.get_pages()
    return {"status": "ok", "indexed_pages": len(pages)}


@app.post("/api/ask", response_model=AskResponse)
async def ask(req: AskRequest) -> AskResponse:
    question = req.question.strip()

    # 1. Kandidaten uit de sitemap.
    pages = await sitemap.get_pages()
    candidates = retrieval.rank_pages(question, pages)
    if not candidates:
        return AskResponse(
            restated_question=question,
            answer="",
            verified=False,
            note="Geen passende pagina gevonden op NederlandWereldwijd.nl voor deze vraag.",
        )

    # 2. Claude kiest de beste pagina.
    try:
        selection = await claude_client.select_pages(question, candidates)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Selectiestap mislukt: {exc}") from exc

    restated = selection.get("restated_question") or question
    primary_index = selection.get("primary_index")
    related_indices = selection.get("related_indices") or []

    def _page(i) -> Page | None:
        return candidates[i] if isinstance(i, int) and 0 <= i < len(candidates) else None

    related = [
        Source(title=p.title, url=p.url)
        for i in related_indices
        if (p := _page(i)) is not None
    ]

    primary = _page(primary_index)
    if primary is None:
        return AskResponse(
            restated_question=restated,
            answer="",
            verified=False,
            related_sources=related,
            note="Geen enkele pagina bevat een passend antwoord op deze vraag.",
        )

    # 3. Live ophalen + tekst extraheren.
    try:
        page_title, page_text = await fetch_page_text(primary.url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Pagina ophalen mislukt: {exc}") from exc

    # 4. Letterlijk antwoord overnemen.
    try:
        result = await claude_client.extract_answer(question, page_text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Antwoordstap mislukt: {exc}") from exc

    answer = (result.get("answer") or "").strip()
    found = bool(result.get("found")) and bool(answer)

    if not found:
        return AskResponse(
            restated_question=restated,
            answer="",
            verified=False,
            source=Source(title=page_title, url=primary.url),
            related_sources=related,
            note=result.get("note") or "Op deze pagina staat geen letterlijk antwoord op de vraag.",
        )

    # 5. Verifieer dat het citaat echt op de pagina staat.
    verified = _is_verbatim(answer, page_text)
    note = None if verified else (
        "Let op: dit fragment kon niet letterlijk worden teruggevonden op de bronpagina. "
        "Controleer de bron zelf."
    )

    return AskResponse(
        restated_question=restated,
        answer=answer,
        verified=verified,
        source=Source(title=page_title, url=primary.url),
        related_sources=related,
        note=note,
    )
