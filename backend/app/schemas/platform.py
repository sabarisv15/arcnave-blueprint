from datetime import datetime

from pydantic import BaseModel


class PlatformLoginRequest(BaseModel):
    username: str
    password: str


class PlatformTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CreateCollegeRequest(BaseModel):
    college_id: str
    name: str
    subdomain: str


class CollegeResponse(BaseModel):
    college_id: str
    name: str
    subdomain: str
    subscription_status: str


class InvitePrincipalRequest(BaseModel):
    email: str


class InvitePrincipalResponse(BaseModel):
    college_id: str
    email: str
    # Raw token, returned directly in the response body — a temporary
    # stand-in for actually emailing an accept-link, since
    # NotificationService doesn't exist yet. See
    # docs/modules/Module-00-Platform.md Known Limitations.
    token: str
    expires_at: datetime
