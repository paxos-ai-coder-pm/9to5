# TypeScript / JavaScript / Node

**Detect:** `package.json` (scripts, `"type": "module"`), lockfile (npm/pnpm/yarn/bun — use the matching tool), `tsconfig.json`.
**Commands:** install `npm ci` (or pnpm/yarn/bun equivalent) · type-check `npx tsc --noEmit` · lint `npm run lint` · test `npm test` / `node --test` · build `npm run build`.

## Conventions
- `strict` TypeScript; no `any` (use `unknown` + narrowing); types at module boundaries; `readonly` where possible.
- ESM imports consistently; no default-export soup — follow the repo's style.
- Validate external data (HTTP bodies, env, JSON files) with a schema (Zod/Valibot) and derive types from it.
- Async: always `await` or return promises; `Promise.all` for independent work; no floating promises; handle rejections.
- Errors: throw `Error` subclasses with context; don't swallow; central error handler in Express/Nest/Fastify.
- Config via env with a validated config module; never read `process.env` all over the code.

## Pitfalls
`==` vs `===`; mutating shared objects/arrays; `Date` time zones (store UTC, format at the edge); floating point money; `JSON.parse` without try/validation; path handling on Windows (use `path.join`, not string concat); `fs` sync calls in request handlers; unhandled `EventEmitter` errors.

## Frameworks
Express: validate + `async` handler wrapper; `helmet`, rate limits. NestJS: DTOs with class-validator, modules/providers, guards for auth. Fastify: JSON-schema routes. Bun: prefer `bun test`/`bun install` when the repo uses Bun.

## Review focus
Types honest at boundaries, input validated, errors handled, no blocking I/O in hot paths, tests for logic.
