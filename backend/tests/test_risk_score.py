from app.services.risk_score import METRIC_KEYS, TractValues, clamp_weights, compute_batch_scores


def test_equal_weights_composite_midrange():
    tracts = [
        TractValues(
            geoid="01",
            values={k: 50.0 for k in METRIC_KEYS},
        ),
        TractValues(
            geoid="02",
            values={k: 0.0 for k in METRIC_KEYS},
        ),
        TractValues(
            geoid="03",
            values={k: 100.0 for k in METRIC_KEYS},
        ),
    ]
    out = compute_batch_scores(tracts)
    assert out["01"][0] > 40 and out["01"][0] < 60


def test_custom_weights():
    w = {k: 0.0 for k in METRIC_KEYS}
    w["asthma_pct"] = 1.0
    tracts = [
        TractValues(geoid="a", values={k: (100.0 if k == "asthma_pct" else 0.0) for k in METRIC_KEYS}),
        TractValues(geoid="b", values={k: 0.0 for k in METRIC_KEYS}),
    ]
    out = compute_batch_scores(tracts, w)
    assert out["a"][0] > out["b"][0]


def test_clamp_weights_normalizes():
    w = {k: 2.0 for k in METRIC_KEYS}
    cw = clamp_weights(w)
    assert abs(sum(cw.values()) - 1.0) < 1e-6
