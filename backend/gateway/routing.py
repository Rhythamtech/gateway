"""Model-group aware routing for gateway inference.

A requested model first resolves against enabled model groups; when one
matches, its members are enumerated per the configured routing strategy as
ordered dispatch candidates. Members whose provider is disabled or whose
model is unavailable are skipped here; members whose provider budget cannot
cover the reservation fail at hold time — the controller catches that and
continues with the next candidate per the routing strategy. A request is
therefore never routed to a provider whose budget cannot cover it.

Requests that do not match any model group keep the legacy configuration
based routing (``resolve_model``); they charge with the default multiplier
(1x) and the configured default pricing version.
"""

import itertools
from dataclasses import dataclass

from backend.core.config import settings
from backend.core.database import SessionLocal
from backend.core.errors import GatewayError
from backend.gateway.model_groups.models import DEFAULT_MULTIPLIER_PPM, ModelGroup, ModelGroupMember
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.providers.models import Provider
from backend.gateway.providers.service import resolve_model
from sqlalchemy.orm import Session

# Process-local rotation counter for round-robin fairness across requests.
_rotation = itertools.count()


@dataclass(frozen=True)
class RouteCandidate:
    """One orderable dispatch candidate resolved before any attempt."""

    provider_alias: str
    provider_id: str
    upstream_model: str
    provider_model_id: str | None
    gateway_model_id: str | None
    multiplier_ppm: int
    pricing_version: str
    protocol: str
    requested_model: str | None = None


def _sorted_members(db: Session, group: ModelGroup) -> list[tuple[ProviderModel, Provider, int, int]]:
    """Group members as (model, provider, weight, priority), priority order."""

    rows = (
        db.query(ModelGroupMember, ProviderModel, Provider)
        .join(ProviderModel, ModelGroupMember.provider_model_id == ProviderModel.id)
        .join(Provider, ProviderModel.provider_id == Provider.id)
        .filter(ModelGroupMember.model_group_id == group.id)
        .all()
    )
    members = [
        (model, provider, member.weight, member.priority)
        for member, model, provider in rows
    ]
    members.sort(key=lambda item: (item[3], -item[2], item[0].id))
    return members


def _order_by_strategy(
    members: list[tuple[ProviderModel, Provider, int, int]], routing_strategy: str
) -> list[tuple[ProviderModel, Provider, int, int]]:
    """Priority-first order; round-robin additionally rotates per request."""

    if len(members) > 1 and routing_strategy == "round_robin":
        offset = next(_rotation) % len(members)
        return members[offset:] + members[:offset]
    return members


def plan(model: str) -> list[RouteCandidate]:
    """Ordered dispatch candidates for one inbound gateway request."""

    db = SessionLocal()
    try:
        return plan_with_db(db, model)
    finally:
        db.close()


def plan_with_db(db: Session, model: str) -> list[RouteCandidate]:
    group = (
        db.query(ModelGroup)
        .filter(ModelGroup.model_id == model, ModelGroup.is_enabled.is_(True))
        .first()
    )

    if group is not None:
        candidates: list[RouteCandidate] = []
        for model_row, provider, _weight, _priority in _order_by_strategy(
            _sorted_members(db, group), group.routing_strategy
        ):
            # Skip members with a disabled provider or unavailable model;
            # insufficient provider budget skips at hold time so the check
            # runs against the live account state inside the reservation
            # transaction instead of a possibly-stale snapshot here.
            if not provider.is_enabled or not model_row.is_available:
                continue
            candidates.append(
                RouteCandidate(
                    provider_alias=provider.aliases,
                    provider_id=provider.id,
                    upstream_model=model_row.model_name,
                    provider_model_id=model_row.id,
                    gateway_model_id=group.id,
                    multiplier_ppm=group.credit_multiplier_ppm,
                    pricing_version=group.pricing_version,
                    protocol=str(provider.protocol),
                    requested_model=model,
                )
            )
        return candidates

    # Legacy configuration-based routing: a single fixed candidate. The
    # provider row is read directly — credential decryption and enablement
    # checks stay in capture.begin_attempt (get_provider), so planning
    # never depends on configuration validity.
    provider_alias, upstream_model = resolve_model(model, db)
    row = db.query(Provider).filter(Provider.aliases == provider_alias).first()
    if row is None:
        raise GatewayError(
            400, "invalid_request_error", f"Unknown provider: {provider_alias}"
        )

    return [
        RouteCandidate(
            provider_alias=row.aliases,
            provider_id=row.id,
            upstream_model=upstream_model,
            provider_model_id=None,
            gateway_model_id=None,
            multiplier_ppm=DEFAULT_MULTIPLIER_PPM,
            pricing_version=settings.BILLING_PRICING_VERSION,
            protocol=str(row.protocol),
            requested_model=model,
        )
    ]
