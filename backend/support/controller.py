from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.auth.models import User
from backend.core.database import get_db
from backend.dependencies import get_current_user, require_superuser
from backend.support import service
from backend.support.dtos import (
    SupportStatsResponse,
    TicketCreate,
    TicketDetailResponse,
    TicketMessageCreate,
    TicketMessageResponse,
    TicketPage,
    TicketResponse,
    TicketStatusUpdate,
)

router = APIRouter(prefix="/support", tags=["Support"])
Database = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
Superuser = Annotated[User, Depends(require_superuser)]
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]


@router.post("/tickets", response_model=TicketResponse, status_code=201)
def create_ticket(data: TicketCreate, user: CurrentUser):
    """Raise a support ticket. Only authenticated users can raise tickets."""
    return service.create_ticket(data, user.id)


@router.get("/tickets", response_model=TicketPage)
def list_tickets(
    db: Database,
    user: CurrentUser,
    page: Page = 1,
    page_size: PageSize = 20,
    status: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    search: str | None = None,
):
    """List tickets. Superusers see all tickets; regular users see only their own."""
    user_id = None if user.role == "superuser" else user.id
    return service.list_tickets(
        db=db,
        page=page,
        page_size=page_size,
        user_id=user_id,
        status=status,
        category=category,
        priority=priority,
        search=search,
    )


@router.get("/tickets/{ticket_id}", response_model=TicketDetailResponse)
def get_ticket(ticket_id: str, db: Database, user: CurrentUser):
    """Get full ticket details and message thread."""
    return service.get_ticket_detail(
        db=db,
        ticket_id=ticket_id,
        current_user_id=user.id,
        is_superuser=(user.role == "superuser"),
    )


@router.post(
    "/tickets/{ticket_id}/messages",
    response_model=TicketMessageResponse,
    status_code=201,
)
def add_message(ticket_id: str, data: TicketMessageCreate, user: CurrentUser):
    """Send a reply in a ticket thread."""
    return service.add_ticket_message(ticket_id=ticket_id, data=data, sender=user)


@router.patch("/tickets/{ticket_id}/status", response_model=TicketResponse)
def update_status(ticket_id: str, data: TicketStatusUpdate, user: CurrentUser):
    """Update ticket status. Users can resolve/close; Superusers can set any status."""
    return service.update_ticket_status(ticket_id=ticket_id, data=data, user=user)


@router.get("/stats", response_model=SupportStatsResponse)
def get_stats(db: Database, _: Superuser):
    """Support statistics overview for Superusers."""
    return service.get_support_stats(db)
