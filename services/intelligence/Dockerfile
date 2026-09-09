FROM python:3.11-slim
WORKDIR /app

# Tesseract enables the OCR fallback path (not exercised in local dev — see
# README §OCR Strategy — but available here so the deployed instance can).
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*

COPY services/intelligence/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/intelligence/app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
