# Testing

## The loop (test-first when behaviour is clear)
1. Write a failing test that states the behaviour in plain terms (`returns 404 when the event doesn't exist`).
2. Run it — confirm it fails **for the right reason**.
3. Write the minimum code to pass. Run it. Then refactor with the test green.
When behaviour is exploratory (UI layout, spikes), test after — but before calling it done.

## What to test (in priority order)
1. Business rules and calculations (pure functions — cheapest, most valuable).
2. Boundaries: empty, one, many, max size, invalid types, unicode, time zones, concurrency.
3. Error paths: what the user sees when the network/DB/API fails.
4. Integration seams: API handlers with a real (test) DB, message handlers, serialization.
5. A few end-to-end happy paths for critical flows (sign-up, checkout, save).

## Rules
- One behaviour per test; the name says what and when. Arrange / Act / Assert.
- Tests must be deterministic: no real network, no shared state, fixed clocks and seeds.
- Don't mock what you own at the unit level; mock only external systems (HTTP APIs, email, payments).
- A test that can't fail is useless — briefly break the code and confirm the test catches it.
- Never delete or loosen a failing test to get green; fix the code or report the conflict.
- Keep test data obviously fake (`test+<timestamp>@example.com`).

## Tooling by stack
JS/TS: `node --test`, Vitest, Jest; e2e Playwright. Python: pytest (+ pytest-django / httpx for FastAPI). Go: `go test ./... -race`. JVM: JUnit 5 + Mockito/MockK, Testcontainers. .NET: xUnit. Rust: `cargo test`. Swift: XCTest / Swift Testing. Flutter: `flutter test`. C++: GoogleTest/Catch2. PHP: PHPUnit/Pest. Ruby: RSpec.
If the project has no runner, prefer the zero-install one (`node --test`, `python -m unittest`) over adding dependencies.
