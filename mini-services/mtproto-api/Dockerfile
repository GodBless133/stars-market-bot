FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Run as a non-root user for defense in depth.
RUN useradd -m appuser
USER appuser

CMD ["python", "main.py"]
