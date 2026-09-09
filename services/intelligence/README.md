# groundwork-intelligence

Python FastAPI service for document understanding: page inspection, native/OCR extraction,
chunking, local embeddings, and Groq-backed fact extraction / entity resolution / relationship
reasoning / answer planning. Called internally by `services/core` (Rust); not exposed directly
to the frontend.

## Run

```
python -m venv .venv
.venv/Scripts/activate        # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Requires a system Tesseract install for OCR fallback (`tesseract --version` should work).
