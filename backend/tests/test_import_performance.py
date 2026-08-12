"""Regression tests for import-path fast paths that avoid redundant I/O."""

import unittest
from unittest.mock import AsyncMock, patch

from backend.services.content_classifier import classify_location_content
from backend.services.performance_logger import PipelineMetrics
from backend.services.smart_text_service import analyze_smart_text
from backend.services.translation import needs_english_translation
from backend.services.youtube_places_service import _build_geocode_queries, _matches_inferred_region
from backend.services.reddit_fetcher import _extract_comments
from backend.services.web_scraper import _is_usable_reddit_post
from backend.services.agent_orchestrator import _matches_inferred_region


class ImportPerformanceTests(unittest.IsolatedAsyncioTestCase):
    def test_pipeline_metrics_split_fetch_parse_geocode_and_photos(self):
        metrics = PipelineMetrics(
            t_request=10.0,
            t_fetch_done=14.0,
            t_parse_done=21.0,
            t_geocode_done=35.0,
            t_photo_done=39.0,
            t_response=40.0,
        )
        self.assertEqual(metrics.fetch_duration_s, 4.0)
        self.assertEqual(metrics.parse_duration_s, 7.0)
        self.assertEqual(metrics.geocode_duration_s, 14.0)
        self.assertEqual(metrics.photo_duration_s, 4.0)

    def test_translation_only_runs_for_non_latin_scripts(self):
        self.assertFalse(needs_english_translation("A weekend in Paris: Louvre Museum and Canal Saint-Martin."))
        self.assertFalse(needs_english_translation("https://example.com/paris-guide?day=2"))
        self.assertTrue(needs_english_translation("北京三日游，推荐故宫和天坛。"))
        self.assertTrue(needs_english_translation("東京で食べるべき寿司店"))

    async def test_named_poi_content_skips_classifier_llm(self):
        mode = await classify_location_content("Visit the Louvre Museum, Eiffel Tower, and Le Marais in Paris.")
        self.assertEqual(mode, "named_poi")

    async def test_pasted_text_skips_web_search_unless_explicitly_requested(self):
        extracted = {
            "title": "Paris weekend",
            "inferred_region": "Paris, France",
            "places": [{"name": "Louvre Museum", "context": "Paris, France", "address": None}],
            "removed_noise": [],
            "removed_hierarchy": [],
        }
        geocoded = [{
            "name": "Louvre Museum",
            "latitude": 48.8606,
            "longitude": 2.3376,
            "full_address": "Rue de Rivoli, Paris, France",
            "is_exact": True,
            "confidence": 0.9,
        }]
        with patch("backend.services.smart_text_service._run_tavily_web_research", new=AsyncMock()) as research, \
             patch("backend.services.smart_text_service._extract_places_from_text", new=AsyncMock(return_value=extracted)) as extract, \
             patch("backend.services.smart_text_service._geocode_places", new=AsyncMock(return_value=geocoded)):
            result = await analyze_smart_text("Visit the Louvre Museum in Paris.", use_web_search=False)

        research.assert_not_awaited()
        extract.assert_awaited_once()
        self.assertEqual(result["locations"][0]["name"], "Louvre Museum")

    def test_youtube_geocoding_uses_context_and_rejects_wrong_city(self):
        queries = _build_geocode_queries(
            [{"name": "Verde", "context": "Philadelphia"}], "Philadelphia"
        )
        self.assertEqual(queries, [{"query": "Verde, Philadelphia", "name": "Verde"}])
        self.assertTrue(_matches_inferred_region(
            {"full_address": "Dilworth Park, Philadelphia, PA, United States"}, "Philadelphia"
        ))
        self.assertFalse(_matches_inferred_region(
            {"full_address": "500 Pearl Street, New York, NY, United States"}, "Philadelphia"
        ))
        self.assertFalse(_matches_inferred_region(
            {"full_address": "Verde, Batangas City, Philippines"}, "Philadelphia"
        ))

    def test_reddit_comment_collection_keeps_all_nested_comments(self):
        comments = [
            {"data": {"body": f"Useful travel recommendation {index}", "replies": ""}}
            for index in range(150)
        ]
        comments[0]["data"]["replies"] = {
            "data": {"children": [{"data": {"body": "Nested place recommendation", "replies": ""}}]}
        }
        extracted = _extract_comments(comments)
        self.assertEqual(len(extracted), 151)
        self.assertIn("Nested place recommendation", extracted)

    def test_reddit_legacy_login_page_cannot_win_fallback_race(self):
        self.assertFalse(_is_usable_reddit_post({"title": "Reddit - Log In", "selftext": "Sign in"}))
        self.assertFalse(_is_usable_reddit_post({"title": "", "selftext": "Some page"}))
        self.assertTrue(_is_usable_reddit_post({"title": "What to see in Manila", "selftext": "Visit Intramuros."}))

    def test_url_geocoder_rejects_results_outside_single_inferred_region(self):
        self.assertTrue(_matches_inferred_region(
            {"full_address": "Fort Santiago, Intramuros, Manila, Philippines"}, "Manila"
        ))
        self.assertFalse(_matches_inferred_region(
            {"full_address": "National Museum, Zamboanga City, Philippines"}, "Manila"
        ))
        self.assertFalse(_matches_inferred_region(
            {"full_address": "247 Luneta, San Luis Obispo, California, United States"}, "Manila"
        ))
