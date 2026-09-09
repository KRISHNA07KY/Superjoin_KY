"""Gemini (Google AI Studio) provider — mirrors groq_client.call_json's
signature so routers can call either provider interchangeably via
llm_router.py. Uses the REST API directly (httpx, already a dependency)
rather than pulling in google-generativeai, to keep the dependency surface
small for a second provider.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Optional

import httpx

from app.config import get_settings
from app.llm_errors import LLMCallError

logger = logging.getLogger("groundwork.gemini")

_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# Mirrors groq_client's short-rate-limit-retry: the free tier's per-minute
# request cap (observed: 15 RPM for gemini-3.5-flash-lite) is a rolling
# window, so waiting it out and retrying once is usually worth it during a
# batch job. Google returns the wait in the error body's RetryInfo detail
# (e.g. {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay":
# "53s"}), not a Retry-After header.
MAX_RATE_LIMIT_WAIT_SECONDS = 65


def _parse_retry_delay(body_text: str) -> Optional[float]:
    try:
        data = json.loads(body_text)
    except json.JSONDecodeError:
        return None
    for detail in data.get("error", {}).get("details", []):
        if detail.get("@type") == "type.googleapis.com/google.rpc.RetryInfo":
            m = re.match(r"([\d.]+)s?$", str(detail.get("retryDelay", "")))
            if m:
                return float(m.group(1))
    return None


def _extract_json(raw: str) -> Optional[dict]:
    if not raw:
        return None
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    if "```" in raw:
        for part in raw.split("```"):
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{") or part.startswith("["):
                try:
                    return json.loads(part)
                except json.JSONDecodeError:
                    continue
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


def _generate(model_name: str, api_key: str, system: str, user: str, temperature: float, max_tokens: int) -> str:
    url = f"{_BASE_URL}/{model_name}:generateContent?key={api_key}"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
        },
    }
    for attempt in range(2):
        try:
            resp = httpx.post(url, json=body, timeout=60)
            resp.raise_for_status()
            break
        except httpx.HTTPStatusError as exc:
            if attempt == 0 and exc.response.status_code == 429:
                delay = _parse_retry_delay(exc.response.text)
                if delay is not None and delay <= MAX_RATE_LIMIT_WAIT_SECONDS:
                    logger.warning("Gemini rate limit hit; waiting %.0fs before one retry", delay)
                    time.sleep(delay)
                    continue
            logger.exception("Gemini call failed")
            raise LLMCallError(f"Gemini call failed: {exc.response.status_code} - {exc.response.text[:300]}") from exc
        except Exception as exc:
            logger.exception("Gemini call failed")
            raise LLMCallError(f"Gemini call failed: {exc}") from exc

    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        # e.g. blocked by safety filters — promptFeedback carries the reason
        reason = data.get("promptFeedback", {})
        raise LLMCallError(f"Gemini returned no candidates: {reason}")
    parts = candidates[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts)


def call_json(
    system: str,
    user: str,
    *,
    temperature: float = 0.2,
    retry_repair: bool = True,
    model: Optional[str] = None,
    max_tokens: int = 3000,
    reasoning_effort: Optional[str] = None,  # accepted for signature parity with groq_client; unused
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise LLMCallError("GEMINI_API_KEY is not configured")
    model_name = model or settings.gemini_model

    raw = _generate(model_name, settings.gemini_api_key, system, user, temperature, max_tokens)
    parsed = _extract_json(raw)
    if parsed is not None:
        return parsed

    if not retry_repair:
        raise LLMCallError("Gemini response was not valid JSON")

    logger.warning("Gemini response was not valid JSON, retrying once with a repair instruction")
    repair_user = (
        f"{user}\n\n---\nYour previous response was not valid JSON matching the required schema. "
        "Respond with ONLY a valid JSON object, no prose, no markdown fences."
    )
    raw2 = _generate(model_name, settings.gemini_api_key, system, repair_user, temperature, max_tokens)
    parsed2 = _extract_json(raw2)
    if parsed2 is not None:
        return parsed2

    raise LLMCallError("Gemini repair retry also failed to produce valid JSON")
