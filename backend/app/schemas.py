from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class ResetRequest(BaseModel):
    reason: str = Field(pattern="^(boot|recovery|abandoned)$")
    operation_id: UUID
    expected_generation: int = Field(ge=0)

class SessionRequest(BaseModel):
    notice_version: str
    purpose: str = Field(pattern="^event_feedback$")
    accepted: bool
    operation_id: UUID
    expected_generation: int = Field(ge=0)

class ActivityRequest(BaseModel):
    interaction: str = Field(pattern="^(touch|key|assistive_action)$")

class ParticipationRequest(BaseModel):
    submission_id: UUID
    event_id: UUID
    participation_type: str = Field(default="self_declared", pattern="^self_declared$")

class ReviewRequest(BaseModel):
    submission_id: UUID
    event_id: UUID
    score: int = Field(ge=1, le=5)
    aspect: str = Field(pattern="^(organization|accessibility|programming|location)$")

class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    start_at: datetime
    end_at: datetime
    status: str
    location_id: UUID | None
    public_url: str | None
    version: int
