"""Shared error type for every LLM provider (Groq, Gemini, ...). Raised when
a call fails outright (network/auth/rate-limit) or never produces parseable
JSON — never for "the model legitimately found nothing," which is a normal
empty-ish result, not an error."""


class LLMCallError(Exception):
    pass
