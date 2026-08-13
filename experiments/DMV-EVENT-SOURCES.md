# DMV Event Data Sources — Feed Survey

Research only. No code, no dependency added. Surveyed 2026-08-10.

Scope: DC + Maryland + Northern Virginia. Question being answered: which event
sources expose a machine-readable feed we could actually ship against, and can
we sort results by distance rather than by city.

## Read this first

**Almost nothing gives you usable coordinates.** That is the finding that
shapes the whole design, and it is the opposite of what the field list
suggests. Three sources return real lat/lng you can trust: farmers markets
(USDA), park events (NPS — added in the second pass, see §6), and Ticketmaster,
which forbids commercial use.

Everything else gives you a venue name and, if you are lucky, a street
address. **Budget for a geocoding pass as a first-class part of this feature,
not a fallback.** The good news is the app already has the pieces — the
backend's Mapbox Search Box client resolves a name + address to coordinates,
and `places` already stores `external_place_id`/`external_source`, so a
geocoded venue can be deduped against saved places with `isSamePlace()`.

**Confidence column is load-bearing.** `probed` means I called the endpoint
during this survey and read the response. `docs` means I read the provider's
own documentation but did not call it. `unverified` means I could not confirm
it — several venue sites refused or timed out on automated requests, which is
itself a signal about scraping them.

---

## 1. Ticketing platforms

| Source | Endpoint | Format | Key | Commercial | Coords | Confidence |
|---|---|---|---|---|---|---|
| **Ticketmaster Discovery** | `developer.ticketmaster.com` Discovery API v2 | JSON | Yes, free signup | **Prohibited** | **Yes, venue lat/lng** | docs + terms fetched |
| **Eventbrite** | — | — | — | — | — | **Dead for our purpose** |
| **DICE** | `partners-endpoint.dice.fm/graphql` | GraphQL | Partner token | Partner agreement | Unknown | docs |

### Ticketmaster — the trap

Technically the best source in this entire survey. It covers Live Nation
venues, which in the DMV means **The Anthem, Fillmore Silver Spring, and most
of the arena/amphitheatre tier**, and it returns venue `location.latitude` /
`location.longitude` directly. Radius search is a first-class parameter.

Then the terms of use say, verbatim, that you shall not

> derive revenues from the use or provision of the Ticketmaster API, whether
> for direct commercial or monetary gain or otherwise

and separately restrict storing event content "other than for reasonable
periods in order to provide the service you are providing" — which rules out
building our own event index off it.

For a class project or a demo this is fine. For anything that later takes
money, it is a licensing conversation with Ticketmaster, not a code change.
**Do not let it become load-bearing without deciding that first.**

### Eventbrite — do not plan around it

Eventbrite **removed public event search on 2019-12-12** and began denying
requests to `GET /v3/events/search/` on 2020-02-20. The current API only
manages events belonging to your own organisation. It is not an event
directory and cannot be used for discovery. Any tutorial or blog post
suggesting otherwise predates the shutdown.

### DICE

GraphQL, but the endpoint is the **Ticket Holders** partner API — it queries
*your own* events with a partner token from their MIO console. There is no
public discovery endpoint. Relevant only if a venue partner grants access.
Third-party scraper services exist; they are scrapers, with the terms and
fragility that implies.

---

## 2. Universities

Five of the six run a recognisable calendar platform. **I probed each one.**

| School | Host | Platform | Feed | Coords | Confidence |
|---|---|---|---|---|---|
| **GWU** | `calendar.gwu.edu` | Localist | `/api/2/events` JSON | Field present, **~22% populated** | probed |
| **Howard** | `events.howard.edu` | Localist | `/api/2/events` JSON | Field present, **~19% populated** | probed |
| **Georgetown** | `guevents.georgetown.edu` | **LiveWhale** | `/live/json/events`, also ical + rss | Unknown | probed (platform), docs (feed) |
| **George Mason** | `calendar.gmu.edu` | Drupal | Not found | Unknown | probed — no Localist |
| **UMD** | `calendar.umd.edu` | Not Localist | Not found | Unknown | probed — 404 on `/api/2/events` |
| **American** | `american.edu/calendar` | Blocks automated requests (403) | Not found | Unknown | probed — inconclusive |

### The Localist coordinate problem — measured, not guessed

GWU and Howard both serve the standard Localist v2 API, no key, CORS-friendly,
clean JSON. Each event carries a `geo` object shaped exactly right:

```
geo: { latitude, longitude, street, city, state, country, zip }
```

I sampled 100 events over a 60-day window from each:

| | GWU | Howard |
|---|---|---|
| lat/lng populated | **22%** | **19%** |
| location name | 51% | 95% |
| street address | 22% | 19% |
| photo_url | 100% | 100% |
| ticket_url | 29% | 4% |

So the schema promises coordinates and delivers them on roughly **one event in
five**. The rest are campus events with a room name (`Locke Hall`, `Mackey
Building`) or nothing at all. Sorting these by distance without a geocoding
step would silently drop 80% of the feed.

Mitigation worth testing: campus buildings are a small, closed set. Geocoding
`location_name + campus address` once and caching per building would likely
lift coverage a long way, far more cheaply than geocoding per event.

`photo_url` at 100% is genuinely useful — that is better imagery coverage than
our own saved places get from Wikipedia.

### Georgetown / LiveWhale

Different vendor, comparable shape. LiveWhale emits `json`, `ical`, and `rss`;
the JSON lives at `/live/json/events`, with a v2 at `/live/json/v2/events` on
recent installs. I confirmed the platform from the page's generator meta tag
but did not get a parsed payload, so **treat the field list as unverified** —
in particular I have not confirmed whether it carries coordinates.

### GMU, UMD, American

None of these is Localist. GMU and UMD are Drupal-ish and their calendar pages
render client-side, so the feed URL is not discoverable from the initial HTML;
American returns 403 to automated requests entirely. Each needs a manual look
in a browser's network tab — 10 minutes each, not something to guess at.

---

## 3. Venues

**This section is the weakest and I want to be blunt about it.** Every one of
these sites either timed out or stalled under automated requests during the
survey, so I have no probed data. What follows is inference from ticketing
platform, not verified feeds.

| Venue | Likely route | Coords | Confidence |
|---|---|---|---|
| **The Anthem** | Live Nation → Ticketmaster Discovery | Yes, via TM | inference |
| **Fillmore Silver Spring** | Live Nation → Ticketmaster Discovery | Yes, via TM | inference |
| **9:30 Club** | **Dead end — see below** | — | **probed** |
| **Kennedy Center** | Own box office; no public API found | Unknown | unverified |
| **Strathmore** | Own box office | Unknown | unverified |
| **Wolf Trap** | **Covered by NPS — see §6** | **Yes** | **probed** |

### I.M.P. — settled, do not re-open

The earlier draft called 9:30 Club "the highest-value single site to check by
hand" because 9:30 Club, The Anthem, and Lincoln Theatre share an operator.
**Checked. It does not pay off.**

- Both `930.com` and `theanthemdc.com` are WordPress with `/wp-json/` open.
- 9:30 Club exposes a custom post type `930_event` at
  `/wp-json/wp/v2/930_event` — and it returns `x-wp-total: 0`. Not restricted,
  not paginated wrong: empty.
- The Anthem exposes no custom post type at all.
- The `schema.org` JSON-LD idea does not rescue it either. Both sites carry
  exactly one `ld+json` block and it is Yoast's `WebPage`/`BreadcrumbList`/
  `WebSite` graph. **No `Event` node on either site.** The 600KB homepage
  contains no inline event JSON, so the calendar is rendered client-side.

Getting I.M.P. listings means a headless browser, with everything that
implies. The JSON-LD shortcut is not available here.

---

## 4. Government, civic, cultural

| Source | Status | Coords | Confidence |
|---|---|---|---|
| **Events DC** | No developer feed found | — | unverified |
| **Montgomery County** | Open data portal + GIS hub (ArcGIS: GeoServices/WMS/WFS) | GIS layers yes; **events feed not found** | docs |
| **Arlington County** | Open data portal `data.arlingtonva.us` | Not found for events | docs |
| **Smithsonian** | `si.edu/events` returns **403 to automated requests**, no `ld+json` | — | **probed — dead** |
| **Destination DC** (`washington.org`) | Simpleview CMS; **zero `@type: Event`** in the page | — | **probed — dead** |
| **Libraries** (DCPL, MCPL, Arlington) | Not probed | — | unverified |

Notes that matter:

- Both county open-data portals are real and well-built, but what they publish
  is **GIS and administrative data, not event calendars**. The presence of an
  open data portal is not evidence of an events API, and I found none.
- **Smithsonian Open Access** is frequently mistaken for an events API. It is a
  *collections* API — objects, not programming. The events calendar at
  `si.edu/events` did not surface a public feed. Given Smithsonian venues are
  probably the single most valuable DMV event source for a travel app, this is
  worth a manual dig rather than accepting my null result.
- Public libraries very often run **LibCal (Springshare)** or **Communico**,
  both of which have documented APIs and iCal output. I did not get to probing
  which. If any of the three uses LibCal, that is one integration for many
  branches, and branch addresses are a small fixed set that geocodes once.

---

## 5. Farmers markets — USDA

| Field | Value |
|---|---|
| Endpoint | `https://www.usdalocalfoodportal.com/api/farmersmarket/` |
| Format | JSON REST — `{"data": [...]}` |
| Key | Required, free — apply to USDA. Param is `apikey`, not `api_key` |
| Commercial | Federal open data; verify the portal's own terms before shipping |
| **Coords** | **Yes, 100% populated — plus a server-computed `distance` in miles** |
| **Hours** | **None. Not in this API, not anywhere else in the source — see below** |
| Confidence | probed — 237 DMV markets fetched |

**Gotcha that costs an hour if you hit it cold:** the host returns a bare
118-byte HTML `403` to non-browser user agents — identical with a valid key,
an invalid one, or none at all, so a working key looks like a rejected one.
Send a normal browser UA. Absent fields also arrive as the **string `'None'`**
rather than null, and coordinates arrive as strings.

**The best-shaped source in this survey for our actual requirement.** It is the
only one that both carries real coordinates and lets you query by radius
server-side, which is exactly the distance-first model the app wants. Coverage
is national (7,800+ markets), so the DMV subset comes free.

Caveat: markets are **recurring schedules**, not one-off events — "Saturdays,
9–1, May through October" — so the data model is a season plus a weekly
pattern, not a `startDate`. That is a different shape from every other source
here and will not drop into a shared `Event` type without thought.

### Follow-up: USDA has no opening hours, anywhere. Verified.

Chased this specifically because "market with no time" is barely a listing.
Four things checked, all negative:

1. **List API** (`/api/farmersmarket/`) returns 27 fields. No hours, no season
   dates, no day-of-week.
2. **Official docs** confirm the only query parameters are locational —
   `state`, `zip`, `zip+radius`, `city+state`, `x/y/radius`. There is **no
   fetch-by-id and no way to widen the field set**.
3. **Listing detail pages** (`/fe/flisting?lid=…`) are a pure client-side
   shell — all five sampled markets returned a byte-identical 23,105-byte
   document with zero listing-specific content.
4. **Undocumented endpoint found**: `/api/listinginfo/?lid=…&directory_type=…`
   is what that page calls, and it **needs no API key**. It returns 19 fields,
   several as pre-rendered HTML fragments rather than data. Still no schedule
   field. Across Dupont Circle, White House, 14&U, Foggy Bottom, and
   Georgetown, `listing_desc`, `seasonproducts`, and `profile` are all empty
   or the literal `'None'`, and no real time string appears in any payload.

The operators' own sites are not a quick substitute either: freshfarm.org
renders client-side and ships no `schema.org` JSON-LD, so hours are not in the
HTML there either.

**Conclusion: from USDA we can show a market's location but not when it is
open.** Getting hours means either a headless browser against operator sites,
or per-operator integrations.

Per-operator is less hopeless than it sounds, because the operators are
concentrated. Of the 82 markets within 5 miles of the Mall, **35% are
FRESHFARM** — one integration would cover a third of the useful set, and a
higher share of the ones a visitor would actually go to.

### The data.gov export is not a way around it either — checked

An earlier draft of this note suggested the older **National Farmers Market
Directory** export on data.gov might still carry `Season1Date` / `Season1Time`
columns and supply the field the API omits. **That was wrong on both counts**,
and it was written from memory of an older USDA dataset rather than from the
records themselves. What the records actually show:

- Both `national-farmers-market-directory` and
  `farmers-markets-directory-and-geographic-data` were **last updated
  2014-12-23**, nearly twelve years ago.
- Neither description mentions season dates, times, or hours. The geographic
  one lists only "longitude and latitude, state, address, name, and zip code".
  There is no evidence in these records that the hours columns were ever part
  of this export.
- The only downloadable resource, an AMS Excel file, **404s**. The other
  dataset's sole "resource" is a link to a web page, not data.
- The old portal those point at, `search.ams.usda.gov/farmersmarkets/`, no
  longer serves a valid TLS certificate.
- The current AMS Local Food Directories page offers no bulk export at all —
  its only data link points back to `usdalocalfoodportal.com`, the same API
  already surveyed above.

So there is no second USDA channel. Four independent paths — list API,
undocumented `listinginfo`, the rendered listing page, and the data.gov
exports — all end without opening hours. Treat that as settled rather than
re-checking it.

### Where that leaves market hours

Two options, and they are not close in cost:

**Ship location only.** 237 markets, 100% coordinate coverage, and the server
even returns distance from the query point. "What's near me" works completely;
"is it open right now" is simply not answerable from this source.

**Integrate per operator.** Of the 82 markets within 5 miles of the Mall, 35%
are FRESHFARM — one operator covers a third of the ones a visitor would
plausibly walk to. But freshfarm.org renders client-side and ships no
`schema.org` JSON-LD, so this means a headless browser, not an HTTP fetch.

Recommendation: **location first, hours as a separate piece of work.** The
coordinates are clean and immediately useful; pulling in headless rendering to
recover one field is a large increase in fragility for a small increase in
value.

---

## 6. National Park Service — missed by the first pass

**This survey originally had no NPS row at all, and that was its biggest
omission.** It is the second-best source here after USDA, and unlike USDA it
carries real dated events.

| Field | Value |
|---|---|
| Endpoint | `https://developer.nps.gov/api/v1/events` |
| Format | JSON REST — `{"total", "data": [...]}` |
| Key | Required, free, instant self-service signup |
| Commercial | Federal open data, no restriction |
| **Coords** | **Yes on ~66%; the rest fill from `/parks` by `sitecode`** |
| **Dates** | **Yes — `dates[]` expands recurrences into concrete days, plus `times[]`** |
| Confidence | probed — 233 unique DMV events fetched |

Why it matters for a travel app: it covers the National Mall, Rock Creek,
Great Falls, Harpers Ferry, Antietam, Fort McHenry, and Wolf Trap — the civic
and outdoor tier nothing else in this survey reaches. Real examples pulled
during the probe: a Netherlands Carillon concert, a Big Band and swing dance
at Fort Hunt, a square dance at Peirce Mill, stargazing in Rock Creek, and
250th-anniversary programming.

43 fields per event. `images[]` (58% populated) are site-relative paths needing
an `nps.gov` prefix. `isfree` is populated on 90%.

### The pagination bug — the thing that will waste your afternoon

**`/events` silently ignores the `start` parameter.** A
`stateCode=DC,MD,VA` query reports `total: 423` and returns the same first 50
rows for every value of `start`. Paging looks like it works and quietly gives
you duplicates.

The way round it is **one request per `parkCode`**. No single DMV park unit has
more than a page of events, so per-park queries retrieve everything: 233 unique
against the 50 a state query can reach. Chunking several parks per request is
not enough — a six-park chunk hit the cap too.

`stateCode` is a bad filter for a distance-first app anyway: Virginia reaches
Blue Ridge Parkway and Cumberland Gap, five hours out. Enumerate the park codes.

### Second quirk: `/parks` does not decode `%2C`

A comma-separated `parkCode` list must reach the host as a literal comma. Most
HTTP clients percent-encode it, and the host then treats the whole string as
one park code and returns **a single record**. Verified: 16 codes with literal
commas returns 16 parks; the same request with `%2C` returns 1. It looks like a
working request that found little, not like an error.

`/parks` is worth the trouble — it carries `images[]` on 100% of parks, which
covers the 40% of events that ship no photo of their own.

### Quality caveat

Roughly two thirds are `Regular Event` — routine ranger programming, some of it
daily ("Chicken Feeding"). `category == "Special Event"` is the provider's own
editorial signal and is the right thing to surface. Also note that expanding
`dates[]` into every occurrence lets one daily programme fill a list; take the
next occurrence per series instead.

---

## Recommendation

**Tier 1 — start here.** USDA plus **NPS**. Both are US federal open data with
free keys and no commercial restriction, and between them they exercise both
hard parts of the problem: recurring schedules with no hours (USDA) and partial
coordinates with real dates (NPS).

**Localist is Tier 1 on paper only.** GWU and Howard serve clean, keyless JSON,
but the content is campus orientation and internal programming — the 22%
coordinate coverage is the smaller problem. Not useful for a travel app.

**No free feed carries DMV festivals.** The Renaissance Festival, Cherry
Blossom, Fiesta DC, Artscape — each lives only on its own client-rendered site.
A curated file is the honest answer for that tier, and it is what
`backend/services/events_service/data/dmv_signature_events.json` is.

**Tier 2 — remaining unknowns.** Whichever library system runs LibCal, and
Georgetown's LiveWhale (likely 20 minutes since the platform is confirmed).

**Tier 3 — decide the licence before the code.** Ticketmaster. It is the only
source that solves the commercial venue tier properly and the only one whose
terms say you may not make money from it. That is a product decision, not an
engineering one, and it should be made before anyone wires it up.

**Do not pursue.** Eventbrite discovery — it does not exist. DICE without a
partner relationship. I.M.P. and Smithsonian without a headless browser.

## Open questions for the next pass

1. Does LiveWhale carry coordinates? Settles Georgetown.
2. ~~Do the venue sites carry `schema.org/Event` JSON-LD?~~ **Answered: no.**
   9:30 Club, The Anthem, Smithsonian, and washington.org were all checked and
   none carries an `Event` node. See §3 and §4.
3. Can building-level geocoding lift Localist's coordinate coverage to
   something usable? This determines whether campus events are viable at all.
   Measured at 26% over a 7-day window, and the gap is not geocodable from the
   payload — the rows missing coordinates are also missing a street address,
   so they carry only a building name.
4. What is USDA's actual redistribution term? "Federal open data" is an
   assumption I did not verify.
5. Is there a DMV-wide aggregator worth using instead of six integrations?
   Not surveyed.

Settled since the first draft, do not re-open: USDA has no opening hours by
any route; the data.gov exports are dead (2014, 404); I.M.P. and Smithsonian
carry no `Event` JSON-LD and need a headless browser; and NPS `/events` cannot
be paged with `start` — query one `parkCode` at a time.

## Sources

- [Eventbrite v3 Search API deprecation](https://github.com/Automattic/eventbrite-api/issues/83) · [Eventbrite Platform changelog](https://www.eventbrite.com/platform/docs/changelog)
- [Ticketmaster Discovery API v2](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) · [Ticketmaster developer terms of use](https://developer.ticketmaster.com/support/terms-of-use/)
- [DICE partner GraphQL API](https://partners-endpoint.dice.fm/graphql/docs/index.html)
- [Localist API documentation](https://developer.localist.com/doc/api) · [Concept3D Localist API](https://help.concept3d.com/hc/en-us/articles/11940613344915-Localist-API)
- [LiveWhale JSON API](https://support.livewhale.com/live/blurbs/json-api) · [LiveWhale for developers](https://www.livewhale.com/docs/calendar/for-developers/)
- [USDA Local Food Directories data sharing](https://www.usdalocalfoodportal.com/fe/datasharing/) · [USDA National Farmers Market Directory](https://www.ams.usda.gov/local-food-directories/farmersmarkets)
- [data.gov: National Farmers Market Directory](https://catalog.data.gov/dataset/national-farmers-market-directory) · [data.gov: Farmers Markets Directory and Geographic Data](https://catalog.data.gov/dataset/farmers-markets-directory-and-geographic-data) — both last updated 2014-12-23, resources dead
- [Montgomery County open data](https://data.montgomerycountymd.gov/) · [Montgomery County GIS hub](https://opendata-mcgov-gis.hub.arcgis.com/) · [Arlington County open data](https://data.arlingtonva.us/)
- [Smithsonian events](https://www.si.edu/events)

Probed directly during this survey: `calendar.gwu.edu`, `events.howard.edu`,
`guevents.georgetown.edu`, `calendar.gmu.edu`, `events.gmu.edu`,
`calendar.umd.edu`, `american.edu`.
