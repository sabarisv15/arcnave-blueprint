from typing import Any

from pydantic import BaseModel


class ConfigurationResponse(BaseModel):
    category: str
    configuration: dict[str, Any]
    version: int


class SetConfigurationRequest(BaseModel):
    configuration: dict[str, Any]
    # None (or 0) means "this category doesn't exist yet, create it" —
    # anything else must match the currently stored version exactly.
    expected_version: int | None = None
