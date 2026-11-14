import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base

def now_utc():
    return datetime.now(timezone.utc)

class Location(Base):
    __tablename__ = "locations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(140), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    public_description: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

class Event(Base):
    __tablename__ = "events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("locations.id"))
    public_url: Mapped[str | None] = mapped_column(String(500))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    approved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

class Device(Base):
    __tablename__ = "devices"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("locations.id"))
    state: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    current_generation: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    app_version: Mapped[str] = mapped_column(String(40), default="1.0.0", nullable=False)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class DeviceCredential(Base):
    __tablename__ = "device_credentials"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"), nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    state: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    not_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class KioskSession(Base):
    __tablename__ = "kiosk_sessions"
    __table_args__ = (Index("ix_kiosk_sessions_device_generation", "device_id", "generation_id"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"), nullable=False)
    generation_id: Mapped[int] = mapped_column(Integer, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    notice_version: Mapped[str] = mapped_column(String(40), nullable=False)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    last_activity: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class ControlOperation(Base):
    __tablename__ = "control_operations"
    __table_args__ = (UniqueConstraint("device_id", "operation_id", name="uq_control_operation"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"), nullable=False)
    operation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    operation: Mapped[str] = mapped_column(String(30), nullable=False)
    body_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expected_generation: Mapped[int] = mapped_column(Integer, nullable=False)
    resulting_generation: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("session_id", "submission_id", name="uq_submission_session_key"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kiosk_sessions.id"), nullable=False)
    submission_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    operation: Mapped[str] = mapped_column(String(30), nullable=False)
    body_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

class Participation(Base):
    __tablename__ = "participations"
    __table_args__ = (UniqueConstraint("session_id", "event_id", name="uq_participation_session_event"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kiosk_sessions.id"), nullable=False)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), nullable=False)
    participation_type: Mapped[str] = mapped_column(String(30), default="self_declared", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("session_id", "event_id", name="uq_review_session_event"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kiosk_sessions.id"), nullable=False)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    aspect: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
