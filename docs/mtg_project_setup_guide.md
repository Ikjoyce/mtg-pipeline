# MTG Training Pipeline Project Setup Guide

This file is a copy of the project setup guide placed in `docs/` for repository onboarding. For the full, canonical guide see the shared documentation source.

Quick pointers:

- The pipeline uses `functions/` for Firebase Cloud Functions (TypeScript).
- Secrets should be stored in Google Secret Manager or Firebase Functions secrets and not committed.
- Use `scripts/get_reddit_refresh_token.js` to assist with creating a Reddit refresh token for a client ID/secret.

Deploy & secrets quick steps:

1. Build functions locally:

```powershell
cd functions
npm ci
npm run build
```

2. Create secrets (Cloud SDK example):

```powershell
# create secrets
gcloud secrets create REDDIT_CLIENT_ID --replication-policy="automatic"
echo "<CLIENT_ID>" | gcloud secrets versions add REDDIT_CLIENT_ID --data-file=-
# repeat for REDDIT_CLIENT_SECRET and REDDIT_REFRESH_TOKEN and REDDIT_USER_AGENT
```

3. Deploy single function (safe):

```powershell
firebase deploy --only functions:collectRedditMTGData --project stacksagemtg
```

4. For scheduled runs, either migrate to 2nd-gen functions and use scheduled triggers, or use Cloud Scheduler to call the HTTP endpoint.


