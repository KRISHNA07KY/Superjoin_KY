"""POST /pages/extract — open a PDF with PyMuPDF and extract text per page,
falling back to OCR only for pages where native extraction looks unreliable.
"""
from __future__ import annotations

import logging

import fitz  # PyMuPDF
import ftfy
from fastapi import APIRouter

from app.schemas import ExtractedPage, ExtractPagesRequest, ExtractPagesResponse

logger = logging.getLogger("groundwork.pages")

router = APIRouter()

# Below this native-text word-density threshold (words per 10,000 px^2 of
# page area) we suspect the page is a scanned image and needs OCR.
MIN_WORD_DENSITY = 0.6
# A page whose page.get_text("dict") blocks are almost entirely images (and
# has little/no text) is also a strong signal for OCR.
MIN_IMAGE_AREA_FRACTION_FOR_OCR = 0.5


def _looks_like_scan(page: "fitz.Page", native_text: str) -> bool:
    """Heuristic: decide whether a page needs OCR instead of trusting its
    native text layer. We do NOT OCR every page — only ones where native
    extraction looks unreliable (near-empty text, or the page is dominated
    by image blocks with little accompanying text)."""
    stripped = native_text.strip()
    page_area = max(page.rect.width * page.rect.height, 1.0)
    word_count = len(stripped.split())
    word_density = word_count / (page_area / 10_000.0)

    if word_density < MIN_WORD_DENSITY:
        # Very little native text relative to page size — check if it's
        # because the page is mostly a big image (typical of scans).
        try:
            raw = page.get_text("dict")
            blocks = raw.get("blocks", [])
            image_area = 0.0
            for b in blocks:
                if b.get("type") == 1:  # image block
                    bbox = b.get("bbox", (0, 0, 0, 0))
                    w = max(bbox[2] - bbox[0], 0)
                    h = max(bbox[3] - bbox[1], 0)
                    image_area += w * h
            image_fraction = image_area / page_area
        except Exception:
            image_fraction = 0.0

        if image_fraction >= MIN_IMAGE_AREA_FRACTION_FOR_OCR or word_count == 0:
            return True
        # Sparse text but not clearly image-dominated: still treat very low
        # density as OCR-worthy, since it usually means extraction failed.
        return word_density < MIN_WORD_DENSITY

    return False


def _ocr_page(page: "fitz.Page") -> tuple[str, float | None, bool]:
    """Attempt OCR on a page. Returns (text, avg_confidence_0_1_or_None,
    ocr_available). If pytesseract / the Tesseract binary isn't available,
    ocr_available=False and callers should fall back to native text."""
    try:
        import pytesseract
        from pytesseract import Output
    except ImportError:
        logger.warning("pytesseract is not installed; skipping OCR.")
        return "", None, False

    try:
        pix = page.get_pixmap(dpi=200)
        img_bytes = pix.tobytes("png")
        from io import BytesIO

        from PIL import Image

        image = Image.open(BytesIO(img_bytes))

        text = ftfy.fix_text(pytesseract.image_to_string(image))

        data = pytesseract.image_to_data(image, output_type=Output.DICT)
        confidences = [
            float(c) for c in data.get("conf", []) if c not in ("-1", -1) and float(c) >= 0
        ]
        avg_conf = (sum(confidences) / len(confidences) / 100.0) if confidences else None
        return text, avg_conf, True
    except Exception as exc:
        # Covers TesseractNotFoundError and any other runtime failure —
        # a missing/broken system Tesseract binary must never crash the
        # endpoint, just fall back gracefully.
        logger.warning("OCR unavailable or failed (%s); falling back to native text.", exc)
        return "", None, False


@router.post("/pages/extract", response_model=ExtractPagesResponse)
def extract_pages(req: ExtractPagesRequest) -> ExtractPagesResponse:
    doc = fitz.open(req.path)
    pages: list[ExtractedPage] = []

    try:
        for i in range(doc.page_count):
            page = doc.load_page(i)
            # Some PDFs (common with embedded/legacy fonts in Indian financial
            # filings) yield mojibake for non-ASCII glyphs like ₹ or curly
            # quotes when PyMuPDF decodes them — ftfy detects and reverses
            # that encoding mismatch rather than leaving corrupted text in
            # facts/evidence quotes.
            native_text = ftfy.fix_text(page.get_text() or "")

            if _looks_like_scan(page, native_text):
                ocr_text, ocr_conf, ocr_available = _ocr_page(page)
                if ocr_available and ocr_text.strip():
                    pages.append(
                        ExtractedPage(
                            page_number=i + 1,
                            extraction_method="ocr",
                            text=ocr_text,
                            confidence=ocr_conf,
                            layout=None,
                        )
                    )
                    continue
                if not ocr_available and native_text.strip():
                    logger.info(
                        "Page %d looked like a scan but OCR is unavailable; "
                        "returning sparse native text instead.",
                        i + 1,
                    )
                    pages.append(
                        ExtractedPage(
                            page_number=i + 1,
                            extraction_method="native",
                            text=native_text,
                            confidence=None,
                            layout=None,
                        )
                    )
                    continue
                if native_text.strip():
                    # OCR ran but produced nothing useful; fall back to
                    # whatever sparse native text exists.
                    pages.append(
                        ExtractedPage(
                            page_number=i + 1,
                            extraction_method="native",
                            text=native_text,
                            confidence=None,
                            layout=None,
                        )
                    )
                    continue
                # Both native and OCR produced nothing usable.
                pages.append(
                    ExtractedPage(
                        page_number=i + 1,
                        extraction_method="failed",
                        text="",
                        confidence=None,
                        layout=None,
                    )
                )
            else:
                pages.append(
                    ExtractedPage(
                        page_number=i + 1,
                        extraction_method="native",
                        text=native_text,
                        confidence=None,
                        layout=None,
                    )
                )
    finally:
        doc.close()

    return ExtractPagesResponse(pages=pages, page_count=len(pages))
