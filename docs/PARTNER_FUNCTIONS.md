## Partner-owned Firebase Functions — Notice & Safe-deploy Instructions

Purpose
-------
This document records a set of Firebase Cloud Functions that exist in the project because a partner application shares the same Firebase project / Firestore database. Those functions are owned and maintained by the partner and must not be removed by our team. Deleting them can cause outages, data loss, missed scheduled jobs, or broken integrations for the partner.

Listed functions
----------------
The Firebase CLI reported these functions as present in the deployed project but not in this repository's local source code:

- `forceRefreshCardIndex (us-central1)`
- `getCardData (us-central1)`
- `getCardRulings (us-central1)`
- `healthCheck (us-central1)`
- `lookupRules (us-central1)`
- `nightlyRefreshRulings (us-central1)`
- `onUserCreate (us-central1)`
- `refreshAllRulings (us-central1)`
- `refreshCardIndex (us-central1)`
- `scheduledRefreshCardIndex (us-central1)`
- `searchCards (us-central1)`
- `searchCardsLocal (us-central1)`
- `helloWorld (us-central1)`

Policy: never delete these functions
----------------------------------
- These functions are partner-owned. Do not delete them from the console or via `firebase deploy`.
- When the Firebase CLI prompts that "The following functions are found in your project but do not exist in your local source code", always answer `No` to the deletion prompt unless you have explicit written confirmation from the partner and a rollback/maintenance plan.

Safe deploy practices (recommended)
----------------------------------
1. Prefer targeted deploys instead of deploying all functions. Use `--only` to list the specific functions you want to update. Example:

```powershell
Set-Location 'C:\Users\Ian\Documents\_mtg-judge-trainer\mtg-pipeline'
firebase deploy --only functions:curatedInteractions,functions:collectRedditMTGData,functions:setPipelineReaderClaim
```

2. If you must run a deploy that touches the whole functions codebase, when prompted about deletion, answer `No` and investigate why the functions are missing locally. Coordinate with the partner.

3. Add an explicit allowlist of functions in your deployment process (CI or manual scripts). For example, prefer a script or CI job that runs an explicit `firebase deploy --only functions:<list>` rather than `firebase deploy --only functions`.

4. If you use automation, configure your CI to fail the deploy early if the CLI indicates functions present remotely but missing locally; treat that as a manual review item.

How to check the deployed functions (quick)
-----------------------------------------
- The Firebase Console lists all deployed functions and their trigger types. Visit: https://console.firebase.google.com/project/<PROJECT_ID>/functions
- From the CLI, you can run `firebase functions:list` in the project directory to see remote functions.

If you accidentally triggered deletion in a deploy
------------------------------------------------
1. Immediately stop and do not confirm the deletion (answer `No` when prompted). If you already confirmed deletion and deployed:
   - Notify the partner immediately.
   - If you have the function source from the partner, redeploy it as soon as possible.
   - If source is not available, ask the partner for recovery steps or for them to redeploy from their repository.

When deletion is appropriate
---------------------------
Only delete a partner-owned function if you have explicit, documented agreement from the partner and a rollback plan. Prefer the partner perform the deletion from their source control and deployment pipeline.

Recommended next steps for our repo
-----------------------------------
1. Keep this file (`docs/PARTNER_FUNCTIONS.md`) in the repo root of the `mtg-pipeline` project so it is discoverable by teammates and appears in PR reviews.
2. Add a short note to your deployment README or CI docs telling deployers to prefer targeted deploys.
3. (Optional) I can add a small pre-deploy check script (CI-friendly) that compares local vs remote functions and fails if it detects missing local functions — tell me if you want that added.

Contacts
--------
If you're unsure who owns a function, contact the partner integration owner; otherwise treat the function as partner-owned and do not delete it.

Document history
----------------
- Created: 2025-08-23 — records the functions reported by the CLI and defines the non-deletion policy and safe-deploy guidance.
