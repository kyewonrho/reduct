# REDUCT Project Hub

Revision: 2026-11-02

Compact Korean portfolio dashboard for shared schedules, owners, progress, production/receipt checks, activities and budget. The existing public website stays separate. Internal pages have no public navigation links and request search exclusion. Search exclusion is not an access restriction; the project data API also requires a signed server session.

## Production setup

1. In the existing Vercel project, connect an Upstash Redis database through Storage. Use the Free plan unless the owner explicitly chooses otherwise. The integration supplies `KV_REST_API_URL` and `KV_REST_API_TOKEN`; the equivalent `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work.
2. Import the separately supplied private environment file into Vercel Production. It contains `PROJECT_HUB_PASSWORD_HASH`, `PROJECT_HUB_SESSION_SECRET` and `PROJECT_HUB_DATA_KEY`. Do not upload that file to GitHub or a public website. Keep a private recovery copy of the data key.
3. Redeploy the latest main branch after environment changes. Preview deployments should use separate storage credentials or a separate `PROJECT_HUB_NAMESPACE`; do not connect experimental previews to production data.
4. Check the password gate, authenticated read, edit/reload from another browser, stale-version conflict and backup download.

The encrypted initial dataset initializes the database only when its state key is absent. Existing unreadable data is never replaced automatically. Losing or replacing the data key makes existing encrypted data unreadable. Preserve the original key during ordinary redeploys.

## Behavior

- Passwords are verified with scrypt on the server. The password itself is absent from the repository.
- Sessions last 12 hours using Secure, HttpOnly, SameSite=Strict cookies. Changing the password hash invalidates existing sessions.
- All private API reads, exports and changes require a valid session. Mutations check their Origin. Login attempts are limited in the shared database.
- State and the latest 100 previous states are AES-256-GCM encrypted in Redis. The dashboard's authenticated backup download is a readable JSON copy; keep downloaded copies private.
- Atomic Redis compare-and-swap preserves edits to different records; a stale version on the same record returns HTTP 409. The UI asks the editor to reopen the latest version.
- Visible tabs refresh shared data every 15 seconds and immediately after saving; background tabs pause polling.
- Final completion is an explicit checkbox. Production completion, receipt, partial quantity and manually entered progress remain distinct.
- Missing login/storage settings return HTTP 503 and never fall back to browser-only storage.

## Verification

Requires Node.js 22 or later. No npm dependencies are needed.

```sh
node --test lib/project-hub/backend.test.js
node --check project-management/app.js
```

The backend tests use synthetic data and a Redis command test double. A real provider smoke test is still required after connecting production storage.
