"""Shared plumbing for components that call a model or an external service.

* ``Capability`` gives every LLM / embedder a uniform ``ready()`` = access policy + the component's own
  ``available()`` check (key present, server reachable, model downloaded...).
* ``guard_methods`` wraps a subclass's call methods so nothing can call a model while the policy forbids it,
  even through a new component that forgets to check (works for sync, async and async-generator methods).
* ``require_env`` turns the usual "X_API_KEY is not set" check into one line.
"""
from __future__ import annotations

import functools
import inspect
import os
from collections.abc import Callable

from . import settings
from .settings import Unavailable

POLICY = {
    "llm": (settings.llm_allowed, settings.POLICY_LLM),
    "embeddings": (settings.embeddings_allowed, settings.POLICY_EMB),
}


def _check(kind: str) -> None:
    allowed, msg = POLICY[kind]
    if not allowed():
        raise Unavailable(msg, what=kind)


def _wrap(fn: Callable, kind: str, applies: Callable[[object], bool]) -> Callable:
    if inspect.isasyncgenfunction(fn):
        @functools.wraps(fn)
        async def agen(self, *a, **kw):
            if applies(self):
                _check(kind)
            async for x in fn(self, *a, **kw):
                yield x
        return agen
    if inspect.iscoroutinefunction(fn):
        @functools.wraps(fn)
        async def coro(self, *a, **kw):
            if applies(self):
                _check(kind)
            return await fn(self, *a, **kw)
        return coro

    @functools.wraps(fn)
    def sync(self, *a, **kw):
        if applies(self):
            _check(kind)
        return fn(self, *a, **kw)
    return sync


def guard_methods(cls: type, names: tuple[str, ...], kind: str, applies: Callable[[object], bool] = lambda s: True):
    """Wrap the methods ``names`` that ``cls`` itself defines with the ``kind`` policy check."""
    for name in names:
        if name in cls.__dict__:
            setattr(cls, name, _wrap(cls.__dict__[name], kind, applies))


class Capability:
    """Mixin: ``policy_kind`` + ``available()`` → ``ready()``."""

    policy_kind: str = "llm"

    def uses_policy(self) -> bool:
        return True

    def available(self) -> tuple[bool, str]:
        """Cheap local check: key present / server reachable / model present. Never spends tokens."""
        return True, ""

    def ready(self) -> tuple[bool, str]:
        allowed, msg = POLICY[self.policy_kind]
        if self.uses_policy() and not allowed():
            return False, msg
        try:
            return self.available()
        except Exception as e:  # noqa: BLE001
            return False, f"{type(e).__name__}: {e}"


def require_env(*names: str, example: str = "", hint: str = "Add it to .env, or pick another provider.") -> tuple[bool, str]:
    """(True, "") if every variable is set, else a readable reason naming the missing ones."""
    missing = [n for n in names if not os.environ.get(n)]
    if not missing:
        return True, ""
    what = " and ".join(missing)
    verb = "is" if len(missing) == 1 else "are"
    return False, f"{what} {verb} not set{f' (e.g. {example})' if example else ''}. {hint}"
