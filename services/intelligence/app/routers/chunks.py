"""POST /chunks/build — turn a document's extracted pages into paragraph-
aware chunks of roughly 600-900 estimated tokens, with light overlap so
facts near a chunk boundary aren't lost."""
from __future__ import annotations

import re

from fastapi import APIRouter

from app.schemas import BuildChunksRequest, BuildChunksResponse, BuiltChunk

router = APIRouter()

TARGET_MAX_TOKENS = 900
PARA_SPLIT_RE = re.compile(r"\n\s*\n+")


def _estimate_tokens(text: str) -> int:
    words = len(text.split())
    return max(1, round(words * 1.3))


def _paragraph_units(pages) -> list[dict]:
    """Flatten pages (sorted by page_number) into paragraph units, each with
    its page number and its [start, end) offset in the concatenated
    "\\n\\n"-joined full_text string."""
    sorted_pages = sorted(pages, key=lambda p: p.page_number)
    units: list[dict] = []
    offset = 0

    for i, page in enumerate(sorted_pages):
        page_text = page.text or ""
        search_pos = 0
        for para in PARA_SPLIT_RE.split(page_text):
            idx = page_text.find(para, search_pos)
            if idx == -1:
                idx = search_pos
            para_start_in_page = idx
            para_end_in_page = idx + len(para)
            search_pos = para_end_in_page
            if para.strip():
                units.append(
                    {
                        "page": page.page_number,
                        "text": para,
                        "start": offset + para_start_in_page,
                        "end": offset + para_end_in_page,
                    }
                )
        offset += len(page_text)
        if i != len(sorted_pages) - 1:
            offset += 2  # "\n\n" joiner between pages

    return units


def _group_into_chunks(units: list[dict]) -> list[list[dict]]:
    """Group paragraph units into chunks targeting <= TARGET_MAX_TOKENS
    estimated tokens, carrying the last paragraph of each chunk into the
    next one as overlap."""
    chunks: list[list[dict]] = []
    current: list[dict] = []
    current_tokens = 0

    for unit in units:
        unit_tokens = _estimate_tokens(unit["text"])
        if current and current_tokens + unit_tokens > TARGET_MAX_TOKENS:
            chunks.append(current)
            overlap_unit = current[-1]
            current = [overlap_unit]
            current_tokens = _estimate_tokens(overlap_unit["text"])
        current.append(unit)
        current_tokens += unit_tokens

    if current:
        chunks.append(current)

    return chunks


@router.post("/chunks/build", response_model=BuildChunksResponse)
def build_chunks(req: BuildChunksRequest) -> BuildChunksResponse:
    units = _paragraph_units(req.pages)
    grouped = _group_into_chunks(units)

    chunks: list[BuiltChunk] = []
    for group in grouped:
        text = "\n\n".join(u["text"] for u in group)
        chunks.append(
            BuiltChunk(
                page_start=min(u["page"] for u in group),
                page_end=max(u["page"] for u in group),
                text=text,
                char_start=group[0]["start"],
                char_end=group[-1]["end"],
                token_count=_estimate_tokens(text),
            )
        )

    return BuildChunksResponse(chunks=chunks)
