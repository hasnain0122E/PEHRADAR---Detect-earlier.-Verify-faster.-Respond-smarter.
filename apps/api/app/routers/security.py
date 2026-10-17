"""Operator key for state-changing calls (header X-Operator-Key).

A shared demo key, not user accounts. When OPERATOR_API_KEY is unset: allowed outside
production (local dev), refused with 503 in production so writes are never left open.
"""

import hmac

from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import Settings
from app.routers.uploads import error_response

HEADER = "X-Operator-Key"


def operator_error(request: Request, settings: Settings) -> JSONResponse | None:
    """None when the request may proceed, otherwise the error response to return."""
    expected = settings.operator_api_key
    if not expected:
        if settings.app_env == "production":
            return error_response(
                503, "OPERATOR_KEY_NOT_CONFIGURED", "Operator actions are disabled on this server"
            )
        return None
    supplied = request.headers.get(HEADER, "")
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        return error_response(401, "UNAUTHORIZED", f"Missing or invalid {HEADER} header")
    return None
