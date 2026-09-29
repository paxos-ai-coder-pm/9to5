# React / Next.js (and Vue, Angular, Svelte)

**Detect:** `next.config.*`, `app/` or `pages/`, `vite.config.*`, `nuxt.config.*`, `angular.json`, `svelte.config.*`.
**Commands:** dev `npm run dev` · build `npm run build` (catches server/client and type errors) · lint · test (Vitest/Jest + Testing Library; Playwright for e2e).

## Next.js
- **Check the installed version's docs** (`node_modules/next/dist/docs/` when present) — APIs, caching and routing conventions change between majors.
- App Router: Server Components by default; `"use client"` only for interactivity/state/browser APIs, as low in the tree as possible. Never import server-only code (DB, secrets) into client components.
- Data: fetch in Server Components or server actions/route handlers; validate inputs in server actions (they're public endpoints); check auth inside them.
- Use the framework primitives: `next/link`, `next/image`, metadata API, `loading.tsx`/`error.tsx`/`not-found.tsx`.
- Env: only `NEXT_PUBLIC_*` reaches the browser — keep secrets unprefixed.

## React
- Components small and pure; derive values instead of syncing state with effects; `useEffect` only for real side effects (with cleanup).
- Stable `key`s from data ids (not indexes) for dynamic lists; lift state only as high as needed.
- Forms: controlled or form library consistently; disable submit while pending; show errors per field.
- Server state via the project's data layer (RSC, TanStack Query, SWR) — not hand-rolled fetch-in-effect.

## Vue / Nuxt · Angular · Svelte
Vue: Composition API + `<script setup>`, `computed` over watchers, props down/events up; Nuxt `useFetch`/server routes. Angular: standalone components, signals, typed reactive forms, `OnPush`, services for data. Svelte/SvelteKit: `load` functions for data, form actions for mutations, runes in Svelte 5.

## Pitfalls
Hydration mismatches (dates/random/`window` during render), leaking secrets to the client bundle, effects with missing deps or no cleanup, unbounded re-renders, huge client bundles from server-only libraries.

## Review focus
Server/client boundary, auth in every server action/route, accessibility (`frontend.md`), loading/empty/error states.
