FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Chromium for Crawl4AI ("Verify via Link" scraping)
RUN playwright install --with-deps chromium

# Copy application source code
COPY . .

# Expose FastAPI port
EXPOSE 8000

# Start Uvicorn production server (Render injects $PORT; default 8000 locally)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
