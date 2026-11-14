import hashlib
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .database import Base, engine, get_db
from .models import Device, Event, Location, KioskSession, ControlOperation, Submission, Participation, Review, now_utc
from .schemas import ResetRequest, SessionRequest, ActivityRequest, ParticipationRequest, ReviewRequest
from .security import digest, random_secret, require_kiosk_channel, get_active_device, get_session, no_store, IDLE_EXPIRY, KIOSK_ORIGIN

app = FastAPI(title="Viva Capim API", version="1.0.0", docs_url="/docs", redoc_url=None)

@app.on_event("startup")
def startup():
    if os.getenv("APP_ENV", "development") == "development":
        Base.metadata.create_all(bind=engine)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/v1/kiosk") or request.url.path.startswith("/v1/rights"):
        no_store(response)
    return response

@app.get("/health")
def health():
    return {"status": "ok", "service": "viva-capim-api"}

@app.get("/v1/public/catalog")
def public_catalog(db: Session = Depends(get_db), response: Response = None):
    locations = db.scalars(select(Location).where(Location.active.is_(True))).all()
    events = db.scalars(select(Event).where(Event.status == "published", Event.approved.is_(True), Event.end_at > now_utc()).order_by(Event.start_at)).all()
    payload = {
        "version": max([e.version for e in events], default=1),
        "generated_at": now_utc().isoformat(),
        "valid_until": (now_utc() + timedelta(hours=int(os.getenv("CATALOG_VALIDITY_HOURS", "24")))).isoformat(),
        "events": [{
            "id": str(e.id), "title": e.title, "start_at": e.start_at.isoformat(),
            "end_at": e.end_at.isoformat(), "status": e.status,
            "location_id": str(e.location_id) if e.location_id else None,
            "public_url": e.public_url, "version": e.version
        } for e in events],
        "public_locations": [{
            "id": str(l.id), "name": l.name, "description": l.public_description
        } for l in locations],
        "public_map": None
    }
    return JSONResponse(payload, headers={"Cache-Control": "public, max-age=60"})

@app.get("/v1/kiosk/catalog")
def kiosk_catalog(request: Request, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    get_active_device(request, db)
    return public_catalog(db)

@app.get("/v1/kiosk/config")
def kiosk_config(request: Request, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    device = get_active_device(request, db)
    location = db.get(Location, device.location_id) if device.location_id else None
    return {
        "device_id": str(device.id),
        "public_location_id": str(device.location_id) if device.location_id else None,
        "app_version": device.app_version,
        "idle_warning_seconds": int(os.getenv("IDLE_WARNING_SECONDS", "90")),
        "idle_expiry_seconds": IDLE_EXPIRY,
        "notice_version": os.getenv("NOTICE_VERSION", "1.0"),
        "support_text": "Procure a equipe do shopping para obter ajuda.",
        "generation_id": device.current_generation,
        "privacy_notice": {
            "version": os.getenv("NOTICE_VERSION", "1.0"),
            "text": "A consulta à agenda é livre. A participação e a avaliação são opcionais.",
            "purpose": "event_feedback",
            "controller_contact": "Contato do controlador deve ser configurado antes da coleta real.",
            "retention_text": "O prazo de retenção deve ser aprovado pelo controlador antes da coleta real."
        }
    }

@app.post("/v1/kiosk/reset")
def kiosk_reset(body: ResetRequest, request: Request, response: Response, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    device = db.execute(select(Device).where(Device.id == get_active_device(request, db).id).with_for_update()).scalar_one()
    body_hash = digest(body.model_dump_json())
    prior = db.query(ControlOperation).filter_by(device_id=device.id, operation_id=body.operation_id).first()
    if prior:
        if prior.operation != "reset" or prior.body_hash != body_hash or prior.resulting_generation != device.current_generation:
            raise HTTPException(409, "stale_generation")
        response.delete_cookie("__Host-viva", path="/", secure=True, httponly=True, samesite="strict")
        return {"generation_id": device.current_generation, "operation_id": str(body.operation_id), "state": "clean"}
    if body.expected_generation != device.current_generation:
        raise HTTPException(409, "stale_generation")
    now = now_utc()
    db.query(KioskSession).filter_by(device_id=device.id).filter(KioskSession.revoked_at.is_(None)).update({"revoked_at": now})
    device.current_generation += 1
    db.add(ControlOperation(device_id=device.id, operation_id=body.operation_id, operation="reset", body_hash=body_hash, expected_generation=body.expected_generation, resulting_generation=device.current_generation))
    db.commit()
    response.delete_cookie("__Host-viva", path="/", secure=True, httponly=True, samesite="strict")
    return {"generation_id": device.current_generation, "operation_id": str(body.operation_id), "state": "clean"}

@app.post("/v1/kiosk/sessions", status_code=201)
def create_session(body: SessionRequest, request: Request, response: Response, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    device = db.execute(select(Device).where(Device.id == get_active_device(request, db).id).with_for_update()).scalar_one()
    expected_notice = os.getenv("NOTICE_VERSION", "1.0")
    if not body.accepted or body.notice_version != expected_notice:
        raise HTTPException(422, "Aviso não aceito ou desatualizado")
    if body.expected_generation != device.current_generation:
        raise HTTPException(409, "stale_generation")
    active = db.query(KioskSession).filter_by(device_id=device.id).filter(KioskSession.revoked_at.is_(None)).first()
    if active:
        raise HTTPException(409, "session_creation_uncertain")
    token, csrf = random_secret(), random_secret()
    now = now_utc()
    expires = now + timedelta(seconds=IDLE_EXPIRY)
    session = KioskSession(device_id=device.id, generation_id=device.current_generation, token_hash=digest(token), csrf_hash=digest(csrf), notice_version=expected_notice, purpose=body.purpose, last_activity=now, expires_at=expires)
    db.add(session)
    db.commit()
    response.set_cookie("__Host-viva", token, max_age=IDLE_EXPIRY, secure=True, httponly=True, samesite="strict", path="/")
    return {"generation_id": device.current_generation, "expires_at": expires.isoformat(), "server_now": now.isoformat(), "csrf_token": csrf}

@app.post("/v1/kiosk/session/activity")
def session_activity(body: ActivityRequest, request: Request, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    session = get_session(request, db)
    now = now_utc()
    session.last_activity = now
    session.expires_at = now + timedelta(seconds=IDLE_EXPIRY)
    db.commit()
    return {"expires_at": session.expires_at.isoformat(), "server_now": now.isoformat()}

def save_submission(operation: str, body, request: Request, db: Session):
    session = get_session(request, db)
    raw_key = request.headers.get("idempotency-key")
    if not raw_key:
        raise HTTPException(400, "Idempotency-Key obrigatório")
    try:
        key = uuid.UUID(raw_key)
    except ValueError:
        raise HTTPException(400, "Idempotency-Key inválido")
    if key != body.submission_id:
        raise HTTPException(409, "Idempotency-Key deve corresponder a submission_id")
    payload_hash = digest(body.model_dump_json())
    prior = db.query(Submission).filter_by(session_id=session.id, submission_id=key).first()
    if prior:
        if prior.operation != operation or prior.body_hash != payload_hash:
            raise HTTPException(409, "Chave idempotente reutilizada com conteúdo diferente")
        return {"submission_id": str(key), "status": "committed", "record_id": str(prior.record_id), "operation": operation}
    event = db.get(Event, body.event_id)
    if not event or event.status != "published" or not event.approved or event.end_at <= now_utc():
        raise HTTPException(422, "Evento indisponível para envio")
    if operation == "participation":
        record = Participation(session_id=session.id, event_id=event.id)
    else:
        participated = db.query(Participation).filter_by(session_id=session.id, event_id=event.id).first()
        if not participated:
            raise HTTPException(422, "A avaliação exige participação declarada")
        record = Review(session_id=session.id, event_id=event.id, score=body.score, aspect=body.aspect)
    db.add(record)
    try:
        db.flush()
        db.add(Submission(session_id=session.id, submission_id=key, operation=operation, body_hash=payload_hash, record_id=record.id))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "already_submitted")
    return {"submission_id": str(key), "status": "committed", "record_id": str(record.id), "operation": operation}

@app.post("/v1/kiosk/participations", status_code=201)
def create_participation(body: ParticipationRequest, request: Request, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    return save_submission("participation", body, request, db)

@app.post("/v1/kiosk/reviews", status_code=201)
def create_review(body: ReviewRequest, request: Request, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    return save_submission("review", body, request, db)

@app.get("/v1/kiosk/submissions/{submission_id}")
def get_submission(submission_id: uuid.UUID, request: Request, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    session = get_session(request, db, require_csrf=False)
    row = db.query(Submission).filter_by(session_id=session.id, submission_id=submission_id).first()
    if not row:
        raise HTTPException(404, "Envio não encontrado nesta sessão")
    return {"submission_id": str(row.submission_id), "status": "committed", "record_id": str(row.record_id), "operation": row.operation}

@app.post("/v1/kiosk/session/end", status_code=204)
def end_session(request: Request, response: Response, db: Session = Depends(get_db), _: None = Depends(require_kiosk_channel)):
    session = get_session(request, db)
    session.revoked_at = now_utc()
    db.commit()
    response.delete_cookie("__Host-viva", path="/", secure=True, httponly=True, samesite="strict")
    return response

@app.get("/v1/admin/metrics")
def admin_metrics(db: Session = Depends(get_db), x_admin_token: str | None = Header(default=None)):
    expected = os.getenv("ADMIN_API_TOKEN", "")
    if not expected or not x_admin_token or not __import__("hmac").compare_digest(x_admin_token, expected):
        raise HTTPException(403, "Gestão não autenticada")
    min_group = int(os.getenv("METRICS_MIN_GROUP", "5"))
    rows = db.execute(select(Review.event_id, Review.aspect, Review.score)).all()
    grouped = {}
    for event_id, aspect, score in rows:
        grouped.setdefault((event_id, aspect), []).append(score)
    metrics = []
    for (event_id, aspect), scores in grouped.items():
        if len(scores) < min_group:
            continue
        metrics.append({"event_id": str(event_id), "aspect": aspect, "responses": len(scores), "average_score": round(sum(scores) / len(scores), 2)})
    return {"minimum_group_size": min_group, "metrics": metrics}
