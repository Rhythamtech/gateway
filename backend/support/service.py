from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.auth.models import User, UserRole
from backend.core.database import SessionLocal
from backend.credits.models import new_id, utcnow
from backend.notifications.service import emit
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
from backend.support.models import SupportTicket, SupportTicketMessage


def require_ticket(
    db: Session, ticket_id: str, *, for_update: bool = False
) -> SupportTicket:
    ticket = db.get(SupportTicket, ticket_id, with_for_update=for_update)
    if ticket is None:
        raise HTTPException(404, "Support ticket not found")
    return ticket


def active_superuser_ids(db: Session) -> list[str]:
    recipients = select(User.id).where(
        User.role == UserRole.SUPERUSER, User.is_active.is_(True)
    )
    return list(db.scalars(recipients))


def notify_ticket(
    db: Session, ticket: SupportTicket, recipients: list[str], event_key: str, title: str
) -> None:
    for recipient_id in recipients:
        emit(
            db,
            user_id=recipient_id,
            event_key=event_key,
            kind="support_ticket",
            title=title,
            message=ticket.subject,
            action_url=f"/dashboard/support?id={ticket.id}",
        )


def ticket_response(
    db: Session,
    ticket: SupportTicket,
    user_email: str | None = None,
    count: int | None = None,
    last_msg_at=None,
) -> TicketResponse:
    if user_email is None:
        user = db.get(User, ticket.user_id)
        user_email = user.email if user else None
    if count is None:
        count = (
            db.query(SupportTicketMessage)
            .filter_by(ticket_id=ticket.id)
            .count()
        )
    if last_msg_at is None:
        last_msg = (
            db.query(SupportTicketMessage)
            .filter_by(ticket_id=ticket.id)
            .order_by(SupportTicketMessage.created_at.desc())
            .first()
        )
        last_msg_at = last_msg.created_at if last_msg else ticket.created_at

    return TicketResponse(
        id=ticket.id,
        user_id=ticket.user_id,
        user_email=user_email,
        subject=ticket.subject,
        category=ticket.category,
        priority=ticket.priority,
        status=ticket.status,
        message_count=count,
        last_message_at=last_msg_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )


def create_ticket(data: TicketCreate, user_id: str) -> TicketResponse:
    with SessionLocal.begin() as db:
        ticket = SupportTicket(
            user_id=user_id,
            subject=data.subject.strip(),
            category=data.category,
            priority=data.priority,
            status="open",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(ticket)
        db.flush()

        msg = SupportTicketMessage(
            ticket_id=ticket.id,
            sender_id=user_id,
            sender_role="user",
            message=data.message.strip(),
            created_at=utcnow(),
        )
        db.add(msg)
        notify_ticket(
            db,
            ticket,
            active_superuser_ids(db),
            f"support-ticket:{ticket.id}",
            "New support request",
        )
        return ticket_response(db, ticket, count=1, last_msg_at=msg.created_at)


def list_tickets(
    db: Session,
    page: int = 1,
    page_size: int = 20,
    user_id: str | None = None,
    status: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    search: str | None = None,
) -> TicketPage:
    query = db.query(SupportTicket).join(User, SupportTicket.user_id == User.id)

    if user_id:
        query = query.filter(SupportTicket.user_id == user_id)
    if status:
        query = query.filter(SupportTicket.status == status)
    if category:
        query = query.filter(SupportTicket.category == category)
    if priority:
        query = query.filter(SupportTicket.priority == priority)
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                SupportTicket.subject.ilike(search_pattern),
                User.email.ilike(search_pattern),
            )
        )

    total = query.count()
    tickets = (
        query.order_by(SupportTicket.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    ticket_ids = [t.id for t in tickets]
    user_ids = {t.user_id for t in tickets}

    users_map = {u.id: u.email for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    # Batch counts and latest messages
    counts_map = {}
    latest_msg_map = {}
    if ticket_ids:
        counts = (
            db.query(
                SupportTicketMessage.ticket_id,
                func.count(SupportTicketMessage.id),
                func.max(SupportTicketMessage.created_at),
            )
            .filter(SupportTicketMessage.ticket_id.in_(ticket_ids))
            .group_by(SupportTicketMessage.ticket_id)
            .all()
        )
        for t_id, cnt, max_at in counts:
            counts_map[t_id] = cnt
            latest_msg_map[t_id] = max_at

    items = [
        ticket_response(
            db,
            t,
            user_email=users_map.get(t.user_id),
            count=counts_map.get(t.id, 1),
            last_msg_at=latest_msg_map.get(t.id, t.created_at),
        )
        for t in tickets
    ]

    return TicketPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


def get_ticket_detail(
    db: Session,
    ticket_id: str,
    current_user_id: str,
    is_superuser: bool,
) -> TicketDetailResponse:
    ticket = require_ticket(db, ticket_id)
    if not is_superuser and ticket.user_id != current_user_id:
        raise HTTPException(403, "You do not have access to this support ticket")

    user = db.get(User, ticket.user_id)
    user_email = user.email if user else None

    raw_messages = (
        db.query(SupportTicketMessage)
        .filter_by(ticket_id=ticket.id)
        .order_by(SupportTicketMessage.created_at.asc())
        .all()
    )

    sender_ids = {m.sender_id for m in raw_messages}
    senders = {u.id: u.email for u in db.query(User).filter(User.id.in_(sender_ids)).all()}

    messages = [
        TicketMessageResponse(
            id=m.id,
            ticket_id=m.ticket_id,
            sender_id=m.sender_id,
            sender_role=m.sender_role,
            sender_email=senders.get(m.sender_id),
            message=m.message,
            created_at=m.created_at,
        )
        for m in raw_messages
    ]

    return TicketDetailResponse(
        id=ticket.id,
        user_id=ticket.user_id,
        user_email=user_email,
        subject=ticket.subject,
        category=ticket.category,
        priority=ticket.priority,
        status=ticket.status,
        message_count=len(messages),
        last_message_at=messages[-1].created_at if messages else ticket.created_at,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        messages=messages,
    )


def add_ticket_message(
    ticket_id: str,
    data: TicketMessageCreate,
    sender: User,
) -> TicketMessageResponse:
    with SessionLocal.begin() as db:
        ticket = require_ticket(db, ticket_id, for_update=True)
        if sender.role != "superuser" and ticket.user_id != sender.id:
            raise HTTPException(403, "You do not have access to this support ticket")

        msg = SupportTicketMessage(
            ticket_id=ticket.id,
            sender_id=sender.id,
            sender_role=sender.role,
            message=data.message.strip(),
            created_at=utcnow(),
        )
        db.add(msg)

        now = utcnow()
        ticket.updated_at = now
        if sender.role == "superuser" and ticket.status == "open":
            ticket.status = "in_progress"
        elif sender.role == "user" and ticket.status in ("resolved", "closed"):
            ticket.status = "in_progress"

        db.flush()
        if sender.role == UserRole.USER:
            notify_ticket(
                db,
                ticket,
                active_superuser_ids(db),
                f"support-reply:{msg.id}",
                "New reply from the requester",
            )
        elif sender.id != ticket.user_id:
            notify_ticket(
                db,
                ticket,
                [ticket.user_id],
                f"support-reply:{msg.id}",
                "New reply to your support request",
            )
        return TicketMessageResponse(
            id=msg.id,
            ticket_id=msg.ticket_id,
            sender_id=msg.sender_id,
            sender_role=msg.sender_role,
            sender_email=sender.email,
            message=msg.message,
            created_at=msg.created_at,
        )


def update_ticket_status(
    ticket_id: str,
    data: TicketStatusUpdate,
    user: User,
) -> TicketResponse:
    with SessionLocal.begin() as db:
        ticket = require_ticket(db, ticket_id, for_update=True)
        if user.role != "superuser":
            if ticket.user_id != user.id:
                raise HTTPException(403, "You do not have access to this support ticket")
            if data.status not in ("resolved", "closed"):
                raise HTTPException(400, "Users can only resolve or close their own tickets")

        status_changed = ticket.status != data.status
        ticket.status = data.status
        ticket.updated_at = utcnow()
        if (
            status_changed
            and user.role == UserRole.SUPERUSER
            and user.id != ticket.user_id
        ):
            notify_ticket(
                db,
                ticket,
                [ticket.user_id],
                f"support-status:{new_id()}",
                f"Support request marked {data.status.replace('_', ' ')}",
            )
        db.flush()
        return ticket_response(db, ticket)


def get_support_stats(db: Session) -> SupportStatsResponse:
    total = db.query(SupportTicket).count()
    open_cnt = db.query(SupportTicket).filter_by(status="open").count()
    in_progress = db.query(SupportTicket).filter_by(status="in_progress").count()
    resolved = db.query(SupportTicket).filter_by(status="resolved").count()
    closed = db.query(SupportTicket).filter_by(status="closed").count()

    return SupportStatsResponse(
        total=total,
        open=open_cnt,
        in_progress=in_progress,
        resolved=resolved,
        closed=closed,
    )
