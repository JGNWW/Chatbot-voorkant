"""Live ophalen van een pagina en de hoofdtekst extraheren."""
import httpx
from bs4 import BeautifulSoup


async def fetch_page_text(url: str) -> tuple[str, str]:
    """Haalt een pagina op en geeft (titel, hoofdtekst) terug.

    De tekst komt uit het <main>-element (de inhoudelijke kern van de pagina),
    met navigatie, scripts en dergelijke verwijderd.
    """
    async with httpx.AsyncClient(headers={"User-Agent": "VoorlichterBot/1.0"}) as client:
        resp = await client.get(url, timeout=30, follow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

    title = soup.title.get_text(strip=True) if soup.title else url

    for tag in soup(["script", "style", "noscript", "nav", "header", "footer"]):
        tag.decompose()

    main = soup.find("main") or soup.find("article") or soup.body
    text = main.get_text(separator="\n", strip=True) if main else ""

    # Comprimeer overtollige witruimte tot enkele regeleinden.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return title, "\n".join(lines)
