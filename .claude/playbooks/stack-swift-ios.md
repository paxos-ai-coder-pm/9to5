# Swift / SwiftUI / iOS & macOS

**Detect:** `*.xcodeproj`/`*.xcworkspace`, `Package.swift`. **Commands:** `swift build` / `swift test` for packages; `xcodebuild -scheme <S> -destination 'platform=iOS Simulator,name=iPhone 16' test` for apps. (Requires macOS — on Windows, review and write code but say builds weren't run.)

## Conventions
- Value types (`struct`, `enum`) by default; `final class` when reference semantics are needed.
- Swift concurrency: `async/await`, `@MainActor` for UI state, actors for shared mutable state; no completion-handler pyramids in new code; enable strict concurrency checking where the project does.
- Optionals handled explicitly (`guard let`), no force-unwrap (`!`) outside tests/IBOutlets; `Result`/typed `throws` for failures.
- Codable models separate from view state; dependency injection via initializers/protocols for testability.

## SwiftUI
Small views; state ownership clear (`@State` local, `@Observable`/`ObservableObject` models, `@Environment` for shared services); side effects in `.task {}`; previews for key states; accessibility labels, Dynamic Type, dark mode.

## Platform
Request permissions just-in-time with clear purpose strings in Info.plist; Keychain for secrets (never UserDefaults); background work via proper APIs; handle offline and slow networks.

## Tests
XCTest / Swift Testing for logic and view models; UI tests for critical flows only.

## Review focus
Main-thread UI updates, data races (actors/Sendable), memory cycles (`[weak self]` in escaping closures), permission handling, accessibility.
