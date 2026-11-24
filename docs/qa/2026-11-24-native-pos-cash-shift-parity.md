# Native Android/iOS POS attendant cash-shift parity

## Behavior
The existing web POS own-cash shift flow, merged in PR #231, now has a native
React Native equivalent directly above product search in the native Sell screen.

- The panel renders only for a POS_ATTENDANT, never as an unrestricted
  accounting navigation screen; only the assigned active branch is used.
- Authenticated GET /v1/operations/current obtains an OPEN business day, if
  one exists, and the staff member's own CASH shift and expected cash balance.
  Business/day financial balances, other tenders and other employees remain
  hidden by the server endpoint introduced in PR #231.
- Attendant records initial CASH float and opens their own shift; no day
  creation/closing, expense, electronic money, customer credit or refund
  rights are exposed.
- On closing, staff enter actual counted cash with Ghana cedi display ₵,
  see expected versus counted variance, add an optional handover note,
  and confirm using a native backdrop modal. Other four tender methods
  are explicitly zero per the server's cash-only role policy.
- ISO-currency decimal exponent is respected (0,2,3), no /100 hardcode.
  Count must be nonnegative and safe; unentered amount is not interpreted
  as zero.
- Shift mutations are persisted in the existing native queue with stable
  device and client mutation IDs; offline submission is disallowed. A network
  failure leaves the same mutation pending for later sync, and rejection
  leaves evidence in the existing failed queue. Only a confirmed APPLIED
  response clears the pending mutation and triggers successful UI feedback.
- Refresh and connectivity changes revalidate server state. Tenant/branch
  changes clear current counts; manual refresh does not erase entered values.
- The cash-shift panel does NOT require sales to be preceded by a shift;
  strict mandatory-shift gating requires a separate backwards-compatible,
  opted-in policy and CI/posting tests.

## Tests
Mobile API request tests cover bearer authorization and branch 403.
Currency helper tests cover ₵, UGX/TND and invalid/overflow inputs.
Runtime tests cover applied opening/closing, role and offline gates, stable
pending retry identity and rejected shift evidence. Source contract tests
cover the actual native component, field validation, and server-only status.
The database integrated own-cash shift authorization remains verified in
the API tests from PR #231.

## Deployment
GitHub CI only. Native app binaries/OTA packages and the VPS staging cutover
remain outside this PR and need separately authorized rollout, test-device
validation and signed release artifacts. Root VPS storage ~90%; no installs,
native builds or new releases on the VPS.
