# C# / F# / ASP.NET Core

**Detect:** `*.sln`, `*.csproj`/`*.fsproj`. **Commands:** `dotnet build` · `dotnet test` · `dotnet format --verify-no-changes`.

## Conventions
- Nullable reference types enabled; no `!` suppression without reason; records for DTOs/value objects.
- `async`/`await` all the way (no `.Result`/`.Wait()`); pass `CancellationToken` through; `ConfigureAwait` per project convention.
- Dependency injection via the built-in container; options pattern (`IOptions<T>`) for config; secrets via user-secrets/env.
- Exceptions for exceptional cases; `ProblemDetails` for API errors; structured logging (`ILogger` with message templates).

## ASP.NET Core
Minimal APIs or controllers consistently; validate input (FluentValidation/data annotations); `[Authorize]`/policies on every endpoint (fallback policy = require auth); EF Core with migrations, `AsNoTracking()` for reads, avoid lazy-loading N+1; `IHttpClientFactory` (never `new HttpClient()` per request).

## F#
Model the domain with records and discriminated unions; `Result` for expected errors; keep side effects at the edges; pipelines over mutation.

## Tests
xUnit (+ FluentAssertions if present); `WebApplicationFactory` for integration tests; Testcontainers for real databases.

## Review focus
Async correctness, nullability, auth policies, EF query shape, disposal (`using`/`IAsyncDisposable`).
