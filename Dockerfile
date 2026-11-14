FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_DEBUG=0
WORKDIR /app
COPY pilot/requirements.txt /app/pilot/requirements.txt
RUN pip install --no-cache-dir -r pilot/requirements.txt && useradd --create-home --uid 10001 app
COPY --chown=app:app pilot /app/pilot
COPY --chown=app:app laboratorio /app/laboratorio
COPY --chown=app:app deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
USER app
WORKDIR /app/pilot
EXPOSE 8000
CMD ["/app/entrypoint.sh"]
