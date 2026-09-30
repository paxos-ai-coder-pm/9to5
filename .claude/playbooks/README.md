# Playbooks

Short, practical guides the team reads before working. Every agent reads `_core.md` and — unless the user is a developer — `for-non-developers.md`. The architect picks the relevant stack and practice playbooks for each run and names them in the plan; each agent reads those before starting.

## Practices
| Playbook | Use for |
|---|---|
| `for-non-developers.md` | Building for someone who isn't a developer: lightest stack, their data safe, one-click open (`devstudio.json`, START-HERE.md), plain words |
| `testing.md` | Test-first loop, what to test, unit vs integration vs e2e |
| `review.md` | Code review checklist (reviewer, and devs self-review) |
| `security.md` | OWASP-style checklist, secrets, auth, input handling |
| `debugging.md` | Systematic root-cause debugging |
| `api-design.md` | HTTP/JSON APIs, errors, versioning, pagination |
| `database.md` | Schema design, migrations, queries, SQL/ORM pitfalls |
| `frontend.md` | UI quality, accessibility, state, performance |
| `devops.md` | Docker, CI, env config, deployment |
| `llm-apps.md` | Apps that call LLMs: prompts, cost, evals, safety |

## Stacks
| Playbook | Covers |
|---|---|
| `stack-typescript-node.md` | TypeScript/JavaScript, Node, Express/Nest, Bun |
| `stack-react-nextjs.md` | React, Next.js, Vue/Nuxt, Angular, Svelte |
| `stack-python.md` | Python, Django, FastAPI, Flask, data scripts |
| `stack-go.md` | Go services and CLIs |
| `stack-jvm.md` | Java, Kotlin, Spring Boot, Ktor, Android |
| `stack-dotnet.md` | C#, F#, ASP.NET Core |
| `stack-rust.md` | Rust |
| `stack-swift-ios.md` | Swift, SwiftUI, iOS/macOS |
| `stack-mobile.md` | Flutter/Dart, React Native, Kotlin Multiplatform |
| `stack-cpp.md` | C and C++ |
| `stack-php-ruby.md` | PHP/Laravel, Ruby/Rails |
| `stack-browser-extension.md` | Chrome/Firefox extensions (Manifest V3) |

Keep playbooks short and specific. When a lesson keeps recurring across projects, promote it into the relevant playbook.
