from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import SessionDep, get_current_user
from app.models import SavedView, User
from app.schemas.tract import SavedViewCreate, SavedViewOut, TokenResponse, UserCreate
from app.services.auth_service import create_access_token, create_user, get_user_by_email, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(body: UserCreate, session: SessionDep) -> TokenResponse:
    existing = await get_user_by_email(session, body.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = await create_user(session, body.email, body.password)
    token = create_access_token(user.email)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(body: UserCreate, session: SessionDep) -> TokenResponse:
    user = await get_user_by_email(session, body.email)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.email)
    return TokenResponse(access_token=token)


@router.get("/me")
async def me(user: Annotated[User, Depends(get_current_user)]) -> dict:
    return {"id": user.id, "email": user.email}


@router.post("/saved-views", response_model=SavedViewOut)
async def create_saved_view(
    body: SavedViewCreate,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_user)],
) -> SavedViewOut:
    sv = SavedView(user_id=user.id, name=body.name, geoids=body.geoids, filters=body.filters)
    session.add(sv)
    await session.commit()
    await session.refresh(sv)
    return SavedViewOut(id=sv.id, name=sv.name, geoids=sv.geoids, filters=sv.filters)


@router.get("/saved-views", response_model=list[SavedViewOut])
async def list_saved_views(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_user)],
) -> list[SavedViewOut]:
    r = await session.execute(select(SavedView).where(SavedView.user_id == user.id))
    rows = r.scalars().all()
    return [SavedViewOut(id=s.id, name=s.name, geoids=s.geoids, filters=s.filters) for s in rows]
