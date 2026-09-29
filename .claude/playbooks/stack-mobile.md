# Cross-platform mobile: Flutter/Dart, React Native, Kotlin Multiplatform

## Flutter / Dart
**Detect:** `pubspec.yaml`. **Commands:** `flutter pub get` · `flutter analyze` · `flutter test` · `dart format --set-exit-if-changed .`
- Sound null safety; immutable models (`freezed` if the project uses it); `const` constructors for widgets.
- State management: follow the project's choice (Riverpod, Bloc, Provider) — don't mix; keep business logic out of widgets.
- `async`: `await` futures, handle errors, cancel subscriptions in `dispose`; avoid rebuilding big trees (split widgets, `const`).
- Platform channels and permissions handled per platform; test on both Android and iOS behaviours.

## React Native (Expo or bare)
**Detect:** `app.json`/`app.config.*` with expo, `react-native` in package.json. **Commands:** `npx expo start`, `npx tsc --noEmit`, `npm test` (Jest + React Native Testing Library).
- Follow `stack-react-nextjs.md` React rules; use `FlatList` for long lists (with `keyExtractor`); avoid inline heavy work in render.
- Secure storage for tokens (`expo-secure-store`/Keychain/Keystore), never AsyncStorage for secrets.
- Handle safe areas, keyboard avoidance, offline, and app backgrounding.

## Kotlin Multiplatform / Compose Multiplatform
Shared business logic in `commonMain` with `expect/actual` for platform APIs; coroutines/Flow shared; UI per platform or Compose Multiplatform per the project.

## Mobile-wide
Permissions just-in-time with clear copy; respect OS dark mode, text scaling, and accessibility; never embed API secrets in the app bundle (use a backend); test slow/no network.

## Review focus
State management consistency, lifecycle/dispose leaks, list performance, secure storage, platform differences.
