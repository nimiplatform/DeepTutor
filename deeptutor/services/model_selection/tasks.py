"""The task model — what DeepTutor runs on when nobody asked it to run.

Two calls happen without anyone requesting them: naming a conversation once it
has its first exchange, and writing the three starting points under the home
composer. Both are short, frequent and latency-visible, and neither benefits
from the model a learner picked for their actual reasoning — a small fast model
writes a four-word title just as well and costs a fraction as much.

So the catalog carries a ``task`` service, shaped exactly like ``llm``:
providers with credentials, models under them, one of each in use. Configuring
it is the same act as configuring the LLM because it is the same kind of thing,
and a provider can be brought over from the LLM service rather than typed again.

Leaving it empty is the default and the common case. Then the scope below is a
no-op and both calls resolve what they always did — for the title, the model
the turn itself is running on; for the starters, the active default. Failure
inherits too: a task profile pointing at nothing, a catalog that will not load,
a provider that no longer works — none of that is worth failing a title over.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import logging
from typing import Any

from deeptutor.services.config.model_catalog import get_model_catalog_service
from deeptutor.services.llm.config import LLMConfig

logger = logging.getLogger(__name__)

TASK_SERVICE = "task"


def task_service_configured(catalog: dict[str, Any] | None = None) -> bool:
    """Whether the task service names a model of its own."""
    try:
        loaded = catalog if catalog is not None else get_model_catalog_service().load()
        service = loaded.get("services", {}).get(TASK_SERVICE, {})
        if not isinstance(service, dict):
            return False
        profile_id = service.get("active_profile_id")
        profile = next(
            (
                item
                for item in service.get("profiles", []) or []
                if isinstance(item, dict) and item.get("id") == profile_id
            ),
            None,
        )
        if profile is None:
            return False
        model_id = service.get("active_model_id")
        return any(
            isinstance(model, dict)
            and model.get("id") == model_id
            and str(model.get("model") or "").strip()
            for model in profile.get("models", []) or []
        )
    except Exception:
        logger.debug("Task service lookup failed — inheriting", exc_info=True)
        return False


@contextmanager
def task_llm_scope() -> Iterator[LLMConfig | None]:
    """Auxiliary work inherits the current Nimi App text configuration."""
    if task_service_configured():
        from deeptutor.services.llm.exceptions import LLMConfigError

        raise LLMConfigError(
            "Independent task model profiles are not mapped to Nimi. Clear the legacy task selection and configure the App model in Nimi."
        )
    yield None


__all__ = ["TASK_SERVICE", "task_llm_scope", "task_service_configured"]
