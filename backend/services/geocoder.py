"""Multi-layer geocoding service with country bounding box validation.

Converts place names to geographic coordinates using a fallback chain of geocoding APIs.
"""

import asyncio
import os
import re
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
_locationiq_lock = asyncio.Lock()

# Rate limiter for Photon (free tier: conservative 1.2s between calls)
_photon_last_call = 0.0
_photon_lock = asyncio.Lock()

# Rate limiter for Nominatim (1 req/s)
_nominatim_last_call = 0.0
_nominatim_lock = asyncio.Lock()

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

COUNTRY_ALIASES: dict[str, str] = {
    "usa": "united states",
    "us": "united states",
    "uk": "united kingdom",
}

REGION_TO_COUNTRY: dict[str, str] = {
    # United States — states and common abbreviations
    "alabama": "united states", "al": "united states",
    "alaska": "united states", "ak": "united states",
    "arizona": "united states", "az": "united states",
    "arkansas": "united states", "ar": "united states",
    "california": "united states", "ca": "united states",
    "colorado": "united states", "co": "united states",
    "connecticut": "united states", "ct": "united states",
    "delaware": "united states", "de": "united states",
    "florida": "united states", "fl": "united states",
    "georgia state": "united states",
    "hawaii": "united states", "hi": "united states",
    "idaho": "united states", "id": "united states",
    "illinois": "united states", "il": "united states",
    "indiana": "united states", "in": "united states",
    "iowa": "united states", "ia": "united states",
    "kansas": "united states", "ks": "united states",
    "kentucky": "united states", "ky": "united states",
    "louisiana": "united states", "la": "united states",
    "maine": "united states", "me": "united states",
    "maryland": "united states", "md": "united states",
    "massachusetts": "united states", "ma": "united states",
    "michigan": "united states", "mi": "united states",
    "minnesota": "united states", "mn": "united states",
    "mississippi": "united states", "ms": "united states",
    "missouri": "united states", "mo": "united states",
    "montana": "united states", "mt": "united states",
    "nebraska": "united states", "ne": "united states",
    "nevada": "united states", "nv": "united states",
    "new hampshire": "united states", "nh": "united states",
    "new jersey": "united states", "nj": "united states",
    "new mexico": "united states", "nm": "united states",
    "new york state": "united states",
    "north carolina": "united states", "nc": "united states",
    "north dakota": "united states", "nd": "united states",
    "ohio": "united states", "oh": "united states",
    "oklahoma": "united states", "ok": "united states",
    "oregon": "united states", "or": "united states",
    "pennsylvania": "united states", "pa": "united states",
    "rhode island": "united states", "ri": "united states",
    "south carolina": "united states", "sc": "united states",
    "south dakota": "united states", "sd": "united states",
    "tennessee": "united states", "tn": "united states",
    "texas": "united states", "tx": "united states",
    "utah": "united states", "ut": "united states",
    "vermont": "united states", "vt": "united states",
    "virginia": "united states", "va": "united states",
    "washington state": "united states",
    "west virginia": "united states", "wv": "united states",
    "wisconsin": "united states", "wi": "united states",
    "wyoming": "united states", "wy": "united states",
    "district of columbia": "united states", "dc": "united states",
    # Canada
    "ontario": "canada", "on": "canada",
    "quebec": "canada", "qc": "canada",
    "british columbia": "canada", "bc": "canada",
    "alberta": "canada", "ab": "canada",
    "manitoba": "canada", "mb": "canada",
    "saskatchewan": "canada", "sk": "canada",
    "nova scotia": "canada", "ns": "canada",
    "new brunswick": "canada", "nb": "canada",
    "newfoundland and labrador": "canada", "nl": "canada",
    "prince edward island": "canada", "pe": "canada",
    # Australia
    "new south wales": "australia", "nsw": "australia",
    "victoria": "australia", "vic": "australia",
    "queensland": "australia", "qld": "australia",
    "western australia": "australia", "wa": "australia",
    "south australia": "australia", "sa": "australia",
    "tasmania": "australia", "tas": "australia",
    # Mexico
    "ciudad de mexico": "mexico", "cdmx": "mexico",
}

REGION_ABBREV_TO_NAME: dict[str, str] = {
    # United States
    "al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas",
    "ca": "california", "co": "colorado", "ct": "connecticut", "de": "delaware",
    "fl": "florida", "ga": "georgia", "hi": "hawaii", "id": "idaho",
    "il": "illinois", "ia": "iowa", "ks": "kansas", "ky": "kentucky",
    "la": "louisiana", "md": "maryland", "ma": "massachusetts", "mi": "michigan",
    "mn": "minnesota", "ms": "mississippi", "mo": "missouri", "mt": "montana",
    "ne": "nebraska", "nv": "nevada", "nh": "new hampshire", "nj": "new jersey",
    "nm": "new mexico", "ny": "new york", "nc": "north carolina", "nd": "north dakota",
    "oh": "ohio", "ok": "oklahoma", "or": "oregon", "pa": "pennsylvania",
    "ri": "rhode island", "sc": "south carolina", "sd": "south dakota",
    "tn": "tennessee", "tx": "texas", "ut": "utah", "vt": "vermont",
    "va": "virginia", "wa": "washington", "wv": "west virginia", "wi": "wisconsin",
    "wy": "wyoming", "dc": "district of columbia",
    # Canada
    "on": "ontario", "qc": "quebec", "bc": "british columbia", "ab": "alberta",
    "mb": "manitoba", "sk": "saskatchewan", "ns": "nova scotia", "nb": "new brunswick",
    "nl": "newfoundland and labrador", "pe": "prince edward island",
    # Australia / Mexico
    "nsw": "new south wales", "vic": "victoria", "qld": "queensland",
    "tas": "tasmania", "cdmx": "ciudad de mexico",
}

CITY_TO_COUNTRY: dict[str, str] = {
    "shanghai": "china", "beijing": "china", "shenzhen": "china",
    "guangzhou": "china", "hong kong": "china", "taipei": "china",
    "paris": "france", "lyon": "france", "marseille": "france",
    "london": "united kingdom", "manchester": "united kingdom",
    "edinburgh": "united kingdom",
    "new york": "united states", "los angeles": "united states", "chicago": "united states",
    "san francisco": "united states", "seattle": "united states",
    "washington dc": "united states", "washington state": "united states",
    "toronto": "canada", "vancouver": "canada",
    "tokyo": "japan", "osaka": "japan", "seoul": "south korea",
    "sydney": "australia", "melbourne": "australia",
    "berlin": "germany", "munich": "germany", "rome": "italy",
    "milan": "italy", "madrid": "spain", "barcelona": "spain",
}

# City → country code mapping for Geoapify filter (used in _geocode_geoapify)
CITY_COUNTRY_MAP: dict[str, str] = {
    # India
    "mumbai": "in",
    "delhi": "in",
    "new delhi": "in",
    "bangalore": "in",
    "bengaluru": "in",
    "hyderabad": "in",
    "chennai": "in",
    "kolkata": "in",
    "pune": "in",
    "jaipur": "in",
    "ahmedabad": "in",
    # United States
    "new york": "us",
    "los angeles": "us",
    "chicago": "us",
    "san francisco": "us",
    "washington": "us",
    "seattle": "us",
    "boston": "us",
    "miami": "us",
    # Canada
    "toronto": "ca",
    "vancouver": "ca",
    "montreal": "ca",
    # France
    "paris": "fr",
    "lyon": "fr",
    "marseille": "fr",
    # United Kingdom
    "london": "gb",
    "manchester": "gb",
    "edinburgh": "gb",
    # Germany
    "berlin": "de",
    "munich": "de",
    "hamburg": "de",
    "frankfurt": "de",
    # Italy
    "rome": "it",
    "milan": "it",
    "venice": "it",
    "florence": "it",
    # Spain
    "madrid": "es",
    "barcelona": "es",
    "seville": "es",
    # Japan
    "tokyo": "jp",
    "osaka": "jp",
    "kyoto": "jp",
    # South Korea
    "seoul": "kr",
    "busan": "kr",
    # China
    "beijing": "cn",
    "shanghai": "cn",
    "shenzhen": "cn",
    "guangzhou": "cn",
    "hong kong": "cn",
    # Australia
    "sydney": "au",
    "melbourne": "au",
    "brisbane": "au",
    # New Zealand
    "auckland": "nz",
    "wellington": "nz",
    # Netherlands
    "amsterdam": "nl",
    "rotterdam": "nl",
    # Switzerland
    "zurich": "ch",
    "geneva": "ch",
    # Singapore
    "singapore": "sg",
    # Thailand
    "bangkok": "th",
    "phuket": "th",
    # Vietnam
    "hanoi": "vn",
    "ho chi minh": "vn",
    # United Arab Emirates
    "dubai": "ae",
    "abu dhabi": "ae",
    # Turkey
    "istanbul": "tr",
    "ankara": "tr",
    # Brazil
    "rio de janeiro": "br",
    "sao paulo": "br",
    # Mexico
    "mexico city": "mx",
    "cancun": "mx",
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

    def _normalize_geo_text(value: str) -> str:
        normalized = value.lower()
        normalized = normalized.replace("&", " and ")
        normalized = normalized.replace("/", " ")
        normalized = re.sub(r"[^\w\s]", " ", normalized)
        return f" {' '.join(normalized.split())} "

    def _has_phrase(text: str, phrase: str) -> bool:
        return f" {phrase} " in text

    def _extract_expected_countries(*texts: str | None) -> list[str]:
        raw_texts = [text for text in texts if text]
        normalized_texts = [_normalize_geo_text(text) for text in raw_texts]
        countries: list[str] = []
        seen: set[str] = set()

        alias_map: dict[str, str] = {
            **{country: country for country in COUNTRY_BOUNDS.keys()},
            **{alias: canonical for alias, canonical in COUNTRY_ALIASES.items()},
        }

        def _add_country(country_name: str) -> None:
            normalized_country = COUNTRY_ALIASES.get(country_name, country_name)
            if normalized_country in COUNTRY_BOUNDS and normalized_country not in seen:
                seen.add(normalized_country)
                countries.append(normalized_country)

        # 1) Exact country phrase matching with phrase boundaries.
        for phrase, canonical in sorted(alias_map.items(), key=lambda item: len(item[0]), reverse=True):
            for text in normalized_texts:
                if _has_phrase(text, phrase):
                    _add_country(canonical)
                    break

        # 2) Administrative region → country mapping (full names only).
        for phrase, canonical in sorted(REGION_TO_COUNTRY.items(), key=lambda item: len(item[0]), reverse=True):
            if len(phrase) <= 3:
                continue
            for text in normalized_texts:
                if _has_phrase(text, phrase):
                    _add_country(canonical)
                    break

        # 2b) Region abbreviations only match standalone uppercase tokens from raw text.
        upper_tokens: set[str] = set()
        for text in raw_texts:
            upper_tokens.update(token.lower() for token in re.findall(r"\b[A-Z]{2,3}\b", text))
        for token in upper_tokens:
            canonical = REGION_TO_COUNTRY.get(token)
            if canonical:
                _add_country(canonical)

        # 3) Known city → country fallback.
        for phrase, canonical in sorted(CITY_TO_COUNTRY.items(), key=lambda item: len(item[0]), reverse=True):
            for text in normalized_texts:
                if _has_phrase(text, phrase):
                    _add_country(canonical)
                    break

        return countries

    def _canonicalize_region(region_phrase: str) -> str:
        region = region_phrase.strip().lower()
        if region in REGION_ABBREV_TO_NAME:
            return REGION_ABBREV_TO_NAME[region]
        if region.endswith(" state"):
            return region[:-6].strip()
        return region

    def _extract_regions(*texts: str | None) -> set[str]:
        raw_texts = [text for text in texts if text]
        normalized_texts = [_normalize_geo_text(text) for text in raw_texts]
        regions: set[str] = set()

        for phrase in sorted(REGION_TO_COUNTRY.keys(), key=len, reverse=True):
            if len(phrase) <= 3:
                continue
            for text in normalized_texts:
                if _has_phrase(text, phrase):
                    regions.add(_canonicalize_region(phrase))
                    break

        upper_tokens: set[str] = set()
        for text in raw_texts:
            upper_tokens.update(token.lower() for token in re.findall(r"\b[A-Z]{2,4}\b", text))
        for token in upper_tokens:
            canonical = REGION_ABBREV_TO_NAME.get(token)
            if canonical:
                regions.add(canonical)

        return regions

    if city_name and result_address:
        source_countries = set(_extract_expected_countries(city_name))
        result_countries = set(_extract_expected_countries(result_address))
        if source_countries and result_countries and source_countries.isdisjoint(result_countries):
            return False

        source_regions = _extract_regions(city_name)
        result_regions = _extract_regions(result_address)
        if source_regions and result_regions and source_regions.isdisjoint(result_regions):
            return False

    expected_countries = _extract_expected_countries(city_name)
    if not expected_countries and result_address:
        expected_countries = _extract_expected_countries(result_address)
    if expected_countries:
        for country in expected_countries:
            min_lat, max_lat, min_lng, max_lng = COUNTRY_BOUNDS[country]
            if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng:
                return True
        return False

    return True  # Unknown location, don't filter


async def _geocode_geoapify(location_name: str, city_name: str | None = None) -> dict | None:
    """Geocode via Geoapify (free: 3,000 req/day)."""
    if not GEOAPIFY_KEY:
        return None

    query = location_name
    params: dict[str, str | int] = {
        "text": query,
        "apiKey": GEOAPIFY_KEY,
        "limit": 1,
        "lang": "en",
    }

    # Important:
    # - For fuzzy POI lookups, `type=amenity` helps precision.
    # - For exact street addresses, `type=amenity` is too restrictive and can
    #   filter out valid building/address results entirely.
    # - For region/country/city level names, `type=amenity` is also too
    #   restrictive (a country is not an amenity). Skip it for short queries
    #   that look like geographic names rather than POI names.
    if not _is_precise_address_query(query) and len(query.split()) <= 3:
        # Short queries (1-3 words) are likely city/country/region names,
        # not specific POIs — don't restrict to amenity type.
        pass
    elif not _is_precise_address_query(query):
        params["type"] = "amenity"

    # Dynamic filter: if city_name is known, restrict to that country; otherwise no filter
    city_lower = (city_name or "").lower()
    if city_lower in CITY_COUNTRY_MAP:
        params["filter"] = f"countrycode:{CITY_COUNTRY_MAP[city_lower]}"

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
        formatted = props.get("formatted", location_name)
        is_precise_match = _is_precise_address_query(query) and _address_tokens_match(query, formatted)
        is_poi = result_type in ("amenity", "building", "shop", "leisure", "tourism",
                                  "historic", "museum", "attraction")

        return {
            "name": location_name,
            "latitude": coords[1],
            "longitude": coords[0],
            "full_address": formatted,
            "is_exact": is_poi or is_precise_match,
            "confidence": 0.84 if is_precise_match else (0.8 if is_poi else 0.5),
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

    query = location_name
    params = {
        "key": LOCATIONIQ_KEY,
        "q": query,
        "format": "json",
        "limit": 1,
    }

    try:
        async with _locationiq_lock:
            # Rate limit: LocationIQ free tier ~1.7 req/s (600ms between calls)
            now = time.time()
            since_last = now - _locationiq_last_call
            if since_last < 0.6:
                await asyncio.sleep(0.6 - since_last)
            _locationiq_last_call = time.time()

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(LOCATIONIQ_URL, params=params)

        response.raise_for_status()
        data = response.json()

        if not data:
            return None

        result = data[0]
        osm_type = result.get("osm_type", "")
        category = result.get("category", "")

        display_name = result.get("display_name", location_name)
        is_precise_match = _is_precise_address_query(query) and _address_tokens_match(query, display_name)
        is_poi = osm_type in ("node", "way") and category not in ("place", "boundary")

        return {
            "name": location_name,
            "latitude": float(result["lat"]),
            "longitude": float(result["lon"]),
            "full_address": display_name,
            "is_exact": is_poi or is_precise_match,
            "confidence": 0.82 if is_precise_match else (0.8 if is_poi else 0.5),
            "source": "locationiq",
        }
    except Exception as e:
        print(f"[LocationIQ] Failed for '{query}': {e}")
        return None


async def _geocode_nominatim(location_name: str,
                              city_name: str | None = None) -> dict | None:
    """Geocode via Nominatim (OSM, best POI coverage, but rate-limited to ~1 req/s)."""
    global _nominatim_last_call

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
        async with _nominatim_lock:
            # Rate limit: 1 req/s
            now = time.time()
            since_last = now - _nominatim_last_call
            if since_last < 1.0:
                await asyncio.sleep(1.0 - since_last)
            _nominatim_last_call = time.time()

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(NOMINATIM_URL, params=params, headers=headers)

        response.raise_for_status()
        data = response.json()

        if not data:
            return None

        result = data[0]
        osm_type = result.get("osm_type", "")
        category = result.get("category", "")
        display_name = result.get("display_name", location_name)
        is_precise_match = _is_precise_address_query(query) and _address_tokens_match(query, display_name)
        is_poi = osm_type in ("node", "way") and category not in ("place", "boundary")

        return {
            "name": location_name,
            "latitude": float(result["lat"]),
            "longitude": float(result["lon"]),
            "full_address": display_name,
            "is_exact": is_poi or is_precise_match,
            "confidence": 0.78 if is_precise_match else (0.7 if is_poi else 0.4),
            "source": "nominatim",
        }
    except Exception as e:
        print(f"[Nominatim] Failed for '{query}': {e}")
        return None


async def _geocode_photon(location_name: str,
                           city_name: str | None = None) -> dict | None:
    """Geocode via Photon (OSM-based, complementary POI coverage, free)."""
    global _photon_last_call

    query = location_name
    params = {
        "q": query,
        "limit": 1,
        "lang": "en",
    }

    try:
        async with _photon_lock:
            # Rate limit: 1.2s between calls to avoid getting blocked
            now = time.time()
            since_last = now - _photon_last_call
            if since_last < 1.2:
                await asyncio.sleep(1.2 - since_last)
            _photon_last_call = time.time()

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    PHOTON_URL,
                    params=params,
                    headers={
                        "User-Agent": "AtlasTravelApp/1.0 (geocoder@atlas.app)",
                        "Accept": "application/json",
                    },
                )

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
        full_address = props.get("name", location_name)
        is_precise_match = _is_precise_address_query(query) and _address_tokens_match(query, full_address)
        is_poi = osm_type in ("N", "W") and osm_key not in ("place", "boundary")

        return {
            "name": location_name,
            "latitude": coords[1],
            "longitude": coords[0],
            "full_address": full_address,
            "is_exact": is_poi or is_precise_match,
            "confidence": 0.72 if is_precise_match else (0.6 if is_poi else 0.3),
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
        print(f"[GoogleMaps] SKIPPED: No GOOGLE_MAPS_API_KEY configured")
        return None

    query = location_name
    if city_name and city_name.lower() not in location_name.lower():
        query = f"{location_name}, {city_name}"

    print(f"[GoogleMaps] Calling for '{query}' (city_name={city_name})")

    params = {
        "address": query,
        "key": GOOGLE_MAPS_KEY,
        "language": "en",
    }

    # Retry logic: up to 2 attempts on transient failures
    max_retries = 2
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(GOOGLE_MAPS_URL, params=params)
                response.raise_for_status()
                data = response.json()

            status = data.get("status")
            if status != "OK":
                error_msg = data.get("error_message", "no error message")
                print(f"[GoogleMaps] Status: {status} for '{query}' — {error_msg}")
                # OVER_QUERY_LIMIT / REQUEST_DENIED are not retryable
                if status in ("OVER_QUERY_LIMIT", "REQUEST_DENIED", "INVALID_REQUEST"):
                    return None
                # Other errors (e.g. ZERO_RESULTS) — just return None
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

            full_address = result.get("formatted_address", query)
            is_precise_match = _is_precise_address_query(query) and _address_tokens_match(query, full_address)

            lat = location["lat"]
            lng = location["lng"]
            result_type = types[0] if types else "unknown"
            print(f"[GoogleMaps] OK: '{query}' → ({lat:.4f}, {lng:.4f}) [{result_type}]")

            return {
                "name": location_name,
                "latitude": lat,
                "longitude": lng,
                "full_address": full_address,
                "is_exact": is_poi or is_precise_match,
                "confidence": 0.88 if is_precise_match else (0.85 if is_poi else 0.5),
                "source": "google",
            }
        except httpx.TimeoutException:
            print(f"[GoogleMaps] Timeout (attempt {attempt}/{max_retries}) for '{query}'")
            if attempt < max_retries:
                await asyncio.sleep(1.0 * attempt)  # Exponential backoff
                continue
            print(f"[GoogleMaps] All retries exhausted for '{query}'")
            return None
        except Exception as e:
            print(f"[GoogleMaps] Failed for '{query}': {e}")
            return None

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

    precise_address_query = _is_precise_address_query(location_name)

    def _accept_result(result: dict | None, source_name: str) -> dict | None:
        if not result:
            return None
        coords_ok = _check_coords_in_country(
            result["latitude"],
            result["longitude"],
            city_name,
            result.get("full_address"),
        )
        if not coords_ok:
            print(f"[Geocoder] {source_name} coord mismatch: '{location_name}' → ({result['latitude']:.4f}, {result['longitude']:.4f}) outside {city_name}")
            return None

        if result.get("is_exact"):
            print(f"[Geocoder] {source_name} OK: '{location_name}' → ({result['latitude']:.4f}, {result['longitude']:.4f}) [EXACT]")
            geo_cache.set(cache_key, result, ttl=86400)
            return result

        if precise_address_query and _address_tokens_match(location_name, result.get("full_address")):
            print(f"[Geocoder] {source_name} OK: '{location_name}' → ({result['latitude']:.4f}, {result['longitude']:.4f}) [ADDRESS MATCH]")
            result["is_exact"] = True
            result["confidence"] = max(result.get("confidence", 0.5), 0.72)
            geo_cache.set(cache_key, result, ttl=86400)
            return result

        # Accept non-exact results with reasonable confidence (covers non-English queries
        # where free APIs return valid but non-exact results).
        confidence = result.get("confidence", 0)
        if confidence >= 0.5:
            print(f"[Geocoder] {source_name} FUZZY: '{location_name}' → ({result['latitude']:.4f}, {result['longitude']:.4f}) (confidence={confidence})")
            geo_cache.set(cache_key, result, ttl=3600)
            return result

        return None

    # Layer 1: Geoapify (fastest, best POI coverage)
    geoapify_result = await _geocode_geoapify(location_name, city_name=city_name)
    accepted = _accept_result(geoapify_result, "Geoapify")
    if accepted:
        return accepted

    # Layer 2: LocationIQ (fast, free 5k req/day)
    liq_result = await _geocode_locationiq(location_name, city_name=city_name)
    accepted = _accept_result(liq_result, "LocationIQ")
    if accepted:
        return accepted

    # Layer 3: Nominatim (slow, best POI coverage from OSM)
    nominatim_result = await _geocode_nominatim(location_name, city_name=city_name)
    accepted = _accept_result(nominatim_result, "Nominatim")
    if accepted:
        return accepted

    # Layer 4: Photon (OSM-based, complementary coverage, free)
    photon_result = await _geocode_photon(location_name, city_name=city_name)
    accepted = _accept_result(photon_result, "Photon")
    if accepted:
        return accepted

    # Layer 5: Google Maps (best for non-English/Asian locations, $200/mo free credit)
    google_result = await _geocode_google(location_name, city_name=city_name)
    accepted = _accept_result(google_result, "Google")
    if accepted:
        return accepted

    # All geocoders failed — do NOT return any fallback
    return None


def _is_precise_address_query(query: str) -> bool:
    query = (query or "").strip()
    if not query:
        return False
    has_number = any(ch.isdigit() for ch in query)
    has_separator = "," in query
    street_tokens = (" st", " street", " rd", " road", " ave", " avenue", " blvd",
                     " boulevard", " dr", " drive", " ln", " lane", " way", " hwy")
    lowered = f" {query.lower()} "
    has_street = any(token in lowered for token in street_tokens)
    return has_number and (has_separator or has_street)


def _address_tokens_match(query: str, result_address: str | None) -> bool:
    if not result_address:
        return False
    def _normalize_address_text(value: str) -> str:
        lowered = f" {value.lower()} "
        replacements = {
            " plz ": " plaza ",
            " ave ": " avenue ",
            " av ": " avenue ",
            " blvd ": " boulevard ",
            " rd ": " road ",
            " dr ": " drive ",
            " ln ": " lane ",
            " hwy ": " highway ",
            " st ": " street ",
            " ctr ": " center ",
            " ct ": " court ",
            " pkwy ": " parkway ",
            " united states of america ": " united states ",
            " usa ": " united states ",
            " us ": " united states ",
        }
        for source, target in replacements.items():
            lowered = lowered.replace(source, target)
        return " ".join(lowered.split())

    query_lower = _normalize_address_text(query)
    result_lower = _normalize_address_text(result_address)

    query_number = next(("".join(ch for ch in part if ch.isdigit()) for part in query.split() if any(ch.isdigit() for ch in part)), "")
    if query_number and query_number not in result_lower:
        return False

    street_markers = ["street", "road", "avenue", "boulevard", "drive", "lane", "way", "highway", "plaza", "court", "parkway", "center"]
    query_parts = [part.strip(",").lower() for part in query_lower.split()]
    core_tokens = [
        part for part in query_parts
        if len(part) >= 4 and not any(ch.isdigit() for ch in part) and part not in street_markers
    ]
    if not core_tokens:
        return True

    overlap = sum(1 for token in core_tokens[:4] if token in result_lower)
    return overlap >= max(1, min(2, len(core_tokens[:4])))


async def geocode_address_first(
    primary_query: str,
    fallback_query: str | None = None,
    proximity: Optional[tuple[float, float]] = None,
    city_name: Optional[str] = None,
    city_center: Optional[tuple[float, float]] = None,
) -> dict | None:
    primary_result = await geocode(
        primary_query,
        proximity=proximity,
        city_name=city_name,
        city_center=city_center,
    )
    if primary_result:
        if not _is_precise_address_query(primary_query):
            return primary_result
        if _address_tokens_match(primary_query, primary_result.get("full_address")):
            return primary_result
        print(f"[Geocoder] Rejecting weak address match: '{primary_query}' → '{primary_result.get('full_address', '')}'")

    if fallback_query and fallback_query.strip() and fallback_query.strip() != primary_query.strip():
        return await geocode(
            fallback_query,
            proximity=proximity,
            city_name=city_name,
            city_center=city_center,
        )
    return primary_result


async def batch_geocode(
    location_names: list[str | dict],
    proximity: Optional[tuple[float, float]] = None,
    city_name: Optional[str] = None,
    city_center: Optional[tuple[float, float]] = None,
) -> list[dict | None]:

    sem = asyncio.Semaphore(5)

    async def _geocode_one_sem(item: str | dict) -> dict | None:
        async with sem:
            try:
                if isinstance(item, dict):
                    primary_query = item.get("query") or item.get("name") or ""
                    fallback_query = item.get("fallback_query")
                    return await geocode_address_first(
                        primary_query,
                        fallback_query=fallback_query,
                        proximity=proximity,
                        city_name=city_name,
                        city_center=city_center,
                    )
                return await geocode(
                    item, proximity=proximity,
                    city_name=city_name, city_center=city_center,
                )
            except Exception:
                return None

    tasks = [_geocode_one_sem(name) for name in location_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    return [r if isinstance(r, dict) else None for r in results]
