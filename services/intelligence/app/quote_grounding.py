"""Hallucination guard for /facts/extract: verifies that a model-claimed
quote is really a substring of the source chunk text, and locates its exact
character span in the ORIGINAL (non-normalized) text.

Split into its own module so it can be unit tested directly without going
through the FastAPI route or a live Groq call.
"""
from __future__ import annotations

import re
from typing import Optional

_WHITESPACE_RE = re.compile(r"\s+")


def _normalize_with_map(s: str) -> tuple[str, list[int]]:
    """Collapse runs of whitespace to a single space and strip the ends,
    returning (normalized_string, index_map) where index_map[i] is the
    index in the ORIGINAL string `s` of the character at
    normalized_string[i]."""
    out_chars: list[str] = []
    index_map: list[int] = []
    prev_was_space = True  # start "as if" preceded by space, so leading ws collapses away
    for i, c in enumerate(s):
        if c.isspace():
            if not prev_was_space:
                out_chars.append(" ")
                index_map.append(i)
            prev_was_space = True
        else:
            out_chars.append(c)
            index_map.append(i)
            prev_was_space = False

    # Trim a trailing collapsed space (leading ones were never emitted).
    if out_chars and out_chars[-1] == " ":
        out_chars.pop()
        index_map.pop()

    return "".join(out_chars), index_map


def find_quote_span(chunk_text: str, quote: str) -> Optional[tuple[int, int]]:
    """Locate `quote` inside `chunk_text`. Tries an exact substring match
    first; if that fails, tries a whitespace-normalized match (collapsing
    runs of whitespace to single spaces on both sides) and maps the match
    back to a [start, end) span in the ORIGINAL chunk_text.

    Returns None if the quote cannot be grounded either way.
    """
    if not quote or not quote.strip():
        return None

    idx = chunk_text.find(quote)
    if idx != -1:
        return idx, idx + len(quote)

    norm_chunk, cmap = _normalize_with_map(chunk_text)
    norm_quote, _ = _normalize_with_map(quote)
    if not norm_quote:
        return None

    idx2 = norm_chunk.find(norm_quote)
    if idx2 == -1:
        return None

    start_orig = cmap[idx2]
    end_norm_idx = idx2 + len(norm_quote) - 1
    end_orig = cmap[end_norm_idx] + 1
    return start_orig, end_orig
