"""后台每分钟扫描任务提醒。"""
from __future__ import annotations

import asyncio
import logging

from . import task_service as svc

logger = logging.getLogger(__name__)


async def run_task_reminder_loop(stop_event: asyncio.Event, interval_sec: float = 30.0) -> None:
    while not stop_event.is_set():
        try:
            fired = await asyncio.to_thread(svc.check_and_fire_reminders)
            if fired:
                logger.info("task reminders fired: %s", [t["id"] for t in fired])
        except Exception:
            logger.exception("task reminder loop error")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_sec)
        except asyncio.TimeoutError:
            pass
