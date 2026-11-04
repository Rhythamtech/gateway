import asyncio
import logging

from backend.core.config import settings
from backend.credits.service import recover_pending_usage

logger = logging.getLogger(__name__)


async def reconcile_credits() -> None:
    while True:
        try:
            await asyncio.to_thread(
                recover_pending_usage, settings.CREDITS_REVIEW_AFTER_SECONDS
            )
        except Exception:
            logger.exception("Credit reconciliation failed")
        await asyncio.sleep(settings.CREDITS_RECONCILE_INTERVAL_SECONDS)
