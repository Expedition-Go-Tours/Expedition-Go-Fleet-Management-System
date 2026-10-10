# Expedition Go Tours — Authentication & Authorization Specification

> **⚠️ HISTORICAL / PARTIALLY SUPERSEDED.** The *conceptual* security model in
> this document (invite-only access, server-side authorization on every request,
> permission checks, resource scoping, session revocation, audit logging and the
> role boundaries) **remains authoritative**. The **storage/session technology
> recommendations are NOT the implemented architecture**:
>
> - **Redis-backed sessions → NOT USED.** Sessions are opaque, server-managed and
>   persisted in **Cloud Firestore** (`sessions`), with a SHA-256 hashed token.
> - **PostgreSQL + Prisma → NOT USED.** Employee profiles, roles, permissions and
>   audit records live in **Cloud Firestore**.
> - **Node.js + Express → NOT USED.** The API is implemented with **Next.js App
>   Router route handlers** under `/api/v1/*` on Vercel.
>
> The current, binding architecture is [`ARCHITECTURE.md`](./ARCHITECTURE.md).
> Read this document for the authorization *contract*; read ARCHITECTURE.md for
> how it is actually built. Where the two disagree on storage or runtime, the
> implemented architecture wins.

**Document type:** Production implementation specification (security model)  
**Application:** Internal vehicle maintenance and fleet management  
**Scope:** Staff identity, sessions, permissions, audit events, and account lifecycle  
**Status:** Security model authoritative; storage/runtime recommendations superseded by ARCHITECTURE.md

## 1. Executive decision

Build an invite-only internal application. Use Firebase Authentication for identity verification, an opaque server-managed application session backed by Redis, and PostgreSQL as the source of truth for employee status, roles, and permissions. Enforce authorization on the backend for every request and every record.

Do not build a custom password store. Do not allow public sign-up. Do not trust roles or user IDs supplied by the browser. Do not use frontend route guards as the security boundary.

### Recommended stack

- React + TypeScript frontend.
- Node.js + Express + TypeScript backend.
- Firebase Authentication for sign-in, identity verification, and supported MFA flows.
- Redis-backed server-side sessions (for example, `express-session` with a maintained Redis store).
- PostgreSQL + Prisma for employee profiles, role assignments, permissions, and audit records.
- One authoritative authentication/session strategy for the browser; do not invent parallel access-token and refresh-token flows.

Prefer serving the frontend and API from the same site, ideally the same origin through a reverse proxy, such as `https://fleet.expeditiongotours.com` and `https://fleet.expeditiongotours.com/api/*`. If the API must be on another origin, allow only the exact frontend origin and configure credentialed CORS and CSRF protections deliberately.

## 2. Security objectives

1. Only approved Expedition Go Tours staff can sign in.
2. Disabled, suspended, or offboarded staff lose access promptly.
3. Every API request is authenticated and authorized server-side.
4. Access is limited by role, specific permission, and record scope.
5. Sensitive actions are logged with an attributable actor and timestamp.
6. Drivers cannot see fleet-wide financial data or modify operational status.
7. Users cannot release a vehicle with an active safety hold unless explicitly granted the release permission and all required checks pass.
8. A compromised browser session can be revoked without changing an employee's role or password.
9. Authentication and authorization failures are monitored without leaking secrets.

## 3. Identity and onboarding

### 3.1 No public self-registration

- Disable public account creation in the application.
- An administrator invites an employee using their company-managed email address or another approved contact identity.
- An invitation creates an `INVITED` application user, assigns the initial role, and sends a provider-managed setup/verification link.
- Invitation/setup links must be single-use and time-limited. Use Firebase's supported action links where practical; do not log or store raw invitation secrets.
- Re-sending an invitation invalidates or supersedes the previous invitation where supported.
- Email-domain checks may be an additional guard but must not replace an explicit invitation and account record.
- Do not allow users to choose their own roles during registration.

### 3.2 Application user status

Use these states:

- `INVITED`: invitation issued; not yet enabled for normal application access.
- `ACTIVE`: may authenticate and use assigned permissions.
- `SUSPENDED`: temporarily blocked; sessions must be revoked.
- `DISABLED`: employment/access ended; sessions must be revoked.

Only an authorized administrator may change account status. Require a reason for suspension or disabling. Do not hard-delete a user who has authored reports, work orders, expenses, or audit events; retain a deactivated historical identity.

### 3.3 MFA

- Require MFA for `ADMIN`, `MANAGER`, and `FINANCE` users.
- Encourage or require MFA for all staff as operationally practical.
- Prefer passkeys/security keys or an authenticator-based method when supported. Do not make SMS the only option for privileged users.
- Provide a controlled recovery process. Recovery codes, where offered, must be single-use and stored only in protected/hashed form by the provider or application.
- Log MFA enrollment, removal, recovery, and reset events.
- Require recent reauthentication plus MFA for sensitive account/security changes and privileged role changes.

### 3.4 Passwords and recovery

Firebase should own password storage, reset tokens, password hashing, and account recovery. The application must never store plaintext passwords or build its own password-reset token flow.

If password policy can be configured, use long passphrases, block common/known-compromised passwords, permit password managers and paste, avoid arbitrary periodic rotation, and require a reset when compromise is suspected. Return generic login/recovery messages that do not reveal whether an email address is registered.

## 4. Authentication and session flow

Use this flow for the browser application:

1. The user signs in through Firebase Authentication.
2. The client sends the short-lived Firebase ID token to a same-site HTTPS session-establishment endpoint. The request must pass Origin/CSRF checks appropriate to the bootstrap flow.
3. The backend verifies the token using Firebase Admin SDK, including signature, audience/project, issuer, expiry, and revocation checks where available. Require recent authentication for session creation (recommended `auth_time` within the previous five minutes).
4. The backend looks up the corresponding application user by the Firebase UID. The UID must be unique, the user must be `ACTIVE`, and the user's MFA policy must be satisfied.
5. The backend creates a new, random, opaque server-side session in Redis. Regenerate the session identifier at login to prevent session fixation.
6. The browser receives the session cookie. The client then clears its Firebase client-side authentication state if using a server-session pattern; application API calls use the session cookie only.
7. On each API request, the backend loads the session, verifies the session is active, loads the current application user, rejects non-active users, and evaluates the required permission and record scope.
8. Logout destroys the current server-side session and clears the cookie.

Do not accept Firebase UIDs, user IDs, role names, permissions, or `reportedById` from the browser as proof of identity. Derive actor identity from the verified server-side session.

### 4.1 Session cookie

Use a cookie with these attributes:

- Name: `__Host-egt_session` (or another name with the same required `__Host-` properties).
- `Secure: true` in production.
- `HttpOnly: true`.
- `SameSite: Lax` by default; choose `Strict` only after checking navigation and login flows.
- `Path=/`.
- No `Domain` attribute.
- No session ID or bearer token in local storage, URLs, analytics events, or logs.

The `__Host-` prefix requires a secure cookie, root path, and no `Domain` attribute. If session cookies are used, CSRF protections are still required.

### 4.2 Recommended timeouts

Set the browser cookie lifetime and Redis TTL consistently. A practical baseline is:

- Standard staff: 60-minute idle timeout, 12-hour absolute lifetime.
- Privileged users (`ADMIN`, `MANAGER`, `FINANCE`): 30-minute idle timeout, 8-hour absolute lifetime.
- Warn users shortly before expiry and preserve unsaved form drafts safely where practical.
- Require recent reauthentication (e.g. within 10 minutes) for privileged operations such as role assignment, account recovery/security changes, expense voiding, and clearing a safety hold/releasing a vehicle where policy requires it.

These are starting policy values. Adjust them for the company's operating hours and device risk, but do not create indefinite sessions.

### 4.3 Session registry and revocation

Maintain a session index so an administrator can revoke all sessions for a user and the user can sign out. If the MVP exposes an active-sessions page, store non-secret metadata such as creation time, last activity, expiry, and a coarse user-agent label. Never store or display raw session IDs.

On logout, destroy the current Redis session. On suspension, disablement, role changes, suspected compromise, or forced sign-out, revoke sessions associated with the user. A request from a revoked session must fail even if its cookie has not expired.

Store sessions in Redis, not Express's in-memory session store. Protect Redis with private networking, authentication, and TLS where traffic crosses hosts/networks. Configure Redis TTLs and a clear failure policy; if the session store is unavailable, fail closed for protected requests.

## 5. CSRF, CORS, and browser security

Because the browser sends session cookies automatically, use multiple CSRF controls:

- Use a maintained synchronizer-token or equivalent robust CSRF mechanism for state-changing requests.
- Validate `Origin` (and `Referer` as a fallback where appropriate) against the exact expected origin.
- Use `SameSite=Lax` or stricter cookie settings as defense in depth, not as the only CSRF protection.
- Never mutate data from `GET`, `HEAD`, or `OPTIONS` handlers.
- Send the CSRF value in a custom request header, such as `X-CSRF-Token`; reject unsafe requests with missing/invalid tokens.
- Configure CORS with an explicit origin allowlist. Never combine credentialed requests with wildcard `Access-Control-Allow-Origin: *`.
- Do not broaden a cookie to `.expeditiongotours.com` unless there is a demonstrated need. A host-only cookie is preferred.

Also enforce HTTPS, HSTS, a restrictive Content Security Policy compatible with the frontend, secure response headers, correct output encoding, dependency patching, input validation, and upload security. An HttpOnly cookie reduces token theft through JavaScript but cannot make XSS harmless.

## 6. Authorization design

### 6.1 Source of truth

- Store application roles and permissions in PostgreSQL.
- Use Firebase to establish identity, not as the sole source of application authorization.
- The server must retrieve current account status and role/permission assignments for protected requests, or use a carefully invalidated, short-lived server-side cache.
- Do not rely on client-side role state, hidden UI controls, or stale custom claims to authorize API calls.
- Default to deny when a role, permission, resource relationship, or policy is missing or ambiguous.

### 6.2 Authorization layers

Every protected operation must pass all relevant checks:

1. **Authentication:** a valid, active session exists.
2. **Account state:** the application user is active.
3. **Permission:** the user's current role grants the action.
4. **Record scope:** the user may access that particular report, vehicle, work order, expense, attachment, or user record.
5. **Business invariants:** the state transition is valid (e.g. a vehicle cannot be released while a safety hold remains active).

Checking only that a user is logged in, or only that they have a broad role such as `MAINTENANCE`, is insufficient.

### 6.3 Permission keys

Use explicit permission strings rather than scattering hard-coded role checks throughout controllers:

```text
vehicle:read
vehicle:create
vehicle:update
vehicle:archive
vehicle:status:update
vehicle:release

report:create
report:read:own
report:read:all
report:triage
report:update
report:close

work_order:read
work_order:create
work_order:update
work_order:complete
work_order:close
work_order:reopen

expense:read
expense:create
expense:update
expense:void
expense:payment:update
expense:export

provider:read
provider:create
provider:update

audit:read
user:read
user:invite
user:disable
user:role:assign
settings:update
```

Only grant the permissions actually needed by each role. Additional per-user grants may be used for unusual responsibilities, but they must be explicit, auditable, and visible to administrators.

### 6.4 Baseline role matrix

| Capability | Driver | Operations | Maintenance | Finance | Manager | Admin |
|---|---|---|---|---|---|---|
| Read relevant vehicle information | Yes | All | All | Limited | All | Support need |
| Submit maintenance report | Yes | Yes | Optional | No | Optional | Support need |
| Read own reports | Yes | Yes | Yes | Limited | Yes | Support need |
| Read/triage all reports | No | Yes | Yes | Limited | Yes | Support need |
| Create/manage work orders | No | Read/coordinate | Yes | No | Read | Support need |
| Record expenses | No | Optional | Yes, if granted | Yes | Read | Support need |
| Change payment status | No | No | No by default | Yes | Read | No by default |
| Void/correct expenses | No | No | No by default | Yes, with reason | Read | No by default |
| Read financial totals | No | Limited summary | Limited | Yes | Yes | Only if needed |
| Release vehicle | No | No by default | Only with `vehicle:release` | No | Only if granted | No automatic bypass |
| Manage users/roles | No | No | No | No | No by default | Yes |
| Read audit logs | No | Limited | Limited | Financial events | Yes | Yes |

“Limited” and “Support need” must be translated into explicit record scope and fields. A user interface hiding a page is not enforcement. Finance should not be able to change repair details or release vehicles. Administrative access should not silently bypass safety and financial invariants.

### 6.5 Resource-level checks

Examples:

- A driver can read a report only when `reportedById` matches their user ID, except for explicitly permitted shared vehicle/status information.
- A driver cannot change a report's vehicle, reporter, severity, or workflow status after submission unless a controlled correction flow grants that action.
- A report's `vehicleId` must match the vehicle linked to its work order.
- An expense's `vehicleId` must match its linked work order's vehicle.
- An attachment must be authorized through its parent report, work order, expense, or vehicle; knowing an attachment UUID must not bypass parent access.
- Users cannot self-assign roles or permissions.
- The last active administrator cannot be disabled or demoted without an approved recovery procedure.
- A vehicle cannot transition to `AVAILABLE` while a safety hold is active. Clearing the hold requires the appropriate permission, recorded checks, a reason, and audit event.

### 6.6 State transitions are backend policy

Do not accept arbitrary `status` fields in generic PATCH endpoints. Use action endpoints with specific validators, such as:

- `POST /api/v1/maintenance-reports/:id/triage`
- `POST /api/v1/work-orders/:id/start`
- `POST /api/v1/work-orders/:id/complete`
- `POST /api/v1/vehicles/:id/release`
- `POST /api/v1/expenses/:id/void`

Each handler must verify the required permission, the current state, resource relationships, and any mandatory reason/checklist before applying the transition in a transaction.

## 7. User, role, and session administration

Provide an administrator-only Users & Access section with:

- Searchable staff list with account state, roles, last sign-in, MFA status where available, and invitation status.
- Invite/resend invitation/deactivate actions.
- Role assignment and removal with confirmation and reason.
- A view of active session metadata and a revoke-sessions action if session registry support is enabled.
- Audit history for role and status changes.
- Protection against self-escalation and accidental loss of the last administrator.

Do not allow role changes by editing a profile field. Route them through a dedicated backend action that reauthenticates the administrator, checks permission, writes the audit record, updates the assignment, and revokes existing sessions if privileges were materially changed.

## 8. Database model

Suggested core models (adapt names to the existing codebase):

### `User`

- `id` UUID primary key
- `firebaseUid` unique, not nullable
- `name`, `email`, optional `phone`
- `status` enum: `INVITED | ACTIVE | SUSPENDED | DISABLED`
- `lastLoginAt`, `createdAt`, `updatedAt`, `disabledAt`

### `Role`

- `id`, unique `key`, `name`, `description`, `isSystemRole`

### `Permission`

- `id`, unique `key`, `description`

### `UserRole`

- `userId`, `roleId`, `assignedById`, `assignedAt`, optional `reason`
- Unique constraint on `(userId, roleId)`

### `RolePermission`

- `roleId`, `permissionId`
- Unique constraint on `(roleId, permissionId)`

### `UserPermission` (optional MVP extension)

- `userId`, `permissionId`, `effect` (`ALLOW` or `DENY`), `assignedById`, `reason`, `createdAt`
- Use only if the company genuinely needs per-user exceptions. A simple fixed role matrix is easier to audit initially.

### `UserSession` (session index/audit)

- `id`, `userId`, opaque session reference or keyed hash (never raw secret)
- `createdAt`, `lastSeenAt`, `expiresAt`, `revokedAt`
- Optional coarse `userAgentLabel` and risk metadata
- Link entries to Redis sessions so all sessions for one employee can be revoked.

### `SecurityEvent` / `AuditLog`

- `id`, optional `actorId`, `eventType`, `entityType`, `entityId`
- `before` and `after` JSON where appropriate
- `reason`, `requestId`, `createdAt`
- Keep security-event logging and business audit purpose distinct even if they share an implementation. Logs must not contain passwords, ID tokens, session IDs, MFA codes, reset links, or signed document URLs.

All role/permission changes must use database transactions and emit an audit event. Use foreign keys and restrictive deletion behavior so historic activity remains attributable.

## 9. Backend implementation pattern

Organize the middleware/services around three separate checks:

- `requireAuthenticatedUser`: loads and validates the server-side session and current active user.
- `requirePermission('permission:key')`: verifies the current permission from the authoritative database or a properly invalidated server-side cache.
- `authorizeResource(...)`: checks ownership/scope and record relationships for the target object.

Example intent (pseudocode, not drop-in code):

```ts
router.post(
  '/maintenance-reports',
  requireAuthenticatedUser,
  requirePermission('report:create'),
  validateBody(createMaintenanceReportSchema),
  createMaintenanceReportHandler,
);

router.get(
  '/maintenance-reports/:id',
  requireAuthenticatedUser,
  loadMaintenanceReport,
  authorizeReportReadScope,
  getMaintenanceReportHandler,
);
```

The create handler must set `reportedById` from `req.user.id`, not from the submitted JSON. The read handler must perform record-scope authorization before returning the object. All validation and authorization must be performed on the server.

Use explicit allowlists when updating records; do not spread request bodies directly into Prisma updates. Never allow the client to set fields such as `createdById`, `reportedById`, `assignedById`, role assignments, audit fields, or a privileged status transition through mass assignment.

## 10. Audit events and monitoring

Record at least:

- Successful and failed sign-ins (without secrets).
- Invitation issued, accepted, expired, or resent.
- MFA enrolled, removed, or recovered.
- Session created, logged out, expired, or revoked.
- Suspended/disabled account attempts.
- Authorization denials and repeated access failures.
- Role/permission assignment changes.
- User suspension/deactivation.
- Safety-hold creation/clearance and vehicle release.
- Odometer corrections and service-history corrections.
- Expense amount changes, invoice changes, payment updates, and expense voids.
- Sensitive document access/export events where justified.

Each event should have a timestamp, actor (when known), action, target record, request/correlation ID, and outcome. Protect logs from ordinary update/delete operations and restrict who can read them. Alert on repeated login failures, new administrator grants, suspicious permission-denial spikes, and unusual privileged activity.

Never log passwords, raw access/ID tokens, cookies, session identifiers, MFA values, password reset/invitation secrets, or private invoice URLs. Sanitize untrusted values to prevent log injection.

## 11. Rate limiting and error handling

- Apply rate limits to login/session establishment, password-reset/invitation flows, MFA recovery, and upload endpoints.
- Combine IP-based limits with account/provider-aware protection; avoid permanent lockouts that an attacker could use to deny service to a staff member.
- Use progressive delays and monitoring for repeated failures.
- Return generic authentication errors that do not disclose whether an email exists.
- Return consistent `401` for unauthenticated requests and `403` for authenticated users lacking permission, unless the resource-disclosure policy deliberately returns `404`.
- Do not expose stack traces, internal authorization policy details, Firebase service-account errors, or secrets to clients.
- Fail closed if a permission cannot be evaluated or the session store is unavailable.

## 12. Sensitive uploads and data

Maintenance photos, invoices, and receipts may contain business and personal information.

- Store them in private object storage or outside the public web root.
- Validate file extension, MIME type, size, and content; do not trust the browser-provided content type.
- Use randomized storage keys and authorized, short-lived download links or a protected download handler.
- Apply the same parent-record permission checks to uploads and downloads.
- Limit allowed formats and size, and add malware scanning where practical.
- Avoid public, permanently accessible invoice URLs.

## 13. Required tests before production

### Authentication

- Active invited user can complete onboarding and sign in.
- Unknown, suspended, disabled, or uninvited user cannot access application APIs.
- Invalid, expired, revoked, wrong-project, or malformed Firebase token cannot create a session.
- Session fixation is prevented by regenerating the session ID at authentication.
- Logout destroys the session; a revoked session is rejected even if a stale cookie remains.
- Session expiry and idle timeout work as configured.
- Privileged users cannot bypass the MFA requirement.
- Password-reset and login responses do not disclose account existence.

### Authorization

- Test every endpoint as every role, not only the happy path.
- A driver cannot list/download another driver's private report or expense document.
- Changing UUIDs in URLs does not grant access to another user's record.
- A client cannot change its user ID, role, permission, reporter ID, or privileged workflow status through request-body manipulation.
- Finance cannot release a vehicle or alter repair workflow.
- Maintenance cannot update payment status or void expenses unless explicitly granted those permissions.
- Admin cannot use a generic bypass to violate vehicle safety invariants.
- Disabled users are denied on the next protected request.
- Role changes and session revocation take effect according to the documented policy.

### Web/session security

- Missing/invalid CSRF token and untrusted Origin are rejected on state-changing requests.
- CORS does not allow arbitrary origins with credentials.
- Session cookies have the expected production flags.
- `GET` endpoints do not mutate state.
- File uploads/downloads enforce both authentication and record-level authorization.
- Security/audit logs contain no tokens, passwords, cookies, reset links, or MFA secrets.

Run integration tests against PostgreSQL and the configured session store, not only mocked repositories. Include dependency/security scanning and a release checklist for secrets, HTTPS, backups, and log access.

## 14. Implementation order

### Phase 1 — Identity and session foundation

1. Configure Firebase Auth and approved sign-in methods.
2. Create `User`, `Role`, `Permission`, and assignment migrations.
3. Implement invite-only onboarding and account state.
4. Implement the session-establishment endpoint and Redis-backed sessions.
5. Add secure cookie flags, CSRF validation, logout, expiry, and revocation.
6. Add MFA policy for privileged roles.

### Phase 2 — Authorization enforcement

1. Create the permission catalog and seed role-permission assignments.
2. Implement authentication, permission, and resource-scope middleware.
3. Protect every vehicle, report, work-order, expense, attachment, export, and admin endpoint.
4. Move status transitions into explicit action endpoints.
5. Add audit events for role changes, expense mutations, and safety-critical operations.

### Phase 3 — Administrative controls and verification

1. Build the Users & Access UI.
2. Add disable/suspend and revoke-session workflows.
3. Add security-event monitoring and relevant alerts.
4. Complete the cross-role endpoint test matrix and IDOR/CSRF tests.
5. Test production cookie settings, reverse-proxy trust settings, Redis unavailability, account offboarding, and backup restoration.
6. Pilot with a small number of staff before enabling all users.

## 15. Definition of done

The authentication/authorization system is ready for production when:

- Public registration is disabled.
- Only invited, active staff can establish sessions.
- Admin/manager/finance MFA policy is enforced.
- Sessions are HttpOnly, Secure, CSRF-protected, time-limited, and revocable.
- The database is the source of truth for active status and role assignments.
- Every protected endpoint has a permission and record-scope decision.
- Business invariants (especially the safety hold and vehicle-release flow) are enforced on the backend.
- User, role, session, expense, and safety-critical changes are auditable.
- Cross-role, IDOR, CSRF, disabled-account, and session-revocation tests pass.
- Monitoring, secrets management, dependency updates, and an incident/offboarding procedure are documented.

## References

- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- Firebase Admin SDK: https://firebase.google.com/docs/auth/admin
- Firebase session cookie management: https://firebase.google.com/docs/auth/admin/manage-cookies
- Firebase session revocation: https://firebase.google.com/docs/auth/admin/manage-sessions
