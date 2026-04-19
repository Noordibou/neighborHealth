"""Unit tests for Census geocoder JSON parsing (no network)."""

from app.services.census_geocode import parse_geographies_response


def test_parse_dc_white_house_sample():
    data = {
        "result": {
            "addressMatches": [
                {
                    "matchedAddress": "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20502",
                    "coordinates": {"x": -77.03518753691, "y": 38.89869893252},
                    "geographies": {
                        "Census Tracts": [
                            {
                                "GEOID": "11001980000",
                                "NAME": "Tract 9800",
                            }
                        ]
                    },
                }
            ]
        }
    }
    matched, lon, lat, gid = parse_geographies_response(data)
    assert matched is not None
    assert lon is not None and lat is not None
    assert gid == "11001980000"


def test_parse_no_matches():
    data = {"result": {"addressMatches": []}}
    assert parse_geographies_response(data) == (None, None, None, None)
