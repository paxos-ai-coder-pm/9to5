# Python (Django, FastAPI, Flask, scripts)

**Detect:** `pyproject.toml` (uv/poetry/hatch), `requirements*.txt`, `manage.py` (Django), `main.py` with FastAPI.
**Commands:** env `uv sync` / `python -m venv .venv && pip install -r requirements.txt` · test `pytest -q` · lint/format `ruff check . && ruff format --check .` · types `mypy` or `pyright` if configured. Always run inside the project's virtualenv (create `.venv` with `python -m venv .venv`, then use `.venv/Scripts/python` on Windows or `.venv/bin/python`); never `pip install` into the global/system interpreter.

## Conventions
- Type hints on public functions; `dataclasses`/Pydantic models for structured data; no bare `except:` — catch specific exceptions.
- f-strings for text, **never** for SQL or shell; `pathlib` for paths; context managers for files/connections.
- Config from env via a settings object (pydantic-settings / django-environ); secrets never in `settings.py`.
- Logging via `logging`, not `print`, in app code.

## Django
Fat models/services, thin views; `select_related`/`prefetch_related`; forms/serializers validate input; permissions on every view (DRF `permission_classes`); `makemigrations --check` in CI; CSRF on; `DEBUG=False` + `ALLOWED_HOSTS` in prod; Celery tasks idempotent.

## FastAPI
Pydantic request/response models; dependencies for auth/DB sessions; async endpoints only with async drivers (don't block the loop with sync I/O); `HTTPException` with proper status codes; test with `httpx.AsyncClient`/`TestClient`.

## Flask
App factory, blueprints, Flask-WTF/validation, SQLAlchemy sessions scoped per request.

## Pitfalls
Mutable default args (`def f(x=[])`), naive datetimes (use timezone-aware UTC), circular imports, blocking calls inside async code, relying on dict/set ordering for logic, pickling untrusted data.

## Review focus
Input validation via models/serializers, authz per endpoint, queries (N+1), tests with pytest fixtures, no secrets in settings.
