"""Aanroepen van Claude voor (1) paginaselectie en (2) letterlijk antwoord.

De prompts dwingen af dat er niets verzonnen wordt: het antwoord moet een
*letterlijk* fragment uit de opgehaalde paginatekst zijn. De backend verifieert
dat daarna nog eens als extra waarborg.
"""
import json
import re

from anthropic import AsyncAnthropic

from .config import settings
from .sitemap import Page

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY ontbreekt. Vul deze in je .env in.")
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def _extract_json(text: str) -> dict:
    """Haalt het eerste JSON-object uit de modeloutput."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"Geen JSON in modelantwoord: {text[:200]}")
    return json.loads(match.group(0))


SELECTION_SYSTEM = (
    "Je helpt een voorlichter van het klantcontactcentrum van NederlandWereldwijd. "
    "Je krijgt de vraag van de voorlichter en een genummerde lijst met kandidaat-"
    "pagina's van NederlandWereldwijd.nl. Kies de pagina die het antwoord het best "
    "bevat. Antwoord UITSLUITEND met JSON in dit formaat: "
    '{"restated_question": "<de vraag kort en helder geherformuleerd>", '
    '"primary_index": <nummer van de beste pagina, of null als geen enkele past>, '
    '"related_indices": [<nummers van maximaal 3 andere relevante pagina\'s>]}'
)

ANSWER_SYSTEM = (
    "Je helpt een voorlichter van het klantcontactcentrum van NederlandWereldwijd. "
    "Je krijgt de vraag en de LETTERLIJKE tekst van één pagina van "
    "NederlandWereldwijd.nl. Neem het relevante gedeelte LETTERLIJK over uit die "
    "tekst — verzin niets, parafraseer niet en voeg niets toe. Citeer aaneengesloten "
    "passages exact zoals ze in de tekst staan. Als de tekst het antwoord niet bevat, "
    "zet dan found=false. Antwoord UITSLUITEND met JSON: "
    '{"answer": "<het letterlijk overgenomen relevante fragment>", '
    '"found": <true|false>, "note": "<korte toelichting of leeg>"}'
)


async def select_pages(question: str, candidates: list[Page]) -> dict:
    """Laat Claude de beste pagina + verwante pagina's kiezen."""
    listing = "\n".join(f"[{i}] {p.title} — {p.url}" for i, p in enumerate(candidates))
    msg = await _get_client().messages.create(
        model=settings.selection_model,
        max_tokens=400,
        system=SELECTION_SYSTEM,
        messages=[{
            "role": "user",
            "content": f"Vraag van de voorlichter:\n{question}\n\nKandidaat-pagina's:\n{listing}",
        }],
    )
    return _extract_json(msg.content[0].text)


async def extract_answer(question: str, page_text: str) -> dict:
    """Laat Claude het letterlijke relevante fragment uit de paginatekst halen."""
    # Begrens de hoeveelheid tekst die we meesturen.
    snippet = page_text[:12000]
    msg = await _get_client().messages.create(
        model=settings.answer_model,
        max_tokens=1200,
        system=ANSWER_SYSTEM,
        messages=[{
            "role": "user",
            "content": f"Vraag:\n{question}\n\nPaginatekst:\n\"\"\"\n{snippet}\n\"\"\"",
        }],
    )
    return _extract_json(msg.content[0].text)
