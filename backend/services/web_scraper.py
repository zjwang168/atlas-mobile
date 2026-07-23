"""Multi-source web scraper supporting Reddit, generic web pages, and more."""

from backend.services.web_fetch_chain import scrape_with_chain


class WebScraper:
    """Scrapes content from various web sources."""

    @staticmethod
    async def scrape(url: str) -> dict:
        return await scrape_with_chain(url)
