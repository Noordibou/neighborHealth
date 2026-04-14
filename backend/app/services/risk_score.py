"""Composite Housing-Health Risk Score (0–100).

Seven indicators, each normalized to 0–100 using min–max across the cohort, then
weighted-averaged. Weights default to equal (1/7 each) and may be overridden.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Canonical metric keys used across API, DB, and frontend
METRIC_KEYS: tuple[str, ...] = (
    "rent_burden_pct",
    "overcrowding_pct",
    "vacancy_rate",
    "uninsured_pct",
    "asthma_pct",
    "disability_pct",
    "heat_index",
)

DEFAULT_WEIGHTS: dict[str, float] = {k: 1.0 / len(METRIC_KEYS) for k in METRIC_KEYS}


def clamp_weights(weights: dict[str, float] | None) -> dict[str, float]:
    w = dict(DEFAULT_WEIGHTS)
    if not weights:
        return w
    for k in METRIC_KEYS:
        if k in weights and weights[k] is not None:
            w[k] = max(0.0, float(weights[k]))
    total = sum(w.values())
    if total <= 0:
        return dict(DEFAULT_WEIGHTS)
    return {k: w[k] / total for k in METRIC_KEYS}


def _min_max_normalize(values: list[float | None]) -> list[float]:
    nums = [v for v in values if v is not None]
    if not nums:
        return [50.0 for _ in values]
    lo, hi = min(nums), max(nums)
    if hi - lo < 1e-9:
        return [50.0 for _ in values]
    out: list[float] = []
    for v in values:
        if v is None:
            out.append(50.0)
        else:
            out.append((float(v) - lo) / (hi - lo) * 100.0)
    return out


@dataclass
class TractValues:
    geoid: str
    values: dict[str, float | None]


def compute_batch_scores(
    tracts: list[TractValues],
    weights: dict[str, float] | None = None,
) -> dict[str, tuple[float, dict[str, float]]]:
    """Returns geoid -> (composite 0–100, component_scores per metric)."""
    w = clamp_weights(weights)
    if not tracts:
        return {}
    by_metric: dict[str, list[float | None]] = {m: [] for m in METRIC_KEYS}
    geoids_order: list[str] = []
    for t in tracts:
        geoids_order.append(t.geoid)
        for m in METRIC_KEYS:
            by_metric[m].append(t.values.get(m))

    normalized_by_metric: dict[str, list[float]] = {
        m: _min_max_normalize(by_metric[m]) for m in METRIC_KEYS
    }

    result: dict[str, tuple[float, dict[str, float]]] = {}
    for i, geoid in enumerate(geoids_order):
        comp: dict[str, float] = {}
        total = 0.0
        for m in METRIC_KEYS:
            nv = normalized_by_metric[m][i]
            comp[m] = round(nv, 4)
            total += w[m] * nv
        result[geoid] = (round(max(0.0, min(100.0, total)), 4), comp)
    return result


def parse_weight_query(raw: dict[str, Any] | None) -> dict[str, float] | None:
    if not raw:
        return None
    out: dict[str, float] = {}
    for k in METRIC_KEYS:
        if k in raw:
            try:
                out[k] = float(raw[k])
            except (TypeError, ValueError):
                continue
    return out or None
