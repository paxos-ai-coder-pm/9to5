# Databases & migrations

## Schema
- Every table: primary key, `created_at`/`updated_at` (UTC). Foreign keys with explicit `ON DELETE` behaviour. Unique constraints for real-world uniqueness (email, slug) — enforce in the DB, not only in code.
- Index columns you filter/join/sort on; composite index order = equality columns first, then range/sort.
- Store money as integer minor units; timestamps in UTC; enums as constrained text or native enums.

## Migrations
- One migration per logical change; never edit a migration that has shipped — add a new one.
- Safe for existing data: add nullable columns (or with defaults) → backfill → then add NOT NULL. Renames = add new + copy + switch + drop later.
- Test the migration on a copy of realistic data; know how to roll back.
- Never run destructive resets (`migrate reset`, `DROP`, deleting the DB file) on anything but a throwaway test DB.

## Queries
- Parameterized queries / ORM bindings only. No string-built SQL.
- Watch for N+1 (loop issuing a query per row) — use joins/`include`/`select_related`/batching.
- Select only needed columns; paginate large results; wrap multi-write operations in a transaction.
- Handle unique-violation and not-found explicitly (→ 409 / 404), not as generic 500s.

## ORM notes
Prisma: `prisma validate`, `migrate dev` locally, `migrate deploy` in CI; `include`/`select` to avoid N+1. Django: `select_related`/`prefetch_related`, `makemigrations --check` in CI. SQLAlchemy/Alembic: autogenerate then review. JPA/Hibernate: beware lazy loading outside transactions, use fetch joins. EF Core: `AsNoTracking` for reads.
SQLite: single writer — keep transactions short; enable foreign keys (`PRAGMA foreign_keys=ON`).
