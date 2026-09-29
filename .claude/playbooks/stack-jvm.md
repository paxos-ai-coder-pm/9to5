# Java / Kotlin (Spring Boot, Ktor, Android)

**Detect:** `pom.xml` (Maven) or `build.gradle(.kts)` (Gradle — use the wrapper `./gradlew`). **Commands:** `./gradlew build` / `./gradlew test` or `mvn -q verify`; Android `./gradlew assembleDebug testDebugUnitTest lint`.

## Java
- Modern Java (17+): records for data, `Optional` for absent returns (not fields/params), streams where clearer, `var` for obvious types.
- Immutability by default; constructor injection; no field injection.
- Exceptions: specific, unchecked for programming errors; never catch `Exception` to ignore.

## Kotlin
Null-safety honestly (avoid `!!`); data classes; `sealed` classes for states/results; coroutines with structured concurrency (`coroutineScope`, `viewModelScope`), `Flow` for streams; `suspend` for I/O — never block with `runBlocking` in app code.

## Spring Boot
Controllers thin → services → repositories; DTOs + Bean Validation (`@Valid`); `@ControllerAdvice` for consistent errors; `@Transactional` on service methods (not controllers); Spring Security on every endpoint (deny by default); config via `application.yml` + env, profiles for dev/test/prod; tests with `@WebMvcTest`/`@DataJpaTest`, Testcontainers for real DBs.

## Ktor
Plugins for serialization/auth/status pages; routes grouped by feature; validate request bodies.

## Android
MVVM/UDF: ViewModel + immutable UI state + Compose; repositories behind interfaces; Room for local data; work off the main thread (coroutines/Dispatchers.IO); handle config changes and process death; request runtime permissions just-in-time.

## Pitfalls
JPA lazy loading outside transactions (LazyInitializationException), N+1 queries, `equals/hashCode` on entities, mutable shared state in singletons, leaking Context/Activity in Android.

## Review focus
Layering, validation, transaction boundaries, security config, coroutine/thread correctness.
