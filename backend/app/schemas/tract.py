from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class IndicatorOut(BaseModel):
    source: str
    metric_name: str
    value: float | None
    year: int
    percentile_national: float | None = None
    percentile_state: float | None = None


class RiskScoreOut(BaseModel):
    geoid: str
    year: int
    composite_score: float
    component_scores: dict[str, float] | None = None
    weights_used: dict[str, float] | None = None
    computed_at: str | None = None


class TractSummary(BaseModel):
    geoid: str
    name: str | None = None
    state_fips: str
    county_fips: str
    county_name: str | None = None
    place_name: str | None = None
    urban_rural: str | None = None
    composite_score: float | None = None
    year: int | None = None


class TractDetail(TractSummary):
    centroid_lat: float | None = None
    centroid_lon: float | None = None
    indicators: list[IndicatorOut] = Field(default_factory=list)
    risk_score: RiskScoreOut | None = None


class TractListResponse(BaseModel):
    items: list[TractSummary]
    total: int


class TractScoreDetail(BaseModel):
    geoid: str
    year: int
    composite_score: float
    component_scores: dict[str, float]
    weights_used: dict[str, float]


class AISummaryOut(BaseModel):
    geoid: str
    summary_text: str
    generated_at: str
    model_version: str


class CompareResponse(BaseModel):
    geoids: list[str]
    year: int | None
    indicators: list[str]
    series: list[dict[str, Any]]
    raw_indicators: dict[str, list[IndicatorOut]]


class StateOut(BaseModel):
    state_fips: str
    state_name: str
    tract_count: int


class SearchResult(BaseModel):
    geoid: str
    name: str | None
    state_fips: str
    county_name: str | None
    composite_score: float | None


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]


class PDFExportRequest(BaseModel):
    geoid: str
    include_map: bool = True


class PDFExportResponse(BaseModel):
    job_id: str
    message: str
    download_url: str | None = None


class UserCreate(BaseModel):
    email: str
    password: str = Field(min_length=8)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SavedViewCreate(BaseModel):
    name: str
    geoids: list[str] = Field(min_length=1, max_length=50)
    filters: dict | None = None


class SavedViewOut(BaseModel):
    id: int
    name: str
    geoids: list[str]
    filters: dict | None = None
