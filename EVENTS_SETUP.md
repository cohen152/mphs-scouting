# Events and sign-in update

The Events tab replaces Match entry. Old match entries remain readable and exportable; nothing is deleted. Broomfield Qualifier (USCOBRQ), January 16, 2027, is selected initially for both home teams. FIRST uses season 2026 for this event.

## 1. Update the Apps Script backend first

Open the Google Sheet's Extensions → Apps Script. Preserve a copy of your working code before editing.

- Copy `backend/Code.gs` into Code.gs, **keeping your existing ADMIN_USERNAME and DEFAULT_PASSWORD values at the top**. This restores the matching version-2 login response and routes Events requests. It does not reset stored custom PINs or delete spreadsheet data.
- Add a new Script file named `Events` and copy `backend/Events.gs` into it.
- Remove duplicate old copies of functions such as `login_` or `doPost` if you have them in other script files. There must be only one definition of each.
- In Project Settings → Script Properties add:

| Property | Value |
| --- | --- |
| FTC_EVENTS_USERNAME | Your FTC Events API username |
| FTC_EVENTS_KEY | Your FTC Events API key |

Keep credentials out of source code and GitHub. These properties are read only by the backend.

Save, then **Deploy → Manage deployments → pencil → Version: New version → Deploy**. Keep the existing `/exec` URL. Approve any required Google permissions as the deployment owner.

Open that `/exec` URL directly. This release returns:

```json
{"ok":true,"version":2,"eventsVersion":1,"msg":"MPHS scouting backend is running"}
```

If `eventsVersion` is absent, the updated deployment is not serving at that URL. Merely saving the editor does not update it.

## 2. Release the frontend

Merge this change to main after the backend is deployed. Wait for GitHub Pages to finish. Reopen the site online.

If a device still shows an incompatible backend error, tap the login logo five times and choose **Reset to built-in settings**, then retry. This changes the connection settings; do not clear site storage or uninstall the app while it contains unsynced entries.

## 3. Verify with your accounts and API credentials

- Sign in with an account's current custom PIN, or the configured DEFAULT_PASSWORD for accounts without a custom PIN. This update does not change PINs.
- Open Events and tap Refresh event. Check Rankings, Qualifications, Playoffs, and Teams.
- Find team events loads FIRST's event list for the active home team. Event choice is stored separately for each team **on each device**, not globally across devices.
- Test both P.P.R. and Hiveminds. Tap a team number to open its scouting profile.
- Load data online before going offline. Each section shows its download time. Failed refreshes preserve saved sections; these may be stale. No schedule or ranking is invented before FIRST publishes it.
- FIRST responses are cached for 60 seconds to reduce API calls. Refresh is manual.

## Sign-in diagnosis

The former generic “Could not sign in” also appeared when the backend returned `ok:true` but omitted numeric `version:2`. The revised frontend distinguishes rejected PINs, incompatible backend versions, and incomplete successful responses. It does not weaken version checks or accept invalid tokens.

A successful live login has not been tested with your accounts. If the matching backend is deployed and sign-in still fails, report the new full error message and provide the current Apps Script source (without credentials). Directory version 2 alone does not prove the login handler has the right response.

## Validation

`npm test` covers existing authentication and data isolation plus Events authorization, missing credentials, pagination, API cache reuse, partial API failures, offline display, team separation, retired Match controls, and login mismatch messaging. Tests use synthetic accounts and mocked FIRST responses. Live credential validation and physical iPhone/Android/iPad checks remain necessary.
