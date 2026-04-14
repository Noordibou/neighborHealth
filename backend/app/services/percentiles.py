"""Compute national and state percentile ranks for indicator values."""

from __future__ import annotations

from collections import defaultdict


def percentile_rank(sorted_vals: list[float], x: float | None) -> float | None:
    """Percentile rank 0–100 (inclusive), mid-rank method."""
    if x is None or not sorted_vals:
        return None
    n = len(sorted_vals)
    below = sum(1 for v in sorted_vals if v < x)
    equal = sum(1 for v in sorted_vals if v == x)
    return 100.0 * (below + 0.5 * equal) / n if n else None


def compute_percentiles_for_groups(
    rows: list[tuple[str, str, float | None]],
) -> dict[tuple[str, str], tuple[float | None, float | None]]:
    """rows: (geoid, state_fips, value) -> (pct_national, pct_state)."""
    by_value: list[tuple[str, str, float]] = [
        (g, s, float(v)) for g, s, v in rows if v is not None
    ]
    national_sorted = sorted([v for _, _, v in by_value])
    by_state: dict[str, list[float]] = defaultdict(list)
    for _, s, v in by_value:
        by_state[s].append(v)
    state_sorted: dict[str, list[float]] = {s: sorted(vs) for s, vs in by_state.items()}

    out: dict[tuple[str, str], tuple[float | None, float | None]] = {}
    for geoid, state, val in by_value:
        pn = percentile_rank(national_sorted, val)
        ps = percentile_rank(state_sorted.get(state, []), val)
        out[(geoid, state)] = (pn, ps)
    return out
