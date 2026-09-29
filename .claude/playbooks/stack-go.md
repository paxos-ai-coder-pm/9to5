# Go

**Detect:** `go.mod`. **Commands:** `go build ./...` · `go test ./... -race` · `go vet ./...` · `gofmt -l .` (must be empty) · `golangci-lint run` if configured.

## Conventions
- Accept interfaces, return structs; small interfaces defined where they're used.
- Errors are values: check every `err`; wrap with context `fmt.Errorf("load user %d: %w", id, err)`; `errors.Is/As` to inspect; no `panic` for expected failures.
- `context.Context` first parameter for anything doing I/O; respect cancellation and deadlines.
- Package names short, lowercase, no stutter (`user.Service`, not `user.UserService`); keep `internal/` for non-public code.
- Table-driven tests with `t.Run`; `httptest` for handlers; avoid global state.

## Concurrency
Every goroutine has an owner and a way to stop (context/WaitGroup/errgroup); protect shared state with mutexes or channels (not both ad hoc); always run tests with `-race`; close channels only from the sender.

## Pitfalls
Loop variable capture in goroutines (older Go), nil maps, ignoring `rows.Err()`/`Close()`, `defer` in loops, unbounded goroutine fan-out, time without `UTC()`, JSON field tags missing (`json:"name"`).

## Review focus
Error handling and wrapping, context propagation, goroutine lifecycles, race-free tests, clear package boundaries.
