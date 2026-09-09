import os
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


class Settings:
    groq_api_key: str = os.getenv("GROQ_API_KEY", "")
    groq_model: str = os.getenv("GROQ_MODEL", "moonshotai/kimi-k2-instruct")
    # Interactive answer-planning is low-volume (once per user question) and
    # needs a bigger input-token budget than whatever model GROQ_MODEL is
    # currently tuned to for high-volume background extraction — qwen3.8-27b,
    # a good extraction-batch choice, enforces a 7000 ITPM ceiling that real
    # queries (several retrieved facts + chunks) routinely exceed.
    groq_answer_model: str = os.getenv("GROQ_ANSWER_MODEL", "openai/gpt-oss-120b")
    groq_vision_model: str = os.getenv(
        "GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"
    )
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
    # Which provider backs the ingestion-time endpoints (fact extraction,
    # entity resolution, relationship reasoning) — "groq" or "gemini". These
    # stay on Groq by default per llm_router.py's docstring; override to
    # "gemini" when Groq's quota is exhausted.
    extraction_provider: str = os.getenv("EXTRACTION_PROVIDER", "groq")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
    port: int = int(os.getenv("INTELLIGENCE_PORT", "8000"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
