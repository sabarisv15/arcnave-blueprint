from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "ARCNAVE"
    environment: str = "development"
    log_level: str = "INFO"

    # Runtime app connection — must use the least-privilege `arcnave_app`
    # role, never the migration-owner role. That role is a Postgres
    # superuser (provisioned by the official postgres image) and
    # superusers bypass RLS unconditionally, regardless of FORCE ROW
    # LEVEL SECURITY. This distinction is load bearing, not stylistic.
    # See ADR-015.
    database_url: str

    # Migration connection — must own the tables (CREATE TABLE, CREATE
    # POLICY, GRANT). Falls back to database_url only for convenience in
    # single-role local setups; docker-compose.yml wires these to two
    # distinct roles.
    alembic_database_url: str | None = None

    # Signs/verifies access JWTs. A real secret, required — no default,
    # same reasoning as database_url: a hardcoded fallback here would
    # be a hardcoded auth bypass waiting to happen in prod.
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    # Refresh tokens are opaque, stored server-side as token_hash only
    # (never the raw token) — see app/core/security.py.
    refresh_token_expire_days: int = 30

    # Platform (Super Admin Portal) DB connection — arcnave_platform,
    # a separate least-privilege role from arcnave_app, granted only
    # on platform_admins/colleges. Never shared with database_url; see
    # app/core/platform_database.py.
    platform_database_url: str

    # Signs/verifies platform-admin access JWTs. Deliberately a
    # DIFFERENT secret from jwt_secret_key, required, no fallback: a
    # platform token and a tenant token must never verify against the
    # same key, or a leaked tenant token plus a signature bug could be
    # mistaken for platform access. See app/core/security.py's
    # create_platform_access_token / decode_platform_access_token.
    platform_jwt_secret_key: str

    # How long a principal-invitation token (app/services/platform_service.py
    # invite_principal) stays acceptable. A safe default, not a
    # business rule yet — nothing in BusinessRules.md specifies this.
    principal_invitation_expire_hours: int = 72

    @property
    def resolved_alembic_database_url(self) -> str:
        return self.alembic_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
