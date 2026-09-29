# C / C++

**Detect:** `CMakeLists.txt`, `meson.build`, `Makefile`, `*.vcxproj`. **Commands:** `cmake -S . -B build && cmake --build build && ctest --test-dir build`; enable warnings (`-Wall -Wextra -Werror` / `/W4`) and sanitizers in debug/test builds (`-fsanitize=address,undefined`).

## Modern C++ (17/20)
- RAII for every resource; `std::unique_ptr`/`std::shared_ptr` (prefer unique); no raw `new`/`delete` in application code.
- `std::string_view`/`std::span` for non-owning parameters; `const` correctness; pass large objects by `const&`, sinks by value + move.
- Prefer standard containers/algorithms; `enum class`; `std::optional`/`std::variant`/`std::expected` over sentinel values.
- Rule of zero; mark single-arg constructors `explicit`; `override` on virtuals.

## C
Check every return value; bounds-check all buffer operations (`snprintf`, never `sprintf`/`gets`/`strcpy`); free exactly once; initialize variables; clear ownership comments.

## Concurrency
`std::jthread`/`std::thread` joined properly; mutex + lock guards; atomics only with a clear memory-order reason; test with ThreadSanitizer.

## Pitfalls
Undefined behaviour (signed overflow, out-of-bounds, use-after-free, uninitialized reads), iterator invalidation, dangling references to temporaries, ODR violations, integer narrowing, platform-specific paths/line endings.

## Tests
GoogleTest or Catch2 via CTest; run under ASan/UBSan.

## Review focus
Ownership/lifetimes, bounds, UB, error handling, warnings clean, sanitizer-clean tests.
