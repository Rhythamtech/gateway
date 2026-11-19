# Notifications and announcements

Personal notifications use JWT identity. Credit grants insert receipts in the ledger transaction, deduplicated by ledger entry ID. Coupon receipts include the redeemed code. Administrative reasons remain in credit history.

## Personal API

- `GET /notifications?page=1`: 20 per page, newest first, unread count, total, current credit warning and available balance.
- `POST /notifications/{id}/read`, `POST /notifications/read-all`: recipient-scoped, idempotent, return 204. Opening the inbox does not mark items read.
- `GET /notifications/settings`, `PUT /notifications/settings`: low-credit alerts, key-expiry alerts and positive decimal threshold (maximum six fractional digits). Credit receipts cannot be disabled; inline balance warnings remain visible.

Visible dashboards poll every minute, refresh on tab return and coupon redemption, and back off up to five minutes after errors. This is in-app delivery, not a background email service.

Low-credit alerts default to available credits below 10; exhausted means zero or less. Each state is notified once per funding episode. Returning above the threshold resets the episode. Grants and settlement evaluate alerts transactionally; inbox polling also detects reservation changes. API-key alerts are evaluated on inbox checks: within seven days, then expired, once per key/expiry/stage. Revoked and non-expiring keys are excluded. Historical grants are not backfilled as receipts.

## Announcements

Superusers manage `/dashboard/announcements`. Backend, route and sidebar all enforce superuser access.

- Management: `GET /announcements`, `POST /announcements`, `PUT /announcements/{id}`.
- `POST /announcements/{id}/republish`: publishes a new version, deliberately resetting prior dismissals.
- `GET /announcements/public`: published public landing/both announcements only.
- `GET /announcements/me`: eligible dashboard/both announcements for the signed-in user.
- `POST /announcements/{id}/dismiss?version=N`: persists dismissal for that user/version.

Announcements support draft/published/withdrawn status, public/users/superusers audience, landing/dashboard/both placement, UTC start/end, priority 0–100, dismissibility, and optional coupon linkage. Actions require local application paths and labels. Landing placement requires public audience. Creating a coupon never publishes it automatically.

Only one eligible banner is displayed: highest priority, then newest creation/ID. Minor edits preserve dismissals. Anonymous dismissals persist in local storage; dashboard dismissals persist across devices in the database. Without browser storage, anonymous dismissal lasts for the current visit.

Coupon feeds enforce enabled/start/expiry/global limits and signed-in per-user limits. Banner end is the earlier announcement/coupon expiry. Redemption validates all rules atomically again. Actions prefill the credits page and preserve destination through login; clicks never redeem automatically. Changes may take one poll to disappear.

## Storage and delivery

Append-only migrations 0023–0025 add notifications, announcements/dismissals and preferences/credit episode state. Models are registered in the composition root. UI composes existing shadcn primitives, with official Alert and Empty added.

External email and urgent delivery remain deferred: no delivery provider or scheduler is configured, and no external messages are sent. Production rollout should account for retained notification volume; no automatic inbox retention/deletion is currently configured.
