# Rust

**Detect:** `Cargo.toml`. **Commands:** `cargo build` · `cargo test` · `cargo clippy --all-targets -- -D warnings` · `cargo fmt --check`.

## Conventions
- Errors: `Result<T, E>` everywhere fallible; `thiserror` for library error types, `anyhow` (with `.context()`) in applications; no `unwrap()`/`expect()` in non-test code unless the invariant is documented.
- Ownership: borrow (`&T`, `&str`, `&[T]`) in parameters; clone deliberately, not to silence the borrow checker.
- Model states with enums; make invalid states unrepresentable; newtypes for ids/units.
- Keep `unsafe` out unless essential; document every safety invariant.

## Async
Tokio conventions: don't block inside async (use `spawn_blocking`); `Send + 'static` futures for spawned tasks; cancellation-safe `select!` branches; bounded channels for back-pressure.

## Web (Axum/Actix)
Extractors for validated input (`serde` + validation), shared state via `Arc`, errors mapped to responses through `IntoResponse`; `sqlx` compile-checked queries or Diesel.

## Pitfalls
Holding a `Mutex` guard across `.await`, integer overflow in release builds (use checked ops for money/limits), `String` vs `&str` churn, over-generic APIs, ignoring `clippy` warnings.

## Review focus
Error handling (no panics on bad input), async blocking, unsafe blocks, public API ergonomics, tests incl. doc tests.
