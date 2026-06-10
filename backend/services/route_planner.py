"""Route planning using Haversine distance + greedy TSP + 2-opt.

All calculations use great-circle distance (Haversine formula) on the WGS84
ellipsoid approximation, which is sufficient for MVP route ordering.
No external API calls are made — zero cost.
"""

import math
from typing import Optional


EARTH_RADIUS_KM = 6371.0


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Compute great-circle distance between two points in kilometers."""
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_KM * c


def build_distance_matrix(coords: list[dict]) -> list[list[float]]:
    """Build an NxN distance matrix (km) from a list of coordinate dicts.

    Each dict must have keys: latitude, longitude.
    """
    n = len(coords)
    matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            d = haversine(
                coords[i]["latitude"], coords[i]["longitude"],
                coords[j]["latitude"], coords[j]["longitude"],
            )
            matrix[i][j] = d
            matrix[j][i] = d
    return matrix


def _total_distance(order: list[int], dist_matrix: list[list[float]]) -> float:
    """Compute total distance for a given order of indices."""
    total = 0.0
    for i in range(len(order) - 1):
        total += dist_matrix[order[i]][order[i + 1]]
    return total


def greedy_tsp(
    dist_matrix: list[list[float]],
    start_index: int = 0,
) -> list[int]:
    """Greedy nearest-neighbor TSP.

    Args:
        dist_matrix: NxN distance matrix.
        start_index: Index of the starting location.

    Returns:
        List of indices representing the visit order.
    """
    n = len(dist_matrix)
    if n <= 2:
        return list(range(n))

    visited = {start_index}
    order = [start_index]
    current = start_index

    while len(visited) < n:
        # Find nearest unvisited neighbor
        nearest = None
        nearest_dist = float("inf")
        for j in range(n):
            if j not in visited:
                d = dist_matrix[current][j]
                if d < nearest_dist:
                    nearest_dist = d
                    nearest = j
        if nearest is not None:
            visited.add(nearest)
            order.append(nearest)
            current = nearest

    return order


def two_opt_improve(
    order: list[int],
    dist_matrix: list[list[float]],
    max_iterations: int = 100,
) -> list[int]:
    """Improve a TSP route using 2-opt local search.

    Swaps two edges if it reduces total distance. Repeats until no improvement
    or max_iterations reached.
    """
    improved = True
    iteration = 0
    best_order = order[:]
    best_distance = _total_distance(best_order, dist_matrix)

    while improved and iteration < max_iterations:
        improved = False
        iteration += 1
        n = len(best_order)
        for i in range(n - 2):
            for j in range(i + 2, n):
                # Try reversing segment i+1..j
                new_order = best_order[: i + 1] + best_order[i + 1 : j + 1][::-1] + best_order[j + 1 :]
                new_distance = _total_distance(new_order, dist_matrix)
                if new_distance < best_distance:
                    best_order = new_order
                    best_distance = new_distance
                    improved = True
                    break
            if improved:
                break

    return best_order


def plan_route(
    coords: list[dict],
    start_index: int = 0,
    optimize: bool = True,
) -> dict:
    """Plan a shortest-route order through the given coordinates.

    Args:
        coords: List of dicts with keys: name, latitude, longitude.
        start_index: Index of the starting location (default: 0).
        optimize: Whether to apply 2-opt improvement (default: True).

    Returns:
        dict with keys:
          - ordered_locations: list of the same dicts in visit order
          - total_distance_km: total route distance
          - segments: list of {from, to, distance_km}
    """
    if not coords:
        return {
            "ordered_locations": [],
            "total_distance_km": 0.0,
            "segments": [],
        }

    if len(coords) == 1:
        loc = coords[0]
        return {
            "ordered_locations": [loc],
            "total_distance_km": 0.0,
            "segments": [],
        }

    dist_matrix = build_distance_matrix(coords)
    order = greedy_tsp(dist_matrix, start_index=min(start_index, len(coords) - 1))

    if optimize and len(order) > 3:
        order = two_opt_improve(order, dist_matrix)

    ordered_locations = [coords[i] for i in order]
    total_distance = _total_distance(order, dist_matrix)

    segments = []
    for i in range(len(order) - 1):
        segments.append({
            "from_name": coords[order[i]]["name"],
            "to_name": coords[order[i + 1]]["name"],
            "distance_km": round(dist_matrix[order[i]][order[i + 1]], 2),
        })

    return {
        "ordered_locations": ordered_locations,
        "total_distance_km": round(total_distance, 2),
        "segments": segments,
    }
