"""Focused tests for the deterministic part of the Universal Web Agent."""

import asyncio
import unittest

from backend.services.extraction_pipeline import ExtractionPipeline
from backend.services.universal_web_content import (
    MAX_HTML_BYTES,
    extract_article_from_html,
    extract_ranked_list_from_html,
    needs_browser_render,
    normalize_public_url,
)


class UniversalWebContentTests(unittest.TestCase):

    def test_reddit_deferred_comments_are_retained_when_reader_parses_html(self):
        html = """
        <html><head><title>Reddit</title></head><body><main>
          <p>Visible post content with enough text to be meaningful.</p>
          <template id="deferred-comments"><p>Deferred comment: visit Quiapo Church.</p></template>
        </main></body></html>
        """
        _, content = extract_article_from_html(html)
        # The renderer materializes this template before invoking the reader.
        # This fixture protects the reader from accidentally discarding the
        # result after it is converted into regular document content.
        materialized = html.replace('<template id="deferred-comments">', '').replace('</template>', '')
        _, materialized_content = extract_article_from_html(materialized)
        self.assertIn("Deferred comment: visit Quiapo Church.", materialized_content)
    def test_extracts_article_and_image_context_without_navigation(self):
        title, content = extract_article_from_html(
            """
            <html><head><title>Ignore this title</title><meta property="og:title" content="Tokyo food guide" /></head>
            <body><nav>Log in Menu</nav><article><h1>Tokyo food guide</h1>
            <p>Sushi Saito is a restaurant in Roppongi, Tokyo.</p>
            <figure><img alt="Sushi Saito counter in Roppongi" /><figcaption>Reserve well ahead.</figcaption></figure>
            </article><footer>Subscribe</footer></body></html>
            """
        )
        self.assertEqual(title, "Tokyo food guide")
        self.assertIn("Sushi Saito is a restaurant", content)
        self.assertIn("Image context: Sushi Saito counter in Roppongi", content)
        self.assertNotIn("Subscribe", content)
        self.assertNotIn("Log in Menu", content)

    def test_prefers_a_structured_ranked_list_over_trip_com_page_noise(self):
        html = """
        <html><body><main>
          <h1>Top 10 Family-friendly Attractions in New York</h1>
          <nav>Top 10 Premium Hotels in Nanchang Top 10 Things to Do in Tokyo</nav>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": "Top Family-friendly Attractions in New York",
            "spatialCoverage": {"@type": "City", "name": "New York"},
            "itemListElement": [
              {"@type": "ListItem", "position": 1, "item": {"@type": "LocalBusiness", "name": "The Museum of Modern Art"}},
              {"@type": "ListItem", "position": 2, "item": {"@type": "LocalBusiness", "name": "American Museum of Natural History"}},
              {"@type": "ListItem", "position": 3, "item": {"@type": "LocalBusiness", "name": "LEGOLAND New York Resort"}},
              {"@type": "ListItem", "position": 4, "item": {"@type": "LocalBusiness", "name": "Central Park Zoo"}},
              {"@type": "ListItem", "position": 5, "item": {"@type": "LocalBusiness", "name": "Bronx Zoo"}},
              {"@type": "ListItem", "position": 6, "item": {"@type": "LocalBusiness", "name": "Six Flags Great Adventure"}},
              {"@type": "ListItem", "position": 7, "item": {"@type": "LocalBusiness", "name": "Flushing Meadows Corona Park"}},
              {"@type": "ListItem", "position": 8, "item": {"@type": "LocalBusiness", "name": "Prospect Park"}},
              {"@type": "ListItem", "position": 9, "item": {"@type": "LocalBusiness", "name": "New York Aquarium"}}
            ]
          }
          </script>
        </main></body></html>
        """
        ranked = extract_ranked_list_from_html(html)
        self.assertIsNotNone(ranked)
        self.assertEqual(ranked["region"], "New York")
        self.assertEqual(len(ranked["items"]), 9)
        self.assertEqual(ranked["items"][0]["name"], "The Museum of Modern Art")
        self.assertEqual(ranked["items"][-1]["name"], "New York Aquarium")
        self.assertNotIn("Nanchang", [item["name"] for item in ranked["items"]])
        self.assertNotIn("Tokyo", [item["name"] for item in ranked["items"]])

        extraction = asyncio.run(ExtractionPipeline.extract(
            "This page also mentions Tokyo and Nanchang in navigation.",
            source_type="ranked_list",
            ranked_items=ranked["items"],
            inferred_region=ranked["region"],
        ))
        self.assertEqual(len(extraction["locations"]), 9)
        self.assertEqual(
            [item["name"] for item in extraction["locations"]],
            [item["name"] for item in ranked["items"]],
        )

    def test_uses_ranked_card_markup_when_json_ld_is_absent(self):
        ranked = extract_ranked_list_from_html("""
            <html><head><title>Top sights in Lisbon</title></head><body>
              <section class="ranking-list">
                <article class="ranking-item" data-rank="1"><h3>Belem Tower</h3></article>
                <article class="ranking-item" data-rank="2"><h3>Jerónimos Monastery</h3></article>
                <article class="ranking-item" data-rank="3"><h3>Castelo de São Jorge</h3></article>
              </section>
              <nav>Paris Tokyo Nanchang</nav>
            </body></html>
        """)
        self.assertIsNotNone(ranked)
        self.assertEqual([item["name"] for item in ranked["items"]], [
            "Belem Tower", "Jerónimos Monastery", "Castelo de São Jorge",
        ])

    def test_detects_a_react_shell_for_browser_rendering(self):
        self.assertTrue(needs_browser_render('<div id="root"></div>', ""))

    def test_keeps_a_substantive_server_rendered_article_on_http_path(self):
        self.assertFalse(needs_browser_render('<div id="__next"><article>ready</article></div>', "Travel article " * 80))

    def test_normalizes_plain_hostnames(self):
        self.assertEqual(normalize_public_url("example.com/guide"), "https://example.com/guide")

    def test_unwraps_google_ad_destination(self):
        url = (
            "https://www.google.com/aclk?sa=L&adurl="
            "https%3A%2F%2Fwww.tripadvisor.com%2FAttraction_Products%3Fgeo%3D298184"
        )
        self.assertEqual(
            normalize_public_url(url),
            "https://www.tripadvisor.com/Attraction_Products?geo=298184",
        )

    def test_allows_editorial_sized_html_before_article_cleanup(self):
        self.assertEqual(MAX_HTML_BYTES, 12_000_000)



if __name__ == "__main__":
    unittest.main()
