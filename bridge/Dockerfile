FROM python:3.12-slim
WORKDIR /app
COPY bridge/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bridge/ .
COPY dashboard/ /dashboard
ENV DATA_DIR=/data
ENV DASHBOARD_DIR=/dashboard
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
