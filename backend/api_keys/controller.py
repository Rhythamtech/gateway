import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from backend.api_keys.dtos import APIKeyCreate, APIKeyCreated, APIKeyItem, APIKeyList, APIKeyRevoked
from backend.api_keys.models import APIKey
from backend.auth.models import User, UserRole
from backend.core.database import get_db, get_write_db
from backend.dependencies import get_current_user

router = APIRouter(prefix="/api-keys", tags=["API Keys"])


@router.post("", response_model=APIKeyCreated, status_code=status.HTTP_201_CREATED)
def create_api_key(data: APIKeyCreate, db: Session = Depends(get_write_db), user: User = Depends(get_current_user)):
    # Provider-style secret, modeled on the Anthropic/OpenAI shape ("sk-…"):
    # an Anthropic-like versioned namespace followed by 43 random URL-safe
    # characters (256-bit entropy, same as the previous format). The format has
    # no functional role — authentication stores and matches the SHA-256 hash —
    # so existing keys keep working unchanged.
    secret = "sk-gw-api01-" + secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    duration = {
        "1h": timedelta(hours=1),
        "24h": timedelta(hours=24),
        "1week": timedelta(weeks=1),
    }.get(data.expires_in)
    key = APIKey(
        name=data.name,
        key_hash=hashlib.sha256(secret.encode()).hexdigest(),
        key_prefix=secret[:16],
        owner_id=user.id,
        created_at=now,
        expires_at=now + duration if duration is not None else None,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return {**APIKeyItem.model_validate(key).model_dump(), "api_key": secret}


@router.get("", response_model=APIKeyList)
def list_api_keys(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    items = db.query(APIKey).filter(APIKey.owner_id == user.id).order_by(APIKey.created_at.desc()).all()
    return {"items": items, "total": len(items)}


@router.post("/{key_id}/revoke", response_model=APIKeyRevoked)
def revoke_api_key(key_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    key = db.query(APIKey).filter(APIKey.id == key_id).first()
    if key is None:
        raise HTTPException(404, detail="API key not found")
    if key.owner_id != user.id:
        raise HTTPException(403, detail="Only the key owner may revoke it")
    if not key.revoked:
        key.revoked = True
        key.revoked_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(key)
    return {
        "id": key.id,
        "name": key.name,
        "key_prefix": key.key_prefix,
        "owner_id": key.owner_id,
        "revoked": True,
        "revoked_at": key.revoked_at,
    }


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_api_key(key_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role != UserRole.SUPERUSER:
        raise HTTPException(403, detail="Superuser access required")
    key = db.query(APIKey).filter(APIKey.id == key_id).first()
    if key is None:
        raise HTTPException(404, detail="API key not found")
    db.delete(key)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
