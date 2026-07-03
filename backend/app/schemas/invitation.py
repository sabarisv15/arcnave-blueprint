from pydantic import BaseModel


class AcceptInvitationRequest(BaseModel):
    token: str
    username: str
    password: str


class AcceptInvitationResponse(BaseModel):
    user_id: str
    college_id: str
    username: str
    role: str
