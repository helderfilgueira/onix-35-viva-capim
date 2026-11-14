import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from fastapi import Header, HTTPException, Request
from sqlalchemy.orm import Session
from .models import Device, KioskSession

GATEWAY_SECRET = os.getenv("GATEWAY_SHARED_SECRET", "")
KIOSK_ORIGIN = os.getenv("KIOSK_ORIGIN", "http://localhost:5173")
PUBLIC_ORIGIN = os.getenv("PUBLIC_ORIGIN", "http://localhost:4173")
IDLE_EXPIRY = int(os.getenv("IDLE_EXPIRY_SECONDS", "120"))

def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()

def random_secret() -> str:
    return secrets.token_urlsafe(32)

def require_kiosk_channel(request: Request, x_gateway_token: str | None = Header(default=None)):
    if not GATEWAY_SECRET or not x_gateway_token or not hmac.compare_digest(x_gateway_token, GATEWAY_SECRET):
        raise HTTPException(403, "Canal do totem não autenticado")
    if request.headers.get("origin") != KIOSK_ORIGIN:
        raise HTTPException(403, "Origem não autorizada")
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json" and request.method != "GET":
        raise HTTPException(400, "Content-Type inválido")
    if request.method != "GET" and request.headers.get("x-kiosk-request") != "1":
        raise HTTPException(403, "Cabeçalho de requisição ausente")

def require_public_origin(request: Request):
    if request.headers.get("origin") != PUBLIC_ORIGIN:
        raise HTTPException(403, "Origem não autorizada")
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise HTTPException(400, "Content-Type inválido")

def get_active_device(request: Request, db: Session) -> Device:
    raw_id = request.headers.get("x-verified-device-id")
    if not raw_id:
        raise HTTPException(401, "Dispositivo não identificado")
    try:
        device_id = __import__("uuid").UUID(raw_id)
    except ValueError:
        raise HTTPException(401, "Dispositivo inválido")
    device = db.get(Device, device_id)
    if not device or device.state != "active":
        raise HTTPException(403, "Dispositivo inativo")
    return device

def get_session(request: Request, db: Session, require_csrf: bool = True) -> KioskSession:
    token = request.cookies.get("__Host-viva")
    if not token:
        raise HTTPException(401, "Sessão ausente")
    session = db.query(KioskSession).filter(KioskSession.token_hash == digest(token)).first()
    if not session or session.revoked_at or session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(401, "Sessão inválida ou expirada")
    device = get_active_device(request, db)
    if session.device_id != device.id or session.generation_id != device.current_generation:
        raise HTTPException(401, "Sessão não pertence à geração atual")
    if require_csrf:
        csrf = request.headers.get("x-csrf-token", "")
        if not csrf or not hmac.compare_digest(digest(csrf), session.csrf_hash):
            raise HTTPException(403, "Token CSRF inválido")
    return session

def no_store(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response
