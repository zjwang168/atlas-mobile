"""Focused tests for the deterministic part of the Universal Web Agent."""

import unittest

from backend.services.universal_web_content import (
    MAX_HTML_BYTES,
    extract_article_from_html,
    needs_browser_render,
    normalize_public_url,
)


class UniversalWebContentTests(unittest.TestCase):
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
