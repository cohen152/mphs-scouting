# Two-team login and PIN update

This branch requires its matching Apps Script backend. It is not a frontend-only update.

## What changes

- Team selection → home-team user list → four-digit PIN keypad, using the mountain photo and white login panels.
- Existing records and accounts belong to 17190 P.P.R.; 17300 Hiveminds starts empty.
- All admins may select either team's workspace. Admins appear only in their home team's login list. Create an account while viewing its home team.
- Scouting, targets, FTCScout snapshots, exports and transfer state are scoped by team. Server authorization rejects a scout's requests for the other team.
- Initial and reset PIN is 1111. Existing legacy passwords transition to 1111 once; users can change their own PIN under More. A reminder appears while the default is in use. Admins can reset, but cannot retrieve PINs or choose another user's custom PIN.
- The legacy shared team key is no longer required; data APIs require authenticated, team-authorized sessions. Only the minimal login directory is available before sign-in.
- PIN hashes stay on the backend, using a server-only random secret. Session tokens are random and revoked on PIN changes/reset. PINs and authentication tokens are excluded from directory, sync and backup responses.
- The existing QR exchange screen is retained. Both devices must select the same team; a shared iPad signed in as admin can switch between teams. QR exchanges transfer scouting entries only, never user roles or credentials. Backup imports also enforce team ownership.
- The unfinished Enter kiosk landing-page request is outside this change and remains unfinished.

## Rollout order

1. Before updating, sync all devices and export backups for any pending offline entries. Make a copy of the Google Sheet and preserve the current Apps Script source as a rollback copy.
2. In the spreadsheet, open Extensions → Apps Script. Replace Code.gs with backend/Code.gs from this branch.
3. Save, then Deploy → Manage deployments → edit the existing deployment → New version → Deploy. Keep the same deployment URL. Do not create a new empty spreadsheet.
4. Merge this branch into main to release the matching frontend on GitHub Pages. Old clients cannot authenticate against the new PIN backend; coordinate these two steps during a short maintenance window.
5. Reopen the app online. Choose P.P.R., select your existing admin account, and sign in with 1111. Change your PIN under More.
6. Use the admin team switch to choose Hiveminds, then create its users under More → Admin. Each starts at 1111.
7. Open each device online, refresh its team user list, sign in and test QR tools before going offline. The background and correctly named icons are included in the service-worker cache.

No scouting rows are deleted by this update. Legacy records without an org field are treated as P.P.R. on read, and receive explicit ownership when edited. The old local records are retained; sessions and PIN caches use new keys.

## Verification and limitations

Automated backend and DOM tests use simulated Apps Script services and synthetic users only. They cover migration, cross-team access and ID collisions, role escalation, four-digit validation including leading zeros, PIN reset/session revocation, login UI events, admin switching, scoped saves, QR rejection and offline login. No live scouting records were used for testing.

Run `npm install` then `npm test` with a current Node.js. A separate Playwright suite is provided as `npm run test:browser`; set CHROMIUM_PATH to a local Chromium binary. Full browser execution could not run in the development environment because Chromium's process socket was blocked. Visual appearance and physical iPhone/iPad camera transfers still require testing.

Offline PIN verification necessarily uses credentials previously cached on that device. A reset invalidates online sessions immediately, but a disconnected device learns of it only when it reconnects. After a reset, sign in online with the new PIN on each device before the next offline event. Users need an initial online login to cache access.

## Rollback

Restore the previous Apps Script deployment and revert the frontend commit together. The old Auth rows are preserved until users change/reset their PIN, so those users may need their passwords reset after a rollback. Do not discard device-local unsynced entries or overwrite the live sheet with an old copy without reconciling new entries first.
