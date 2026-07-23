"""Per-request user context.

Holds the caller's Supabase JWT (set by the FastAPI middleware) so data-layer
code can act on behalf of the user under RLS. Uses a contextvar, which is
async-safe per request.
"""

from contextvars import ContextVar

_user_token: ContextVar[str | None] = ContextVar("user_token", default=None)


def set_user_token(token: str | None) -> None:
    _user_token.set(token)


def get_user_token() -> str | None:
    return _user_token.get()