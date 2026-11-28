# Security Summary

SchuleFlow Uganda was hardened across authentication, session management, multi-tenant database isolation, high-concurrency stability, CSRF protection, and client offline caching.

## Remediated Security & Reliability Findings

1. **Client Token Storage Exposure Eliminated (`src/context/SchoolContext.tsx`)**
   - Removed raw session token persistence from browser `localStorage` and `sessionStorage` and scrubbed any legacy stored keys on startup and sign-out.
   - Browser sessions now stay strictly in-memory for Bearer requests while page reloads rely solely on the server-issued `HttpOnly` `sf_session` cookie (`SameSite=None; Secure; Partitioned` over HTTPS, `SameSite=Lax` over HTTP local development).

2. **Server-Side Session Revocation & Recovery Replay Prevention (`src/db/users.ts`, `src/db/repository.ts`, `src/middleware/auth.ts`, `src/lib/passwordAuth.ts`, `server.ts`)**
   - Added persistent per-user session invalidation watermarks (`sva:<uid>` in `platform_runtime_config`) checked inside `getAuthContextByUid` against every token's issued timestamp (`iat`).
   - Logout (`/api/v1/auth/logout`), password change (`/api/v1/auth/change-password`), password recovery completion, and administrator account deactivation, role reassignment, or password reset all revoke prior active tokens immediately.
   - Added `jti` one-time consumption tracking (`consumeRecoveryTokenJti`) and issued-timestamp checking on password recovery tokens so a `resetToken` cannot be replayed twice.
   - Hardened recovery verification (`/api/v1/auth/recover/verify`) to require a matching full registered email address, full phone number, or Staff ID—rejecting partial 4-digit phone suffix guesses.

3. **Cross-Origin Request & Security Header Protection (`server.ts`, `src/utils/apiClient.ts`)**
   - Enforced same-host/allowed-origin checks and `X-Requested-With: SchuleFlow-Client` verification on mutating `/api/v1/*` requests to block cross-origin and ambient cookie-only state modifications.
   - Disabled `X-Powered-By` and added `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, and `Cache-Control: no-store, no-cache, must-revalidate, private` on API endpoints while preserving iframe preview compatibility.
   - Updated rate-limit client IP extraction (`src/middleware/rateLimit.ts`) to use the server's trusted `req.ip` / socket address instead of caller-controlled `X-Forwarded-For` headers, and added a 600 req/min mutation limiter on `/api/v1/*`.

4. **Strict Multi-Tenant Foreign-Key & Schema Validation (`src/db/repository.ts`, `src/lib/validationSchemas.ts`, `server.ts`)**
   - Added school ownership checks before persisting student registrations, student updates, examination periods, marksheets, and term remarks so records referencing a different school's `classId`, `examId`, `subjectId`, or `studentId` are rejected with HTTP `400`.
   - Added explicit request body validation schemas for school settings (`PUT /settings`), subscription updates (`PATCH /platform/schools/:id`), report printing counters (`POST /reports/track`), and all password recovery endpoints.
   - Restricted direct spreadsheet file parsing (`src/utils/excel.ts`) to a 10 MB maximum file size on the client.

5. **High-Concurrency Database Stability (`src/db/index.ts`, `src/db/repository.ts`, `src/middleware/auth.ts`, `src/middleware/tenant.ts`)**
   - Tuned PostgreSQL connection pooling (`DB_POOL_MAX`, default 25 connections) and consolidated auth/tenant queries to reuse loaded school context (`req.school` and `req.subscriptionGate`).
   - Added per-school PostgreSQL transaction advisory locks (`pg_advisory_xact_lock`) on concurrent student registration (`addStudentsWithQuotaCheck`) and staff creation (`upsertTenantStaffMember`), preventing duplicate sequential ID collisions and quota race conditions across simultaneous multi-school writes.
   - Chunked bulk student inserts and promotions (`CHUNK_SIZE = 250`) and translated unique constraint collisions (`23505`) during concurrent initial marksheet creation into clean `409 Conflict` responses.

6. **Offline-First Caching Hygiene (`src/lib/offlineSync.ts`, `src/context/SchoolContext.tsx`, `vite.config.ts`)**
   - Configured Workbox service worker precaching with `navigateFallbackDenylist: [/^\/api\//]` so authenticated API responses are never cached in shared HTTP/Service Worker storage.
   - Scoped IndexedDB workspace snapshots and queued offline mutations strictly by `(schoolId, uid)` and wiped all offline snapshots, session metadata, and queued entries on sign-out or HTTP `401`/`403` authentication failure.

## Dependency Audit Status

- Executed `bun audit`: reported 2 high-severity advisories on client-side `xlsx@0.18.5` (Prototype Pollution and ReDoS in browser workbook parsing, unused by the server API) and 3 moderate build/dev tooling advisories (`esbuild`, `glob`, `minimatch` in `vite`, `tsx`, `drizzle-kit`, and `vite-plugin-pwa`). Added a 10 MB size guard in `src/utils/excel.ts`; server runtime routes never invoke `xlsx`.

---

## PoC Verification

All verification checks below ran against the live PostgreSQL-backed Express server and compiled application bundle (`TEST_MODE=true npm test`: **32/32 tests passed across 6 suites**):

1. **Cross-Origin CSRF & Cookie-Only Request Blocking (`tests/tenantSecurity.test.ts` + Live Server `curl`)**
   - Sending `PUT /api/v1/schools/:schoolId/settings` with `Origin: https://attacker.example` returned HTTP `403` with `X-Content-Type-Options: nosniff`.
   - Live `curl` against `http://127.0.0.1:3000/api/v1/auth/login` with `Origin: https://attacker.example` returned `403`.
   - Sending a cookie-authenticated `PUT` mutation without an allowed `Origin` or `X-Requested-With: SchuleFlow-Client` header returned HTTP `403`.

2. **Server-Side Session Revocation & Recovery Replay Prevention (`tests/tenantSecurity.test.ts`)**
   - Calling `POST /api/v1/auth/logout` immediately invalidated the active Bearer session token (`POST /api/v1/auth/sync` returned `401`).
   - Calling `POST /api/v1/auth/change-password` invalidated the prior token (`401`) while authorizing the newly issued token (`200`).
   - Attempting password recovery verification with a 4-digit phone suffix (`6161`) returned `401`; verifying with the full phone (`+256 772 616161`) issued a single-use `resetToken` whose first use succeeded (`200`) and immediate second replay attempt returned `401`.

3. **Cross-Tenant Foreign Key & Payload Validation (`tests/tenantSecurity.test.ts`)**
   - Admin A attempting to create a marksheet or student in School A while referencing School B's `classId` / `examId` / `subjectId` was rejected with HTTP `400`.
   - Super Admin attempting to read School B's `/bootstrap` academic records was rejected with HTTP `403`.
   - Invalid negative counts (`POST /reports/track` with `count: -10`) and invalid settings payloads (`schoolName: ""`) were rejected with HTTP `400`.

4. **1,000-Entry Concurrent Multi-School Stability Benchmark (`tests/tenantSecurity.test.ts`)**
   - Dispatched **1,000 concurrent HTTP+PostgreSQL student creation entries simultaneously** (500 in School A and 500 in School B across parallel 100-request waves).
   - **Result**: 1,000 / 1,000 succeeded (`0` failures, `0` duplicate ID/quota errors), exact tenant totals verified at `500` and `500`, and zero cross-tenant record leakage.

5. **Offline-First Sync & Dynamic Report Cards (`tests/offlineSync.test.ts`, `tests/calculations.test.ts`)**
   - Verified offline snapshot tenant+user isolation, marksheet draft coalescing preserving initial concurrency versions, FIFO reconnect replay, graceful pause on network loss, `409 Conflict` quarantine, and complete IndexedDB wipe on sign-out (`4/4` tests passed).
   - Verified `getReportCardVisibleAssessments` renders only assessments with recorded marks (`U1 + EoT` omits `U2/U3`; `EoT`-only omits `U1/U2/U3/AoI`; `A-Level U1 + EoT` displays `U1` alongside `EoT`) (`8/8` tests passed).
   - Verified live PWA `/manifest.webmanifest` (`200 OK`) and security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`) on port 3000.
