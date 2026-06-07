"""Map GeoJSON helpers — JSONB can arrive as str from some query paths."""

from app.api.map_layer import _component_scores_as_dict


def test_component_scores_as_dict_from_json_string():
    raw = '{"rent_burden_pct": 12.5, "uninsured_pct": 88.0}'
    d = _component_scores_as_dict(raw)
    assert d == {"rent_burden_pct": 12.5, "uninsured_pct": 88.0}


def test_component_scores_as_dict_from_dict():
    raw = {"a": 1.0}
    assert _component_scores_as_dict(raw) == {"a": 1.0}


def test_component_scores_as_dict_none_and_garbage():
    assert _component_scores_as_dict(None) is None
    assert _component_scores_as_dict("[]") is None
    assert _component_scores_as_dict("") is None
