"""Pydantic-schema's voor de API."""
from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str = Field(..., min_length=2, description="Vraag van de voorlichter.")


class Source(BaseModel):
    title: str
    url: str


class AskResponse(BaseModel):
    # De vraag zoals de AI hem heeft begrepen / herhaalt.
    restated_question: str
    # Het letterlijk overgenomen relevante fragment van de bronpagina.
    answer: str
    # True als het citaat letterlijk in de opgehaalde paginatekst is teruggevonden.
    verified: bool
    # De primaire bron waaruit het antwoord komt.
    source: Source | None = None
    # Andere relevante bronnen.
    related_sources: list[Source] = []
    # Optionele toelichting (bijv. wanneer er geen passend antwoord is gevonden).
    note: str | None = None
