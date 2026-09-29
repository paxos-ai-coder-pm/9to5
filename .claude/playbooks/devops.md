# DevOps: config, containers, CI, deploy

## Configuration
- 12-factor: config from environment; commit a `.env.example` with every variable (no real values); validate required env at startup and fail fast with a clear message.
- Separate dev/test/prod settings; never point tests at a real/shared database.

## Docker
- Small official base images, pinned versions (`node:22-alpine`, `python:3.12-slim`); multi-stage builds (build deps not in the final image).
- `.dockerignore` (node_modules, .git, .env, build output); run as non-root; one process per container; health check.
- Copy lockfile + install before copying source (layer caching).

## CI (e.g. GitHub Actions)
- On every PR: install from lockfile (`npm ci`, `pip install -r`, `go mod download`), lint, type-check, test, build. Fail on warnings that matter.
- Cache dependencies; run the same commands developers run locally (scripts in package.json/Makefile).
- Secrets only via the CI secret store; never echo them. Least-privilege tokens (`permissions:` block).

## Deploy
- Reproducible builds from a tagged commit; migrations run as a separate, reviewed step before the new code.
- Health checks and a rollback path; log in structured form (JSON) with request ids; no PII in logs.
- Kubernetes: resource requests/limits, readiness/liveness probes, config via ConfigMap/Secret, rolling updates.
