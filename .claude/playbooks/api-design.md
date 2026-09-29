# API design (HTTP/JSON)

- **Resources & verbs:** nouns in paths (`/events/{id}/rsvps`), verbs from HTTP: GET read (safe, cacheable), POST create/command, PUT replace, PATCH partial update, DELETE remove. Make PUT/DELETE idempotent; accept an `Idempotency-Key` for risky POSTs (payments, orders).
- **Status codes:** 200 ok, 201 created (+ `Location`), 204 no content, 400 invalid input, 401 not authenticated, 403 not allowed, 404 not found (also for resources the caller may not see), 409 conflict, 422 validation (if the project uses it), 429 rate limited, 5xx server bugs only.
- **Errors:** one consistent shape, e.g. `{ "error": { "code": "EVENT_FULL", "message": "…", "details": {…} } }`. Machine-readable code + human message; never stack traces.
- **Validation:** schema-validate every request body/query at the edge; return all field errors at once.
- **Collections:** paginate by default (cursor-based for feeds, `limit` capped); stable sort; filter/sort via query params.
- **Evolution:** additive changes only (new optional fields); never change meaning of an existing field; version (`/v2` or header) for breaking changes.
- **Contracts:** types shared or generated (OpenAPI, tRPC, Zod) so client and server can't drift. Document each endpoint's auth requirement.
- **Performance:** avoid chatty APIs and N+1 on the server; return what the screen needs; ETag/Cache-Control for public reads.
- **Time & money:** ISO-8601 UTC timestamps; money as integer minor units + currency code.
