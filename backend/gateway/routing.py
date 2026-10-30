"""Model-group aware routing for gateway inference.

A requested model first resolves against enabled model groups; when one
matches, its members are enumerated per the configured routing strategy as
ordered dispatch candidates. Members whose provider is disabled or whose
model is unavailable are skipped here; members whose provider budget or
capacity cannot cover the reservation fail at hold time — the controller
catches that and continues with the next candidate.

Routing strategies
------------------
round_robin
    Rotates across all eligible members in a repeating sequence (process-local
    counter). Load is distributed evenly in unit increments.

weighted_round_robin
    True probabilistic weighted selection: each member's share of traffic is
    proportional to its weight. A member with weight=3 receives 3× the requests
    of one with weight=1. Implemented via weighted random selection; unavailable
    members are excluded before sampling.

priority
    Members are tried in ascending priority order (lowest number first).
    The highest-priority available member handles every request; lower-priority
    members act as fallbacks. Ties broken by weight (desc) then id (asc).

Requests that do not match any model group keep the legacy configuration-
based routing (``resolve_model``); they charge with the default multiplier
(1x) and the configured default pricing version.
"""

import itertools
import random
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


def _sorted_members(
    db: Session, group: ModelGroup
) -> list[tuple[ProviderModel, Provider, int, int]]:
    """Group members as (model, provider, weight, priority), priority+weight order."""

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
    # Primary: ascending priority; secondary: descending weight; tertiary: model id.
    members.sort(key=lambda item: (item[3], -item[2], item[0].id))
    return members


def _eligible(members: list[tuple[ProviderModel, Provider, int, int]]) -> list[tuple[ProviderModel, Provider, int, int]]:
    """Filter to members with enabled provider and available model."""
    return [
        (model, provider, weight, priority)
        for model, provider, weight, priority in members
        if provider.is_enabled and model.is_available
    ]


def _order_by_strategy(
    members: list[tuple[ProviderModel, Provider, int, int]], routing_strategy: str
) -> list[tuple[ProviderModel, Provider, int, int]]:
    """Return members ordered by the routing strategy for one request.

    ``round_robin``         — rotate the sorted list by a global counter.
    ``weighted_round_robin``— probabilistic weighted sample (no rotation).
    ``priority``            — already sorted by priority; no reordering.
    """
    eligible = _eligible(members)
    if not eligible:
        return []

    if routing_strategy == "round_robin":
        offset = next(_rotation) % len(eligible)
        return eligible[offset:] + eligible[:offset]

    if routing_strategy == "weighted_round_robin":
        return _weighted_order(eligible)

    # "priority" and any unknown strategy: priority-sorted order as-is.
    return eligible


def _weighted_order(
    eligible: list[tuple[ProviderModel, Provider, int, int]],
) -> list[tuple[ProviderModel, Provider, int, int]]:
    """Weighted random ordering without replacement.

    The first element is the selected primary candidate (probabilistically
    chosen proportional to weights). Remaining elements follow in weight-
    descending order as fallback candidates for the same request.
    """
    if len(eligible) == 1:
        return eligible

    weights = [w for _, _, w, _ in eligible]
    total = sum(weights)
    if total == 0:
        return eligible  # degenerate: treat as equal

    # Pick the primary candidate with probability proportional to weight.
    r = random.random() * total
    cumulative = 0.0
    primary_idx = 0
    for i, w in enumerate(weights):
        cumulative += w
        if r < cumulative:
            primary_idx = i
            break

    # Remaining candidates in weight-descending order (fallback sequence).
    rest = eligible[:primary_idx] + eligible[primary_idx + 1:]
    rest.sort(key=lambda item: (-item[2], item[3], item[0].id))
    return [eligible[primary_idx]] + rest


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
            # Enabled/available check is done in _eligible() above; budget and
            # capacity checks run at reservation time inside begin_attempt so
            # the check is against live account state, not a stale snapshot.
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

    # Legacy configuration-based routing: a single fixed candidate.
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
