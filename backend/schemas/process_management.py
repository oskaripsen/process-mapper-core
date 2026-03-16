from pydantic import BaseModel, EmailStr, Field, field_serializer, field_validator
from typing import Optional, List, Union, Dict, Any
from datetime import datetime
from enum import Enum
import uuid
import json

class ProcessLevel(str, Enum):
    L0 = "L0"
    L1 = "L1" 
    L2 = "L2"
    L3 = "L3"

class UserRole(str, Enum):
    OWNER = "owner"
    DELEGATOR = "delegator"
    DELEGATEE = "delegatee"

class ProcessStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"

class ReviewStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    NEEDS_REVISION = "needs_revision"

# Process Taxonomy Schemas
class ProcessTaxonomyBase(BaseModel):
    name: str
    description: Optional[str] = None
    code: Optional[str] = None
    level: int
    parent_id: Optional[Union[str, uuid.UUID]] = None

class ProcessTaxonomyCreate(ProcessTaxonomyBase):
    organization_id: Optional[Union[str, uuid.UUID]] = None  # Optional for now, can be added later

class ProcessTaxonomyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None
    is_active: Optional[bool] = None

class ProcessTaxonomyResponse(ProcessTaxonomyBase):
    id: Union[str, uuid.UUID] = Field(..., description="Process taxonomy ID")
    organization_id: Optional[Union[str, uuid.UUID]] = Field(None, description="Organization ID (optional)")
    is_active: bool
    created_at: datetime
    updated_at: datetime
    created_by: str
    children: Optional[List['ProcessTaxonomyResponse']] = None
    
    @field_serializer('id', 'organization_id')
    def serialize_uuid(self, value):
        if value is None:
            return None
        return str(value)

# User Assignment Schemas
class ProcessAssignmentBase(BaseModel):
    process_id: str
    user_email: EmailStr
    role: UserRole

class ProcessAssignmentCreate(ProcessAssignmentBase):
    pass

class ProcessAssignmentResponse(ProcessAssignmentBase):
    id: Union[str, uuid.UUID] = Field(..., description="Assignment ID")
    process_id: Union[str, uuid.UUID] = Field(..., description="Process ID")
    user_id: Optional[str] = None
    assigned_by: str
    assigned_at: datetime
    is_active: bool
    
    @field_serializer('id')
    def serialize_uuid(self, value):
        return str(value)
    
    @field_serializer('process_id')
    def serialize_process_id(self, value):
        return str(value)

# Process Flow Schemas
class ProcessFlowBase(BaseModel):
    process_id: str
    title: str
    description: Optional[str] = None
    flow_data: Union[dict, str]
    
    @field_validator('flow_data', mode='before')
    @classmethod
    def parse_flow_data(cls, value):
        """Parse flow_data from JSON string to dict on input"""
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return {}
        return value
    
    @field_serializer('flow_data')
    def serialize_flow_data(self, value):
        if isinstance(value, str):
            return json.loads(value)
        return value

class ProcessFlowCreate(ProcessFlowBase):
    pass

class ProcessFlowUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    flow_data: Optional[dict] = None
    status: Optional[ProcessStatus] = None

class ProcessFlowResponse(ProcessFlowBase):
    id: Union[str, uuid.UUID] = Field(..., description="Process flow ID")
    process_id: Union[str, uuid.UUID] = Field(..., description="Process ID")
    created_by: str
    status: ProcessStatus
    version: int
    created_at: datetime
    updated_at: datetime
    submitted_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    
    @field_serializer('id')
    def serialize_id(self, value):
        return str(value)
    
    @field_serializer('process_id')
    def serialize_process_id(self, value):
        return str(value)


class ProcessFlowVersionResponse(BaseModel):
    id: Union[str, uuid.UUID] = Field(..., description="Version ID")
    flow_id: Union[str, uuid.UUID] = Field(..., description="Process flow ID")
    version_number: int
    node_count: int = 0
    edge_count: int = 0
    change_description: Optional[str] = None
    version_type: Optional[str] = None
    sop_url: Optional[str] = None
    created_by: str
    created_at: datetime

    @field_serializer('id', 'flow_id')
    def serialize_version_ids(self, value):
        return str(value)

# Review Schemas
class ProcessReviewBase(BaseModel):
    flow_id: str
    reviewer_email: EmailStr
    review_type: str
    comments: Optional[str] = None

class ProcessReviewCreate(ProcessReviewBase):
    pass

class ProcessReviewUpdate(BaseModel):
    status: Optional[ReviewStatus] = None
    comments: Optional[str] = None

class ProcessReviewResponse(ProcessReviewBase):
    id: Union[str, uuid.UUID] = Field(..., description="Review ID")
    reviewer_id: str
    status: ReviewStatus
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    
    @field_serializer('id')
    def serialize_uuid(self, value):
        return str(value)

# User Invitation Schemas
class UserInvitationCreate(BaseModel):
    email: EmailStr
    organization_id: str = "00000000-0000-0000-0000-000000000001"

class UserInvitationResponse(BaseModel):
    id: Union[str, uuid.UUID] = Field(..., description="Invitation ID")
    email: str
    organization_id: Union[str, uuid.UUID] = Field(..., description="Organization ID")
    invited_by: str
    invitation_token: str
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    created_at: datetime
    
    @field_serializer('id', 'organization_id')
    def serialize_uuid(self, value):
        return str(value)

# Dashboard Schemas
class ProcessCompletionStats(BaseModel):
    total_processes: int
    completed_processes: int
    in_progress_processes: int
    pending_reviews: int
    completion_percentage: float

class UserDashboardData(BaseModel):
    user_assignments: List[ProcessAssignmentResponse]
    process_flows: List[ProcessFlowResponse]
    pending_reviews: List[ProcessReviewResponse]
    stats: ProcessCompletionStats
    completed_process_ids: List[str] = []
    in_progress_process_ids: List[str] = []

# Update forward references
ProcessTaxonomyResponse.model_rebuild()
