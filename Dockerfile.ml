FROM python:3.12-slim

WORKDIR /app

COPY app/ml-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ml-service/app/ ./app/

# Copy seed knowledge files for initial import
COPY seed_knowledge ./seed_knowledge/
COPY "药店门店智能问答轻量级知识库.docx" ./
COPY "信息部常见问题详解" "./信息部常见问题详解/"

RUN mkdir -p /app/uploads

EXPOSE 8001

ENV ROOT_DIR=/app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
