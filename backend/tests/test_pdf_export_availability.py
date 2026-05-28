"""PDF export probes WeasyPrint without importing it at module load."""

from __future__ import annotations

from app.services import pdf_export


def test_weasyprint_available_is_bool(monkeypatch):
    monkeypatch.setattr(pdf_export, "_WEASYPRINT_AVAILABLE", None)
    assert isinstance(pdf_export.weasyprint_available(), bool)
