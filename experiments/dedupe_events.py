#!/usr/bin/env python3
"""
Collapse duplicate rows in dmv-events.json using the app's own place-identity
rule, ported from src/services/place/placeService.ts.

    python3 experiments/dedupe_events.py
    python3 experiments/dedupe_events.py --source usda --write

Only the *fuzzy* half of isSamePlace() is ported — normalized names containing
one another AND coordinates within ~100m. The provider-id half is deliberately
left out; see the note in main() for why applying it here would find nothing.

Read-only by default. Pass --write to overwrite the input with the deduped set.
"""

import json
import os
import re
import sys
from collections import defaultdict

IN_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dmv-events.json")

# Both ported verbatim from placeService.ts — keep them in step with it.
COORD_THRESHOLD = 0.001  # ~100m
_STRIP = re.compile(r"[^a-z0-9\s]")
_SPACES = re.compile(r"\s+")


def normalize_place_name(s):
    """placeService.ts: trim, lowercase, drop punctuation, collapse spaces."""
    if not s:
        return ""
    return _SPACES.sub(" ", _STRIP.sub("", s.strip().lower())).strip()


def is_same_place(a, b):
    """The coordinate-dependent half of isSamePlace().

    Name containment OR coordinate proximity is far too broad on its own —
    "Georgetown" is inside "Georgetown University", and 100m swallows the
    neighbouring shop — so both must hold, exactly as the app requires.
    """
    if a["latitude"] is None or b["latitude"] is None:
        return False

    name_a = normalize_place_name(a["title"])
    name_b = normalize_place_name(b["title"])
    if not name_a or not name_b:
        return False
    name_match = name_a in name_b or name_b in name_a

    coord_match = (
        abs(a["latitude"] - b["latitude"]) < COORD_THRESHOLD
        and abs(a["longitude"] - b["longitude"]) < COORD_THRESHOLD
    )
    return name_match and coord_match


def richness(row):
    """Prefer the survivor that carries the most for a caller to render."""
    return sum(
        1
        for field in ("address", "url", "schedule_text", "image_url", "starts_at")
        if row.get(field)
    )


def dedupe(rows):
    """Greedy single pass: each row joins the first cluster it matches.

    Not transitive-closure clustering — two rows can both match a third
    without matching each other, and merging them anyway is how a chain of
    near-misses swallows genuinely distinct places.
    """
    clusters = []
    for row in rows:
        for cluster in clusters:
            if any(is_same_place(row, member) for member in cluster):
                cluster.append(row)
                break
        else:
            clusters.append([row])

    survivors = []
    for cluster in clusters:
        best = max(cluster, key=richness)
        best = dict(best)
        if len(cluster) > 1:
            best["merged_from"] = [r["id"] for r in cluster if r["id"] != best["id"]]
        survivors.append(best)
    return survivors, clusters


def main():
    argv = sys.argv[1:]
    want_source = None
    for i, arg in enumerate(argv):
        if arg == "--source" and i + 1 < len(argv):
            want_source = argv[i + 1]
    write = "--write" in argv

    with open(IN_PATH, encoding="utf-8") as handle:
        payload = json.load(handle)
    rows = payload["events"]
    if want_source:
        rows = [r for r in rows if r["source"] == want_source]

    # Note on the provider-id half of isSamePlace(): every USDA row has a
    # distinct listing_id from the same source, so that branch would decide
    # "different ids, same provider -> different places" and return before the
    # fuzzy check ever ran. Dedup here has to be coordinate-based, and the same
    # trap waits in the app: storing listing_id as external_place_id would make
    # savePlaces() treat these duplicates as distinct on save.
    by_source = defaultdict(list)
    for row in rows:
        by_source[row["source"]].append(row)

    all_survivors = []
    print(f"{'source':<10} {'before':>7} {'after':>7} {'removed':>8} {'reduction':>10}")
    print("-" * 48)
    for source in sorted(by_source):
        group = by_source[source]
        survivors, clusters = dedupe(group)
        all_survivors.extend(survivors)
        removed = len(group) - len(survivors)
        pct = f"{100 * removed / len(group):.0f}%" if group else "-"
        print(f"{source:<10} {len(group):>7} {len(survivors):>7} {removed:>8} {pct:>10}")

        merged = sorted(
            (c for c in clusters if len(c) > 1), key=len, reverse=True
        )
        for cluster in merged[:12]:
            kept = max(cluster, key=richness)
            print(f"    x{len(cluster)}  kept: {(kept['title'] or '')[:52]}")
            for member in cluster:
                if member["id"] != kept["id"]:
                    print(f"          drop: {(member['title'] or '')[:52]}")
        if len(merged) > 12:
            print(f"    ... and {len(merged) - 12} more merged clusters")

    print("-" * 48)
    before, after = len(rows), len(all_survivors)
    print(f"{'TOTAL':<10} {before:>7} {after:>7} {before - after:>8} "
          f"{100 * (before - after) / before if before else 0:>9.0f}%")

    if write:
        payload["events"] = all_survivors
        payload["count"] = len(all_survivors)
        payload["deduped"] = True
        with open(IN_PATH, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
        print(f"\nwrote {IN_PATH}")
    else:
        print("\n(read-only; pass --write to overwrite dmv-events.json)")


if __name__ == "__main__":
    main()
