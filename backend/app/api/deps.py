from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import User
from app.services.auth_service import decode_token, get_user_by_email

security = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user_optional(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    session: SessionDep,
) -> User | None:
    if not creds:
        return None
    email = decode_token(creds.credentials)
    if not email:
        return None
    return await get_user_by_email(session, email)


async def get_current_user(
    user: Annotated[User | None, Depends(get_current_user_optional)],
) -> User:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user
