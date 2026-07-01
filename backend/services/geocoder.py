"""Multi-layer geocoding service with country bounding box validation.

Converts place names to geographic coordinates using a fallback chain of geocoding APIs.
"""

import asyncio
import os
import time
import urllib.parse
from typing import Optional

import httpx

from backend.services import cache as geo_cache

GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode/search"
LOCATIONIQ_URL = "https://us1.locationiq.com/v1/search.php"

GEOAPIFY_KEY = os.environ.get("GEOAPIFY_API_KEY", "")
LOCATIONIQ_KEY = os.environ.get("LOCATIONIQ_API_KEY", "")

# Google Maps Geocoding API (best global POI coverage, $200/mo free credit)
GOOGLE_MAPS_URL = "https://maps.googleapis.com/maps/api/geocode/json"
GOOGLE_MAPS_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")

# Nominatim (OSM-based, best POI coverage but rate-limited)
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Photon (OSM-based, complementary coverage)
PHOTON_URL = "https://photon.komoot.io/api"

# Rate limiter for LocationIQ (free tier: 1 req/s)
_locationiq_last_call = 0.0

# Rate limiter for Photon (free tier: conservative 1.2s between calls)
_photon_last_call = 0.0

# Country bounding boxes: (min_lat, max_lat, min_lng, max_lng)
COUNTRY_BOUNDS: dict[str, tuple[float, float, float, float]] = {
    # 亚洲（含中东和高加索）
    "afghanistan": (29.0, 38.0, 60.0, 75.0),
    "armenia": (38.0, 42.0, 43.0, 47.0),
    "azerbaijan": (38.0, 42.0, 44.0, 51.0),
    "bahrain": (25.0, 26.0, 50.0, 51.0),
    "bangladesh": (20.0, 27.0, 87.0, 93.0),
    "bhutan": (26.0, 29.0, 88.0, 93.0),
    "brunei": (4.0, 5.0, 114.0, 115.0),
    "cambodia": (10.0, 15.0, 102.0, 108.0),
    "china": (18.0, 54.0, 73.0, 135.0),  # 含南海诸岛
    "cyprus": (34.0, 36.0, 32.0, 35.0),
    "georgia": (41.0, 44.0, 39.0, 47.0),
    "india": (6.0, 36.0, 68.0, 98.0),
    "indonesia": (-11.0, 6.0, 95.0, 141.0),
    "iran": (24.0, 40.0, 44.0, 64.0),
    "iraq": (28.0, 38.0, 38.0, 49.0),
    "israel": (29.0, 34.0, 34.0, 36.0),
    "japan": (30.0, 46.0, 129.0, 146.0),
    "jordan": (29.0, 34.0, 34.0, 40.0),
    "kazakhstan": (41.0, 55.0, 46.0, 88.0),
    "kuwait": (28.0, 31.0, 46.0, 49.0),
    "kyrgyzstan": (39.0, 44.0, 69.0, 81.0),
    "laos": (13.0, 23.0, 100.0, 108.0),
    "lebanon": (33.0, 35.0, 35.0, 37.0),
    "malaysia": (1.0, 7.0, 99.0, 120.0),
    "maldives": (-1.0, 8.0, 72.0, 74.0),
    "mongolia": (41.0, 52.0, 87.0, 120.0),
    "myanmar": (9.0, 29.0, 92.0, 102.0),
    "nepal": (26.0, 31.0, 80.0, 89.0),
    "north korea": (37.0, 43.0, 124.0, 131.0),
    "oman": (16.0, 27.0, 52.0, 60.0),
    "pakistan": (23.0, 37.0, 60.0, 78.0),
    "palestine": (31.0, 33.0, 34.0, 36.0),  # 观察员国
    "philippines": (4.0, 21.0, 116.0, 128.0),
    "qatar": (24.0, 27.0, 50.0, 52.0),
    "saudi arabia": (16.0, 32.0, 34.0, 56.0),
    "singapore": (1.0, 2.0, 103.0, 105.0),
    "south korea": (33.0, 39.0, 124.0, 132.0),
    "sri lanka": (5.0, 10.0, 79.0, 82.0),
    "syria": (32.0, 38.0, 35.0, 43.0),
    "taiwan": (21.0, 26.0, 119.0, 123.0),  # 中国省份，地理围栏常用
    "tajikistan": (36.0, 41.0, 67.0, 76.0),
    "thailand": (5.0, 21.0, 97.0, 106.0),
    "timor-leste": (-9.0, -8.0, 125.0, 127.0),
    "turkey": (35.0, 43.0, 25.0, 45.0),
    "turkmenistan": (35.0, 43.0, 52.0, 67.0),
    "united arab emirates": (22.0, 26.0, 51.0, 57.0),
    "uzbekistan": (37.0, 46.0, 56.0, 74.0),
    "vietnam": (8.0, 23.0, 102.0, 110.0),
    "yemen": (12.0, 19.0, 42.0, 54.0),

    # 欧洲
    "albania": (39.0, 43.0, 19.0, 22.0),
    "andorra": (42.0, 43.0, 1.0, 2.0),
    "austria": (46.0, 49.0, 9.0, 18.0),
    "belarus": (51.0, 57.0, 23.0, 33.0),
    "belgium": (49.0, 52.0, 2.0, 7.0),
    "bosnia and herzegovina": (42.0, 46.0, 15.0, 20.0),
    "bulgaria": (41.0, 45.0, 22.0, 29.0),
    "croatia": (42.0, 47.0, 13.0, 20.0),
    "czech republic": (48.0, 52.0, 12.0, 19.0),
    "denmark": (54.0, 58.0, 7.0, 13.0),
    "estonia": (57.0, 60.0, 21.0, 29.0),
    "finland": (59.0, 71.0, 19.0, 32.0),
    "france": (41.0, 52.0, -5.0, 10.0),  # 含法属圭亚那等地，此处仅欧洲本土
    "germany": (47.0, 56.0, 5.0, 16.0),
    "greece": (34.0, 42.0, 19.0, 30.0),
    "hungary": (45.0, 49.0, 16.0, 23.0),
    "iceland": (63.0, 67.0, -25.0, -13.0),
    "ireland": (51.0, 56.0, -11.0, -5.0),
    "italy": (36.0, 48.0, 6.0, 19.0),
    "latvia": (55.0, 58.0, 20.0, 28.0),
    "liechtenstein": (47.0, 48.0, 9.0, 10.0),
    "lithuania": (53.0, 57.0, 20.0, 27.0),
    "luxembourg": (49.0, 51.0, 5.0, 7.0),
    "malta": (35.0, 37.0, 14.0, 15.0),
    "moldova": (45.0, 49.0, 26.0, 31.0),
    "monaco": (43.0, 44.0, 7.0, 8.0),
    "montenegro": (41.0, 44.0, 18.0, 21.0),
    "netherlands": (50.0, 54.0, 3.0, 8.0),
    "north macedonia": (40.0, 43.0, 20.0, 23.0),
    "norway": (57.0, 72.0, 4.0, 32.0),
    "poland": (49.0, 55.0, 14.0, 25.0),
    "portugal": (36.0, 43.0, -10.0, -6.0),
    "romania": (43.0, 49.0, 20.0, 30.0),
    "russia": (41.0, 82.0, -180.0, 180.0),  # 跨东西半球
    "san marino": (43.0, 45.0, 12.0, 13.0),
    "serbia": (42.0, 47.0, 18.0, 23.0),
    "slovakia": (47.0, 50.0, 16.0, 23.0),
    "slovenia": (45.0, 47.0, 13.0, 17.0),
    "spain": (35.0, 44.0, -10.0, 5.0),
    "sweden": (55.0, 70.0, 10.0, 25.0),
    "switzerland": (45.0, 48.0, 5.0, 11.0),
    "ukraine": (44.0, 53.0, 22.0, 41.0),
    "united kingdom": (49.0, 61.0, -8.0, 2.0),
    "vatican city": (41.0, 42.0, 12.0, 13.0),

    # 非洲
    "algeria": (18.0, 38.0, -9.0, 12.0),
    "angola": (-18.0, -4.0, 11.0, 25.0),
    "benin": (6.0, 13.0, 0.0, 4.0),
    "botswana": (-27.0, -17.0, 19.0, 30.0),
    "burkina faso": (9.0, 15.0, -6.0, 3.0),
    "burundi": (-5.0, -2.0, 28.0, 31.0),
    "cameroon": (1.0, 14.0, 8.0, 17.0),
    "cape verde": (14.0, 18.0, -26.0, -22.0),
    "central african republic": (2.0, 11.0, 13.0, 28.0),
    "chad": (7.0, 24.0, 13.0, 24.0),
    "comoros": (-13.0, -11.0, 43.0, 46.0),
    "congo": (-6.0, 4.0, 11.0, 19.0),  # 刚果（布）
    "democratic republic of the congo": (-13.0, 6.0, 12.0, 32.0),  # 刚果（金）
    "djibouti": (10.0, 13.0, 41.0, 44.0),
    "egypt": (22.0, 32.0, 24.0, 37.0),
    "equatorial guinea": (-2.0, 4.0, 8.0, 12.0),
    "eritrea": (12.0, 18.0, 36.0, 44.0),
    "eswatini": (-27.0, -25.0, 30.0, 33.0),  # 斯威士兰
    "ethiopia": (3.0, 15.0, 33.0, 48.0),
    "gabon": (-4.0, 3.0, 8.0, 15.0),
    "gambia": (13.0, 14.0, -17.0, -13.0),
    "ghana": (4.0, 12.0, -4.0, 2.0),
    "guinea": (7.0, 13.0, -15.0, -7.0),
    "guinea-bissau": (10.0, 13.0, -17.0, -13.0),
    "ivory coast": (4.0, 11.0, -9.0, -2.0),
    "kenya": (-5.0, 6.0, 33.0, 42.0),
    "lesotho": (-30.0, -28.0, 27.0, 30.0),
    "liberia": (4.0, 9.0, -12.0, -7.0),
    "libya": (19.0, 34.0, 8.0, 26.0),
    "madagascar": (-26.0, -12.0, 42.0, 51.0),
    "malawi": (-17.0, -9.0, 32.0, 36.0),
    "mali": (10.0, 25.0, -12.0, 5.0),
    "mauritania": (14.0, 28.0, -18.0, -5.0),
    "mauritius": (-21.0, -19.0, 57.0, 64.0),
    "morocco": (27.0, 36.0, -14.0, -1.0),
    "mozambique": (-27.0, -10.0, 29.0, 41.0),
    "namibia": (-29.0, -17.0, 11.0, 26.0),
    "niger": (11.0, 24.0, 0.0, 16.0),
    "nigeria": (4.0, 14.0, 2.0, 15.0),
    "rwanda": (-3.0, -1.0, 28.0, 31.0),
    "sao tome and principe": (-1.0, 2.0, 6.0, 8.0),
    "senegal": (12.0, 17.0, -18.0, -11.0),
    "seychelles": (-11.0, -3.0, 45.0, 57.0),
    "sierra leone": (6.0, 10.0, -14.0, -10.0),
    "somalia": (-2.0, 12.0, 40.0, 52.0),
    "south africa": (-35.0, -22.0, 16.0, 33.0),
    "south sudan": (3.0, 13.0, 24.0, 36.0),
    "sudan": (8.0, 23.0, 21.0, 39.0),
    "tanzania": (-12.0, -1.0, 28.0, 41.0),
    "togo": (5.0, 11.0, -0.0, 2.0),
    "tunisia": (30.0, 38.0, 7.0, 12.0),
    "uganda": (-1.0, 4.0, 29.0, 35.0),
    "zambia": (-18.0, -8.0, 21.0, 34.0),
    "zimbabwe": (-23.0, -15.0, 25.0, 34.0),

    # 北美洲
    "antigua and barbuda": (16.0, 18.0, -63.0, -61.0),
    "bahamas": (20.0, 27.0, -80.0, -72.0),
    "barbados": (12.0, 14.0, -60.0, -59.0),
    "belize": (15.0, 19.0, -90.0, -88.0),
    "canada": (41.0, 84.0, -142.0, -52.0),
    "costa rica": (8.0, 12.0, -86.0, -82.0),
    "cuba": (19.0, 24.0, -85.0, -74.0),
    "dominica": (15.0, 16.0, -62.0, -61.0),
    "dominican republic": (17.0, 20.0, -72.0, -68.0),
    "el salvador": (13.0, 15.0, -90.0, -88.0),
    "grenada": (11.0, 13.0, -62.0, -61.0),
    "guatemala": (13.0, 18.0, -93.0, -88.0),
    "haiti": (18.0, 20.0, -75.0, -71.0),
    "honduras": (12.0, 17.0, -90.0, -83.0),
    "jamaica": (17.0, 19.0, -79.0, -76.0),
    "mexico": (14.0, 33.0, -118.0, -86.0),
    "nicaragua": (10.0, 15.0, -88.0, -83.0),
    "panama": (7.0, 10.0, -83.0, -77.0),
    "saint kitts and nevis": (17.0, 18.0, -63.0, -62.0),
    "saint lucia": (13.0, 15.0, -61.0, -60.0),
    "saint vincent and the grenadines": (12.0, 14.0, -62.0, -61.0),
    "trinidad and tobago": (10.0, 12.0, -62.0, -60.0),
    "united states": (18.0, 72.0, -170.0, -66.0),  # 含阿拉斯加和夏威夷

    # 南美洲
    "argentina": (-55.0, -22.0, -73.0, -62.0),
    "bolivia": (-23.0, -9.0, -70.0, -57.0),
    "brazil": (-34.0, 6.0, -74.0, -34.0),
    "chile": (-56.0, -17.0, -76.0, -66.0),
    "colombia": (-4.0, 13.0, -79.0, -66.0),
    "ecuador": (-6.0, 2.0, -82.0, -75.0),
    "guyana": (1.0, 9.0, -62.0, -56.0),
    "paraguay": (-28.0, -18.0, -63.0, -54.0),
    "peru": (-18.0, -0.0, -81.0, -68.0),
    "suriname": (1.0, 7.0, -58.0, -53.0),
    "uruguay": (-35.0, -30.0, -59.0, -53.0),
    "venezuela": (0.0, 12.0, -73.0, -60.0),

    # 大洋洲
    "australia": (-44.0, -10.0, 112.0, 155.0),
    "fiji": (-19.0, -12.0, 177.0, 180.0),
    "kiribati": (-5.0, 5.0, -170.0, -150.0),
    "marshall islands": (4.0, 15.0, 160.0, 173.0),
    "micronesia": (1.0, 10.0, 136.0, 163.0),
    "nauru": (-1.0, -0.0, 166.0, 168.0),
    "new zealand": (-48.0, -33.0, 165.0, 180.0),
    "palau": (2.0, 9.0, 130.0, 135.0),
    "papua new guinea": (-12.0, -1.0, 140.0, 157.0),
    "samoa": (-14.0, -13.0, -173.0, -171.0),
    "solomon islands": (-12.0, -6.0, 155.0, 171.0),
    "tonga": (-24.0, -14.0, -177.0, -173.0),
    "tuvalu": (-9.0, -6.0, 175.0, 180.0),
    "vanuatu": (-21.0, -13.0, 166.0, 172.0),
}


def _check_coords_in_country(lat: float, lng: float, city_name: str | None,
                              result_address: str | None = None) -> bool:
    """Check if coordinates fall within the expected country's bounding box.
    
    Uses both city_name (e.g. "Shanghai", "Shanghai, China") and
    result_address (the geocoded result's formatted address) to determine
    the expected country.
    """
    if not city_name:
        return True

    city_lower = city_name.lower()
    
    # Build a set of countries to check against
    # From city_name: look for country names
    # From result_address: look for country names in the geocoded result
    candidate_texts = [city_lower]
    if result_address:
        candidate_texts.append(result_address.lower())
    
    checked_countries = set()
    
    for text in candidate_texts:
        for country, (min_lat, max_lat, min_lng, max_lng) in COUNTRY_BOUNDS.items():
            if country in checked_countries:
                continue
            if country in text:
                checked_countries.add(country)
                # Check if coordinates are within this country's bounding box
                if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng:
                    return True
                # Special case: USA also matches "united states" or "america"
                if country == "usa":
                    for alt in ["united states", "america"]:
                        if alt in text:
                            if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng:
                                return True
                # Country found but coordinates outside it — reject
                return False
    
    # No country found in any text — check if city_name matches a known city
    # that is definitely in a specific country
    city_country = {
        "shanghai": "china", "beijing": "china", "shenzhen": "china",
        "guangzhou": "china", "hong kong": "china", "taipei": "china",
        "paris": "france", "lyon": "france", "marseille": "france",
        "london": "united kingdom", "manchester": "united kingdom",
        "edinburgh": "united kingdom",
        "new york": "usa", "los angeles": "usa", "chicago": "usa",
        "san francisco": "usa", "washington": "usa",
        "toronto": "canada", "vancouver": "canada",
        "tokyo": "japan", "osaka": "japan", "seoul": "south korea",
        "sydney": "australia", "melbourne": "australia",
        "berlin": "germany", "munich": "germany", "rome": "italy",
        "milan": "italy", "madrid": "spain", "barcelona": "spain",
    }
    for city, country in city_country.items():
        if city in city_lower:
            min_lat, max_lat, min_lng, max_lng = COUNTRY_BOUNDS[country]
            if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng:
                return True
            return False

    return True  # Unknown location, don't filter


async def _geocode_geoapify(location_name: str,
                             city_name: str | None = None) -> dict | None:
    """Geocode via Geoapify (free: 3,000 req/day)."""
    if not GEOAPIFY_KEY:
        return None
    
    query = location_name
    params = {
        "text": query,
        "apiKey": GEOAPIFY_KEY,
        "limit": 1,
        "lang": "en",
        "filter": "countrycode:us,ca,fr,gb,de,it,es,jp,kr,cn,au,nz",  # Common travel countries
    }
    
    try:
        await asyncio.sleep(0.1)  # Be polite
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(GEOAPIFY_URL, params=params)
            response.raise_for_status()
            data = response.json()
        
        features = data.get("features", [])
        if not features:
            return None
        
        feat = features[0]
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])
        
        result_type = props.get("result_type", "")
        is_poi = result_type in ("amenity", "building", "shop", "leisure", "tourism",
                                  "historic", "museum", "attraction")
        
        return {
            "name": location_name,
            "latitude": coords[1],
            "longitude": coords[0],
            "full_address": props.get("formatted", location_name),
            "is_exact": is_poi,
            "confidence": 0.8 if is_poi else 0.5,
            "source": "geoapify",
        }
    except Exception as e:
        print(f"[Geoapify] Failed for '{query}': {e}")
        return None


async def _geocode_locationiq(location_name: str,
                               city_name: str | None = None) -> dict | None:
    """Geocode via LocationIQ (free: 5,000 req/day, 1 req/s rate limit)."""
    global _locationiq_last_call
    if not LOCATIONIQ_KEY:
        return None
    
    # Rate limit: LocationIQ free tier ~1.7 req/s (600ms between calls)
    now = time.time()
    since_last = now - _locationiq_last_call
    if since_last < 0.6:
        await asyncio.sleep(0.6 - since_last)
    _locationiq_last_call = time.time()
    
    query = location_name
    params = {
        "key": LOCATIONIQ_KEY,
        "q": query,
        "format": "json",
        "limit": 1,
    }
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(LOCATIONIQ_URL, params=params)
            response.raise_for_status()
            data = response.json()
        
        if not data:
            return None
        
        result = data[0]
        osm_type = result.get("osm_type", "")
        category = result.get("category", "")
        
        is_poi = osm_type in ("node", "way") and category not in ("place", "boundary")
        
        return {
            "name": location_name,
            "latitude": float(result["lat"]),
            "longitude": float(result["lon"]),
            "full_address": result.get("display_name", location_name),
            "is_exact": is_poi,
            "confidence": 0.8 if is_poi else 0.5,
            "source": "locationiq",
        }
    except Exception as e:
        print(f"[LocationIQ] Failed for '{query}': {e}")
        return None


async def _geocode_nominatim(location_name: str,
                              city_name: str | None = None) -> dict | None:
    """Geocode via Nominatim (OSM, best POI coverage, but rate-limited to ~1 req/s)."""
    query = location_name
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
    }
    headers = {
        "User-Agent": "AtlasTravelApp/1.0 (travel-planning-app)",
    }

    try:
        await asyncio.sleep(1.0)  # Respect rate limit: 1 req/s
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(NOMINATIM_URL, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()

        if not data:
            return None

        result = data[0]
        osm_type = result.get("osm_type", "")
        category = result.get("category", "")
        result_type = result.get("type", "")

        is_poi = osm_type in ("node", "way") and category not in ("place", "boundary")

        return {
            "name": location_name,
            "latitude": float(result["lat"]),
            "longitude": float(result["lon"]),
            "full_address": result.get("display_name", location_name),
            "is_exact": is_poi,
            "confidence": 0.7 if is_poi else 0.4,
            "source": "nominatim",
        }
    except Exception as e:
        print(f"[Nominatim] Failed for '{query}': {e}")
        return None


async def _geocode_photon(location_name: str,
                           city_name: str | None = None) -> dict | None:
    """Geocode via Photon (OSM-based, complementary POI coverage, free)."""
    global _photon_last_call

    # Rate limit: 1.2s between calls to avoid getting blocked
    now = time.time()
    since_last = now - _photon_last_call
    if since_last < 1.2:
        await asyncio.sleep(1.2 - since_last)
    _photon_last_call = time.time()

    query = location_name
    params = {
        "q": query,
        "limit": 1,
        "lang": "en",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(PHOTON_URL, params=params)
            response.raise_for_status()
            data = response.json()

        features = data.get("features", [])
        if not features:
            return None

        feat = features[0]
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])

        osm_type = props.get("osm_type", "")
        osm_key = props.get("osm_key", "")
        is_poi = osm_type in ("N", "W") and osm_key not in ("place", "boundary")

        return {
            "name": location_name,
            "latitude": coords[1],
            "longitude": coords[0],
            "full_address": props.get("name", location_name),
            "is_exact": is_poi,
            "confidence": 0.6 if is_poi else 0.3,
            "source": "photon",
        }
    except Exception as e:
        print(f"[Photon] Failed for '{query}': {e}")
        return None


async def _geocode_google(location_name: str,
                           city_name: str | None = None) -> dict | None:
    """Geocode via Google Maps Geocoding API.
    
    Free tier: $200 monthly credit (~40,000 requests/month).
    Best POI coverage globally, especially for non-English locations.
    """
    if not GOOGLE_MAPS_KEY:
        print(f"[GoogleMaps] Skipped: no API key configured")
        return None
    
    query = location_name
    if city_name and city_name.lower() not in location_name.lower():
        query = f"{location_name}, {city_name}"
    
    params = {
        "address": query,
        "key": GOOGLE_MAPS_KEY,
        "language": "en",
    }
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(GOOGLE_MAPS_URL, params=params)
            response.raise_for_status()
            data = response.json()
        
        status = data.get("status")
        if status != "OK":
            error_msg = data.get("error_message", "no error message")
            print(f"[GoogleMaps] Status: {status} for '{query}' — {error_msg}")
            return None
        
        if not data.get("results"):
            print(f"[GoogleMaps] No results for '{query}'")
            return None
        
        result = data["results"][0]
        location = result.get("geometry", {}).get("location", {})
        types = result.get("types", [])
        
        # POI-level types
        poi_types = {"point_of_interest", "establishment", "premise",
                      "subpremise", "park", "museum", "art_gallery",
                      "tourist_attraction", "shopping_mall", "night_club",
                      "restaurant", "bar", "cafe", "food", "church",
                      "stadium", "parking", "transit_station", "train_station"}
        is_poi = any(t in poi_types for t in types)
        
        # Parse address components
        full_address = result.get("formatted_address", query)
        
        return {
            "name": location_name,
            "latitude": location["lat"],
            "longitude": location["lng"],
            "full_address": full_address,
            "is_exact": is_poi,
            "confidence": 0.85 if is_poi else 0.5,
            "source": "google",
        }
    except Exception as e:
        print(f"[GoogleMaps] Failed for '{query}': {e}")
        return None


async def geocode(
    location_name: str,
    proximity: Optional[tuple[float, float]] = None,
    city_name: Optional[str] = None,
    city_center: Optional[tuple[float, float]] = None,
) -> dict | None:
    """
    Multi-layer geocoding with configurable fallback chain (5 layers).
    
    Priority:
    1. Geoapify (free 3k req/day, fastest, best POI coverage)
    2. LocationIQ (free 5k req/day, fast)
    3. Nominatim (OSM, best POI coverage, but rate-limited ~1 req/s)
    4. Photon (OSM-based, complementary coverage, free)
    5. Google Maps (best for non-English/Asian locations, $200/mo free credit)
    
    Returns None only if ALL geocoders fail.
    Never returns fake/default coordinates.
    """
    cache_key = f"geo:{location_name}:{city_name or ''}"
    cached = geo_cache.get(cache_key)
    if cached:
        return cached

    # Layer 1: Geoapify (fastest, best POI coverage)
    geoapify_result = await _geocode_geoapify(location_name, city_name=city_name)
    if geoapify_result and geoapify_result.get("is_exact"):
        if _check_coords_in_country(geoapify_result["latitude"], geoapify_result["longitude"], city_name):
            print(f"[Geocoder] Geoapify OK: '{location_name}' → ({geoapify_result['latitude']:.4f}, {geoapify_result['longitude']:.4f}) [EXACT]")
            geo_cache.set(cache_key, geoapify_result, ttl=86400)
            return geoapify_result
        else:
            print(f"[Geocoder] Geoapify coord mismatch: '{location_name}' → ({geoapify_result['latitude']:.4f}, {geoapify_result['longitude']:.4f}) outside {city_name}")

    # Layer 2: LocationIQ (fast, free 5k req/day)
    liq_result = await _geocode_locationiq(location_name, city_name=city_name)
    if liq_result and liq_result.get("is_exact"):
        if _check_coords_in_country(liq_result["latitude"], liq_result["longitude"], city_name):
            print(f"[Geocoder] LocationIQ OK: '{location_name}' → ({liq_result['latitude']:.4f}, {liq_result['longitude']:.4f}) [EXACT]")
            geo_cache.set(cache_key, liq_result, ttl=86400)
            return liq_result
        else:
            print(f"[Geocoder] LocationIQ coord mismatch: '{location_name}' → ({liq_result['latitude']:.4f}, {liq_result['longitude']:.4f}) outside {city_name}")

    # Layer 3: Nominatim (slow, best POI coverage from OSM)
    nominatim_result = await _geocode_nominatim(location_name, city_name=city_name)
    if nominatim_result and nominatim_result.get("is_exact"):
        if _check_coords_in_country(nominatim_result["latitude"], nominatim_result["longitude"], city_name):
            print(f"[Geocoder] Nominatim OK: '{location_name}' → ({nominatim_result['latitude']:.4f}, {nominatim_result['longitude']:.4f}) [EXACT]")
            geo_cache.set(cache_key, nominatim_result, ttl=86400)
            return nominatim_result
        else:
            print(f"[Geocoder] Nominatim coord mismatch: '{location_name}' → ({nominatim_result['latitude']:.4f}, {nominatim_result['longitude']:.4f}) outside {city_name}")

    # Layer 4: Photon (OSM-based, complementary coverage, free)
    photon_result = await _geocode_photon(location_name, city_name=city_name)
    if photon_result and photon_result.get("is_exact"):
        if _check_coords_in_country(photon_result["latitude"], photon_result["longitude"], city_name):
            print(f"[Geocoder] Photon OK: '{location_name}' → ({photon_result['latitude']:.4f}, {photon_result['longitude']:.4f}) [EXACT]")
            geo_cache.set(cache_key, photon_result, ttl=86400)
            return photon_result
        else:
            print(f"[Geocoder] Photon coord mismatch: '{location_name}' → ({photon_result['latitude']:.4f}, {photon_result['longitude']:.4f}) outside {city_name}")

    # Layer 5: Google Maps (best for non-English/Asian locations, $200/mo free credit)
    google_result = await _geocode_google(location_name, city_name=city_name)
    if google_result and google_result.get("is_exact"):
        if _check_coords_in_country(google_result["latitude"], google_result["longitude"], city_name):
            print(f"[Geocoder] Google OK: '{location_name}' → ({google_result['latitude']:.4f}, {google_result['longitude']:.4f}) [EXACT]")
            geo_cache.set(cache_key, google_result, ttl=86400)
            return google_result
        else:
            print(f"[Geocoder] Google coord mismatch: '{location_name}' → ({google_result['latitude']:.4f}, {google_result['longitude']:.4f}) outside {city_name}")

    # All geocoders failed — do NOT return any fallback
    return None


async def batch_geocode(
    location_names: list[str],
    proximity: Optional[tuple[float, float]] = None,
    city_name: Optional[str] = None,
    city_center: Optional[tuple[float, float]] = None,
) -> list[dict | None]:

    async def _geocode_one(name: str) -> dict | None:
        try:
            return await geocode(
                name, proximity=proximity,
                city_name=city_name, city_center=city_center,
            )
        except Exception:
            return None

    tasks = [_geocode_one(name) for name in location_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    return [r if isinstance(r, dict) else None for r in results]
