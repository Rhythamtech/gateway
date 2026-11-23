# Frontend audit · 2026-11-22

The working tree contains eight public pages and seventeen dashboard pages. This source review focused on the shared session client, dashboard gate, public account navigation and copyable examples. All 52 frontend tests passed. The existing work log records browser checks on all 25 routes. This run did not repeat visual, keyboard or viewport testing, so page-level visual scores are unverified.

| Priority | Finding and impact | Minimal fix and acceptance check |
|---|---|---|
| P2 | **Transient refresh failures erase the user's session and playground key.** The shared refresh handler clears storage for every exception, including an offline response or server error. Retry after connectivity returns requires a fresh login and key entry. This affects every dashboard page using the authenticated client. See `frontend/src/lib/auth.ts:49` and line 171. | Clear credentials only when the server definitively rejects the refresh token. Simulate an offline refresh and a 503, restore connectivity and verify retry succeeds using stored credentials. Keep the existing 401 cleanup. |
| P3 | **Docs reports a successful copy before clipboard access succeeds.** The action sets the copied indicator immediately and leaves promise rejection unhandled. A user can paste stale clipboard contents after seeing success. See `frontend/src/components/docs/docs-view.tsx:75`. | Await the write and show success only after fulfillment. Use the existing landing example's failure feedback pattern. Verify both accepted and denied writes. |

## Resolution · 2026-11-22

Fixed both findings. Temporary refresh errors preserve session storage and the playground API key. Docs reports clipboard success after the write completes and shows an error if it fails. All 55 frontend tests passed. The staged production build and typecheck passed. Chromium verified the Docs copy indicator and error message with successful and denied writes.
