"""Thin wrapper around the Groq chat-completions API used by every LLM-backed
endpoint in this service. Centralizes client construction plus the
parse-json-with-one-repair-retry logic so routers don't duplicate it.
"""
from __future__ import annotations

import json
import logging
import time
from functools import lru_cache
from typing import Any, Optional

from groq import BadRequestError, Groq, RateLimitError

from app.config import get_settings
from app.llm_errors import LLMCallError

logger = logging.getLogger("groundwork.groq")

# A TPM (tokens-per-minute) limit is a rolling per-minute window — waiting it
# out is usually only a matter of seconds and worth doing automatically
# during a long batch job. A TPD (tokens-per-day) limit reported a multi-
# minute wait in practice (observed: 19+ minutes) — blocking a single chunk's
# HTTP request that long would stall the whole pipeline for no good reason,
# so only short waits are retried; anything longer fails fast with a clear
# error instead.
MAX_RATE_LIMIT_WAIT_SECONDS = 20


# Kept as a name for backwards compatibility with existing imports — Groq's
# specific errors all raise the shared LLMCallError so callers that want to
# handle "any provider failed" in one place (e.g. /answer/plan, which can
# be routed to Groq or Gemini) can catch just LLMCallError.
GroqCallError = LLMCallError


@lru_cache
def get_groq_client() -> Groq:
    settings = get_settings()
    return Groq(api_key=settings.groq_api_key)


def _extract_json(raw: str) -> Optional[dict]:
    """Best-effort parse of a JSON object out of a model response."""
    if not raw:
        return None
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Some models wrap JSON in ```json ... ``` fences despite instructions.
    if "```" in raw:
        fenced = raw.split("```")
        for part in fenced:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{") or part.startswith("["):
                try:
                    return json.loads(part)
                except json.JSONDecodeError:
                    continue
    # Fall back to slicing between the first { and the last }.
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def _is_json_mode_validation_error(exc: BadRequestError) -> bool:
    try:
        return exc.body.get("error", {}).get("code") == "json_validate_failed"  # type: ignore[union-attr]
    except Exception:
        return "json_validate_failed" in str(exc)


def _complete(
    client: Groq, model_name: str, messages: list[dict], temperature: float, max_tokens: int,
    reasoning_effort: Optional[str] = None,
) -> str:
    """Request a JSON response, preferring Groq's constrained json_object
    mode. Observed in practice: for some inputs (a dense, chart-heavy
    earnings-deck slide reliably reproduced this) Groq's own json_object-mode
    validator rejects the request outright with `json_validate_failed` and an
    empty `failed_generation` — a platform-side limitation independent of
    prompt wording, confirmed by testing the same content with a much
    simpler system prompt and still hitting it. Falling back to an
    unconstrained completion and parsing the JSON ourselves (`_extract_json`
    already handles markdown-fenced and prose-wrapped JSON) recovers cleanly
    from exactly this case instead of losing the chunk entirely.
    """
    extra = {"reasoning_effort": reasoning_effort} if reasoning_effort else {}

    def _attempt() -> str:
        try:
            resp = client.chat.completions.create(
                model=model_name,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            )
            return resp.choices[0].message.content or ""
        except BadRequestError as exc:
            if not _is_json_mode_validation_error(exc):
                raise
            logger.warning("Groq json_object mode rejected this request; retrying unconstrained")
            resp = client.chat.completions.create(
                model=model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            )
            return resp.choices[0].message.content or ""

    for attempt in range(2):
        try:
            return _attempt()
        except RateLimitError as exc:
            retry_after = None
            try:
                retry_after = int(float(exc.response.headers.get("retry-after", "")))
            except (ValueError, TypeError, AttributeError):
                pass
            if attempt == 0 and retry_after is not None and retry_after <= MAX_RATE_LIMIT_WAIT_SECONDS:
                logger.warning("Groq rate limit hit; waiting %ss (TPM window) before one retry", retry_after)
                time.sleep(retry_after)
                continue
            raise
    raise AssertionError("unreachable")  # loop always returns or raises


def call_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.2,
    retry_repair: bool = True,
    model: Optional[str] = None,
    max_tokens: int = 3000,
    reasoning_effort: Optional[str] = None,
) -> dict[str, Any]:
    """Call Groq chat completions expecting a single JSON object back.

    Raises GroqCallError if the call fails outright (network/auth/rate-limit)
    or the model never produces parseable JSON even after one repair retry.
    Callers decide the right fallback per endpoint — this function never
    silently returns {} for a real failure, only ever for content the model
    legitimately declined to produce (which it signals by actually returning
    valid JSON with an empty/absent field, not by erroring).

    `max_tokens` defaults generously high: gpt-oss reasoning models spend part
    of the completion budget on internal chain-of-thought before ever
    emitting the requested JSON, and a dense chart-heavy chunk can legitimately
    produce dozens of facts. Too small a budget truncates mid-JSON, which
    Groq's own json_object-mode validator then rejects outright (observed in
    practice: a slide-heavy earnings-deck chunk reliably failed with
    `json_validate_failed` and an empty `failed_generation` at the previous,
    unset default).
    """
    settings = get_settings()
    client = get_groq_client()
    model_name = model or settings.groq_model

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]

    try:
        raw = _complete(client, model_name, messages, temperature, max_tokens, reasoning_effort)
    except Exception as exc:
        logger.exception("Groq call failed")
        raise GroqCallError(f"Groq call failed: {exc}") from exc

    parsed = _extract_json(raw)
    if parsed is not None:
        return parsed

    if not retry_repair:
        logger.warning("Groq response was not valid JSON and repair retry is disabled: %r", raw[:500])
        raise GroqCallError("Groq response was not valid JSON")

    logger.warning("Groq response was not valid JSON, retrying once with a repair instruction")
    repair_messages = messages + [
        {"role": "assistant", "content": raw},
        {
            "role": "user",
            "content": (
                "Your previous response was not valid JSON matching the required schema. "
                "Respond with ONLY a valid JSON object, no prose, no markdown fences."
            ),
        },
    ]
    try:
        raw2 = _complete(client, model_name, repair_messages, temperature, max_tokens, reasoning_effort)
    except Exception as exc:
        logger.exception("Groq repair call failed")
        raise GroqCallError(f"Groq repair call failed: {exc}") from exc

    parsed2 = _extract_json(raw2)
    if parsed2 is not None:
        return parsed2

    logger.warning("Groq repair retry also failed to produce valid JSON: %r", raw2[:500])
    raise GroqCallError("Groq repair retry also failed to produce valid JSON")
