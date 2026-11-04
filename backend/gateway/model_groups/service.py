from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from fastapi import HTTPException

from backend.gateway.model_groups.dtos import (
    ModelGroupCreate,
    ModelGroupMemberCreate,
    ModelGroupPatch,
    RoutingStrategy,
)
from backend.gateway.model_groups.models import ModelGroup, ModelGroupMember
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.models import Provider


def _raise_error(
    status_code: int,
    code: str,
    message: str,
    details: dict | None = None,
) -> None:
    raise HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "details": details or {}},
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _group_or_404(db: Session, group_id: UUID) -> ModelGroup:
    group = db.query(ModelGroup).filter(ModelGroup.id == str(group_id)).first()
    if group is None:
        _raise_error(404, "MODEL_GROUP_NOT_FOUND", "Model group not found.")
    return group


def _members_data(db: Session, group: ModelGroup) -> list[dict]:
    rows = (
        db.query(ModelGroupMember, ProviderModel, Provider)
        .join(ProviderModel, ModelGroupMember.provider_model_id == ProviderModel.id)
        .join(Provider, ProviderModel.provider_id == Provider.id)
        .filter(ModelGroupMember.model_group_id == group.id)
        .order_by(ModelGroupMember.priority, ModelGroupMember.id)
        .all()
    )
    return [
        {
            "id": member.id,
            "provider_model_id": model.id,
            "provider_id": provider.id,
            "provider_name": provider.name,
            "provider_alias": provider.aliases,
            "model_name": model.model_name,
            "provider_model_id_public": model.model_id,
            "weight": member.weight,
            "priority": member.priority,
            "is_available": model.is_available and provider.is_enabled,
        }
        for member, model, provider in rows
    ]


def to_group_response(db: Session, group: ModelGroup) -> dict:
    members = _members_data(db, group)
    return {
        "id": group.id,
        "name": group.name,
        "model_id": group.model_id,
        "routing_strategy": group.routing_strategy,
        "is_enabled": group.is_enabled,
        "members": members,
        "member_count": len(members),
        "created_by": group.created_by,
        "created_at": _as_utc(group.created_at),
        "updated_at": _as_utc(group.updated_at),
    }


def _validate_members(db: Session, members: list[ModelGroupMemberCreate]) -> list[tuple[ProviderModel, int, int]]:
    seen: set[str] = set()
    result = []
    for item in members:
        model_id = str(item.provider_model_id)
        if model_id in seen:
            _raise_error(
                409,
                "DUPLICATE_MEMBER",
                "A provider model may only be added once to a model group.",
                {"field": "members"},
            )
        seen.add(model_id)
        model = db.query(ProviderModel).filter(ProviderModel.id == model_id).first()
        if model is None:
            _raise_error(
                404,
                "PROVIDER_MODEL_NOT_FOUND",
                "Provider model not found.",
                {"field": "provider_model_id"},
            )
        result.append((model, item.weight, item.priority))
    return result


def _has_eligible_member(members: list[tuple[ProviderModel, int, int]]) -> bool:
    return any(model.is_available and model.provider.is_enabled for model, _, _ in members)


def _current_member_values(db: Session, group: ModelGroup) -> list[tuple[ProviderModel, int, int]]:
    rows = (
        db.query(ModelGroupMember, ProviderModel)
        .join(ProviderModel, ModelGroupMember.provider_model_id == ProviderModel.id)
        .filter(ModelGroupMember.model_group_id == group.id)
        .all()
    )
    return [(model, member.weight, member.priority) for member, model in rows]


def _validate_enabled(is_enabled: bool, members: list[tuple[ProviderModel, int, int]]) -> None:
    if is_enabled and not _has_eligible_member(members):
        _raise_error(
            422,
            "NO_ELIGIBLE_MEMBERS",
            "An enabled model group must have at least one available member on an enabled provider.",
            {"field": "members"},
        )


def _commit(db: Session, duplicate_code: str = "DUPLICATE_MODEL_ID") -> None:
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if "uq_model_groups_model_id" in str(error.orig) or "model_groups.model_id" in str(error.orig):
            _raise_error(
                409,
                duplicate_code,
                "A model group with this model_id already exists.",
                {"field": "model_id"},
            )
        if (
            "uq_model_group_member_model" in str(error.orig)
            or "model_group_members.model_group_id" in str(error.orig)
        ):
            _raise_error(
                409,
                "DUPLICATE_MEMBER",
                "A provider model may only be added once to a model group.",
                {"field": "provider_model_id"},
            )
        raise


def create_model_group(db: Session, data: ModelGroupCreate, created_by: str) -> dict:
    members = _validate_members(db, data.members)
    _validate_enabled(data.is_enabled, members)
    group = ModelGroup(
        name=data.name,
        model_id=data.model_id,
        routing_strategy=data.routing_strategy,
        is_enabled=data.is_enabled,
        created_by=created_by,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(group)
    for model, weight, priority in members:
        group.members.append(ModelGroupMember(provider_model_id=model.id, weight=weight, priority=priority))
    _commit(db)
    return to_group_response(db, group)


def list_model_groups(
    db: Session,
    page: int,
    page_size: int,
    is_enabled: bool | None,
    routing_strategy: RoutingStrategy | None,
) -> dict:
    query = db.query(ModelGroup)
    if is_enabled is not None:
        query = query.filter(ModelGroup.is_enabled.is_(is_enabled))
    if routing_strategy is not None:
        query = query.filter(ModelGroup.routing_strategy == routing_strategy)
    total = query.with_entities(func.count(ModelGroup.id)).scalar() or 0
    groups = query.order_by(ModelGroup.created_at.desc(), ModelGroup.id).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [to_group_response(db, group) for group in groups],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


def get_model_group(db: Session, group_id: UUID) -> dict:
    return to_group_response(db, _group_or_404(db, group_id))


def update_model_group(db: Session, group_id: UUID, data: ModelGroupPatch) -> dict:
    group = _group_or_404(db, group_id)
    supplied = data.model_dump(exclude_unset=True)
    proposed_members = (
        _validate_members(db, data.members)
        if "members" in supplied
        else _current_member_values(db, group)
    )
    is_enabled = supplied.get("is_enabled", group.is_enabled)
    _validate_enabled(is_enabled, proposed_members)

    for field in ("name", "model_id", "routing_strategy", "is_enabled"):
        if field in supplied:
            setattr(group, field, supplied[field])
    group.updated_at = _now()

    if "members" in supplied:
        db.query(ModelGroupMember).filter(ModelGroupMember.model_group_id == group.id).delete(synchronize_session=False)
        db.flush()
        for model, weight, priority in proposed_members:
            db.add(ModelGroupMember(model_group_id=group.id, provider_model_id=model.id, weight=weight, priority=priority))

    _commit(db)
    return to_group_response(db, group)


def add_model_group_member(db: Session, group_id: UUID, data: ModelGroupMemberCreate) -> dict:
    group = _group_or_404(db, group_id)
    member_values = _current_member_values(db, group)
    model_id = str(data.provider_model_id)
    if any(str(model.id) == model_id for model, _, _ in member_values):
        _raise_error(409, "DUPLICATE_MEMBER", "A provider model may only be added once to a model group.", {"field": "provider_model_id"})
    model_values = _validate_members(db, [data])
    all_values = member_values + model_values
    _validate_enabled(group.is_enabled, all_values)
    model, weight, priority = model_values[0]
    db.add(ModelGroupMember(model_group_id=group.id, provider_model_id=model.id, weight=weight, priority=priority))
    group.updated_at = _now()
    _commit(db)
    return to_group_response(db, group)


def update_model_group_member(db: Session, group_id: UUID, member_id: UUID, weight: int | None, priority: int | None) -> dict:
    group = _group_or_404(db, group_id)
    member = (
        db.query(ModelGroupMember)
        .filter(ModelGroupMember.id == str(member_id), ModelGroupMember.model_group_id == group.id)
        .first()
    )
    if member is None:
        _raise_error(404, "MODEL_GROUP_MEMBER_NOT_FOUND", "Model group member not found.")
    if weight is not None:
        member.weight = weight
    if priority is not None:
        member.priority = priority
    group.updated_at = _now()
    _commit(db)
    return to_group_response(db, group)


def delete_model_group_member(db: Session, group_id: UUID, member_id: UUID) -> None:
    group = _group_or_404(db, group_id)
    member = (
        db.query(ModelGroupMember)
        .filter(ModelGroupMember.id == str(member_id), ModelGroupMember.model_group_id == group.id)
        .first()
    )
    if member is None:
        _raise_error(404, "MODEL_GROUP_MEMBER_NOT_FOUND", "Model group member not found.")
    db.delete(member)
    group.updated_at = _now()
    _commit(db)


def list_enabled_groups(db: Session) -> list[ModelGroup]:
    return (
        db.query(ModelGroup)
        .filter(ModelGroup.is_enabled.is_(True))
        .order_by(ModelGroup.model_id)
        .all()
    )
