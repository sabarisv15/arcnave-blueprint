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
