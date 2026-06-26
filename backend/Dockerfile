# syntax=docker/dockerfile:1

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install build dependencies (optional) and runtime dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Expose FastAPI default port
EXPOSE 8000

# Run FastAPI with hot reload for development
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"]
