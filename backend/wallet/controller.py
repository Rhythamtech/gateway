"""Wallet and budget endpoints (JWT authentication).

Own-wallet routes are self-scoped via ``get_current_user``; the superuser
budget routes below them require ``require_superuser``. API-key quoted
inference credentials never authorize any of these routes: the API-key
middleware only intercepts ``/v1`` data-plane paths.

Two route namespaces live in this file (``/wallet`` for the user's own
account and top-level administrative wallet/budget routes), so the router
carries no shared prefix and every path is spelled out in full. Administrative
routes remain protected by ``require_superuser`` independently of their URLs.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.database import get_db
from backend.dependencies import get_current_user, require_superuser as _require_superuser
from backend.wallet import service
from backend.wallet.dtos import (
    ProviderBudgetResponse,
    ProviderBudgetTopUpCreated,
    ProviderBudgetTopUpRequest,
    SystemBudgetResponse,
    SystemBudgetTopUpCreated,
    SystemBudgetTopUpRequest,
    WalletBalance,
    WalletTopUpCreated,
    WalletTopUpRequest,
    WalletTransaction,
    WalletTransactionPage,
)

router = APIRouter(tags=["Wallet"])

_MAX_PAGE_SIZE = 100


# ---------------------------------------------------------------------------
# Own wallet (self-scoped)
# ---------------------------------------------------------------------------


@router.get("/wallet", response_model=WalletBalance)
def get_my_wallet(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Own wallet balance; provisioned lazily on first access."""
    wallet = service.get_or_create_wallet(db, current_user.id)
    return WalletBalance(
        user_id=wallet.user_id,
        available_credits=wallet.available_credits,
        reserved_credits=wallet.reserved_credits,
        debt_credits=wallet.debt_credits,
        lifetime_credited_credits=wallet.lifetime_credited_credits,
        lifetime_spent_credits=wallet.lifetime_spent_credits,
        status=wallet.status,
        version=wallet.version,
        created_at=wallet.created_at,
        updated_at=wallet.updated_at,
    )


@router.get("/wallet/transactions", response_model=WalletTransactionPage)
def get_my_transactions(
    current_user: User = Depends(get_current_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=_MAX_PAGE_SIZE),
):
    """Own append-only wallet ledger, newest first (owner-scoped)."""
    rows, total = service.list_wallet_transactions(
        current_user.id, page=page, page_size=page_size
    )
    return WalletTransactionPage(
        items=[
            WalletTransaction(
                id=entry.id,
                wallet_id=entry.wallet_id,
                user_id=entry.user_id,
                entry_type=entry.entry_type,
                available_delta_credits=entry.available_delta_credits,
                reserved_delta_credits=entry.reserved_delta_credits,
                charged_credits=entry.charged_credits,
                debt_delta_credits=entry.debt_delta_credits,
                balance_after_credits=entry.balance_after_credits,
                reserved_after_credits=entry.reserved_after_credits,
                debt_after_credits=entry.debt_after_credits,
                source_call_trace_id=entry.source_call_trace_id,
                idempotency_key=entry.idempotency_key,
                reason=entry.reason,
                actor_user_id=entry.actor_user_id,
                created_at=entry.created_at,
            )
            for entry in rows
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


# ---------------------------------------------------------------------------
# Superuser budgeting
# ---------------------------------------------------------------------------


@router.post(
    "/users/{user_id}/wallet/top-ups",
    response_model=WalletTopUpCreated,
    status_code=201,
)
def top_up_user_wallet(
    user_id: str,
    data: WalletTopUpRequest,
    actor: User = Depends(_require_superuser),
):
    """Grants credits to one user's wallet; duplicate keys return 409."""
    result = service.top_up_wallet(
        user_id=user_id,
        amount_credits=data.amount_credits,
        reason=data.reason,
        idempotency_key=data.idempotency_key,
        actor_user_id=actor.id,
    )
    return WalletTopUpCreated(
        transaction_id=result.transaction_id,
        user_id=result.user_id,
        amount_credits=result.amount_credits,
        available_credits=result.available_credits,
        reserved_credits=result.reserved_credits,
        reason=data.reason,
        actor_user_id=result.actor_user_id,
        created_at=result.created_at,
    )


@router.get("/system-budget", response_model=SystemBudgetResponse)
def get_system_budget(_: User = Depends(_require_superuser)):
    account = service.get_or_create_system_account()
    return SystemBudgetResponse(
        unallocated_credits=account.unallocated_credits,
        allocated_credits=account.allocated_credits,
        consumed_credits=account.consumed_credits,
        lifetime_funded_credits=account.lifetime_funded_credits,
        available_for_allocation_credits=account.unallocated_credits,
        updated_at=account.updated_at,
    )


@router.post(
    "/system-budget/top-ups",
    response_model=SystemBudgetTopUpCreated,
    status_code=201,
)
def top_up_system_budget(
    data: SystemBudgetTopUpRequest,
    actor: User = Depends(_require_superuser),
):
    """Funds the unallocated system budget; duplicate keys return 409."""
    result = service.top_up_system(
        amount_credits=data.amount_credits,
        reason=data.reason,
        idempotency_key=data.idempotency_key,
        actor_user_id=actor.id,
    )
    return SystemBudgetTopUpCreated(
        transaction_id=result.transaction_id,
        amount_credits=result.amount_credits,
        unallocated_credits=result.unallocated_credits,
        allocated_credits=result.allocated_credits,
        consumed_credits=result.consumed_credits,
        actor_user_id=result.actor_user_id,
        reason=data.reason,
        created_at=result.created_at,
    )


@router.get(
    "/providers/{provider_id}/budget",
    response_model=ProviderBudgetResponse,
)
def get_provider_budget(
    provider_id: str,
    _: User = Depends(_require_superuser),
):
    account, provider_name = service.get_or_create_provider_budget(provider_id)
    return ProviderBudgetResponse(
        provider_id=account.provider_id,
        provider_name=provider_name,
        available_credits=account.available_credits,
        reserved_credits=account.reserved_credits,
        consumed_credits=account.consumed_credits,
        lifetime_allocated_credits=account.lifetime_allocated_credits,
        updated_at=account.updated_at,
    )


@router.post(
    "/providers/{provider_id}/budget/top-ups",
    response_model=ProviderBudgetTopUpCreated,
    status_code=201,
)
def top_up_provider_budget(
    provider_id: str,
    data: ProviderBudgetTopUpRequest,
    actor: User = Depends(_require_superuser),
):
    """Allocates provider budget from the system pool; 409 when unfunded."""
    result = service.top_up_provider(
        provider_id=provider_id,
        amount_credits=data.amount_credits,
        reason=data.reason,
        idempotency_key=data.idempotency_key,
        actor_user_id=actor.id,
    )
    return ProviderBudgetTopUpCreated(
        transaction_id=result.transaction_id,
        provider_id=result.provider_id,
        amount_credits=result.amount_credits,
        provider_available_credits=result.provider_available_credits,
        system_unallocated_credits=result.system_unallocated_credits,
        actor_user_id=result.actor_user_id,
        reason=data.reason,
        created_at=result.created_at,
    )
