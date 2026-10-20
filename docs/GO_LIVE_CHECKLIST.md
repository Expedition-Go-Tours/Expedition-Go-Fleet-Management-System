# Go-live checklist

Plain-language list of what is done, and what still needs you before this runs
for real. Nothing here needs a developer except where it says so.

---

## What is already done

| Area | State |
|---|---|
| Roles simplified to three — Admin, Operations, Driver | Done |
| Vehicle safety holds can be released (Admin only, and only when no critical issue is open) | Done |
| Expenses need approval — Pending → Approved / Rejected, with Void to reverse | Done |
| Two-factor login for Admin and Operations | Built, needs one console switch (below) |
| Two-factor recovery if someone loses their phone | Done — **Users → Reset 2FA** |
| Document uploads (Cloudinary) | Built, needs your account keys (below) |
| No demo or test data ships with the app | Done — and your database is already cleaned |
| Trips work with no routing key (approximate distances, clearly labelled) | Done |
| Rate limiting on sign-in, password change, invites and uploads | Done |
| Security headers (HSTS, CSP, clickjacking, MIME sniffing) | Done |

Every step was verified as it went: **320 tests pass**, type-checking clean,
lint clean, and a production build succeeds.

---

## Before going live

Work down this list in order.

### 1. Set up your own login (5 minutes)

- Sign in as the administrator account created during setup.
- Go to **Account & security** (top-right menu) and set up two-factor
  authentication with Google Authenticator or similar.
- While you are there, change your password to something only you know.

### 2. Turn on two-factor enforcement (5 minutes)

The code is built; it needs a switch in Firebase.

1. Go to the [Firebase console](https://console.firebase.google.com) → your project.
2. **Authentication → Sign-in method → Multi-factor authentication**.
3. Enable **TOTP (authenticator app)**. (Do **not** make SMS the only option.)
4. Leave `REQUIRE_MFA` **unset** in production — it already enforces by default.
   The `REQUIRE_MFA=false` in `.env.local` is development-only and is not
   committed anywhere.

Until step 3 is done, Admin and Operations users are confined to the Account
page so they can finish setting up. That is deliberate — it is the one thing
that could otherwise lock you out, so it fails safe rather than failing open.

### 3. Add document storage (10 minutes)

1. Create a free account at [cloudinary.com](https://cloudinary.com).
2. Copy **Cloud name**, **API key** and **API secret** from the dashboard.
3. Put them in Vercel → Project → Settings → Environment Variables:
   - `CLOUDINARY_CLOUD_NAME`
   - `CLOUDINARY_API_KEY`
   - `CLOUDINARY_API_SECRET`
4. Redeploy.

Without these the app still works — document *records* can be created — but the
upload button shows "not set up yet" instead of a broken form. Uploads appear
the moment the keys are in.

### 4. Add real road distances (optional, 5 minutes)

- Create a free key at [geoapify.com](https://www.geoapify.com/) (3,000
  requests/day, no card needed) and set `GEOAPIFY_API_KEY`.
- Without it, trips still record fine — distances are approximate and the
  screen says so.

### 5. Set the application secrets (5 minutes)

In Vercel environment variables:

- `SESSION_SECRET` — 32+ random characters. This signs your login sessions.
  Generate one with: `openssl rand -hex 32`
- `CRON_SECRET` — another random value. This protects the scheduled-jobs
  endpoint. Generate with: `openssl rand -hex 32`
- Firebase admin credentials (project id, client email, private key) if not
  already set.

### 6. Clear out anything left over (2 minutes)

You said you are holding dummy data and will enter real data later. Before you
do that:

```
node scripts/purge-demo-data.mjs            # preview, deletes nothing
node scripts/purge-demo-data.mjs --all --apply
```

The second command wipes **every** business record (vehicles, trips, expenses,
fuel, documents, work orders) so you start completely empty. Users, roles and
the audit history survive so you can still sign in. It asks you to type `wipe`
before it does anything.

### 7. Enter your real data

- Add vehicles first (registration, make, model, current odometer).
- Then staff: **Users → Invite**. Give each person the *narrowest* role that
  fits — Drivers only need Driver.
- Then upload documents (registration, insurance, roadworthiness) against each
  vehicle and mark which ones are required.

### 8. Set up the schedule (optional)

Vercel → Project → Settings → Cron Jobs, pointing at the reminder endpoints
(see `docs/FLEET_WORKFLOWS.md`). Requires the `CRON_SECRET` from step 5.

---

## First-day checks

- [ ] You can sign in and see the dashboard.
- [ ] A Driver can log a trip and see only their own work.
- [ ] An Operations user can record an expense; you can approve it; the total
      moves; a rejected or voided one does not count.
- [ ] A vehicle placed on safety hold cannot be assigned to a trip.
- [ ] You can upload a document and then open it again.
- [ ] With two-factor on, signing in asks for a code from your app.

---

## Known gaps — read before you rely on it

Being straight about what is **not** finished:

1. **No self-service two-factor recovery codes.** There *is* a recovery path:
   an administrator opens **Users → Reset 2FA** on the affected account, which
   clears the old factor so they can set up a new one. What is missing is
   single-use backup codes the person could use without help. If your team is
   small and you are reachable, the admin reset is enough; if staff work
   unsociable hours, recovery codes are worth adding.
2. **No malware scanning on uploads.** The file's *real* contents are checked
   against its claimed type (a program renamed to `.pdf` is rejected) and size
   is capped, but there is no antivirus step. Fine if only your own staff
   upload; add a scanning service (e.g. VirusTotal) if documents will arrive
   from customers or the public.
3. **Rate limits are per server instance.** On Vercel each instance counts
   separately, so the effective allowance is roughly `limit × instances`. It is
   enough to blunt brute force and credential stuffing, but it is not a
   bulletproof global limiter. Firebase's own throttling is the second layer.
4. **E2E suites write test records.** They run against a development server,
   never production. After running them, `scripts/purge-demo-data.mjs --apply`
   removes everything they left behind.

## If you rotate the Cloudinary API secret

Documents keep working. The link stored on each record is the one Cloudinary
signed at upload time; if a rotation invalidates it, opening the document
re-resolves a fresh signed link automatically and stores it. You do not need to
re-upload anything.

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Upload button says "not set up yet" | Cloudinary keys missing | Step 3 |
| Admin can only reach Account & security | TOTP not enabled in Firebase | Step 2 |
| Sign-in says "Multi-factor authentication is required" and gives no code box | Factor already enrolled but the code was skipped | Enter the code; if the phone is lost, an admin uses **Users → Reset 2FA** |
| Someone cannot sign in after losing their phone | Their second factor is gone | **Users → Reset 2FA**, then they set up a new one |
| Trip distances say "approximate" | No routing key | Step 4 (harmless) |
| Everything is blank after sign-in | You ran the full purge | Re-enter data, step 7 |
