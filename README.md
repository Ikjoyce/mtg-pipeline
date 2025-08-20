# MTG Training Pipeline

Automated training pipeline for MTG rules engine, integrated with the StackSageMTG Firebase project.

## Project Structure

- `functions/` - Cloud Functions (TypeScript)
- `scripts/` - Data analysis/manual tools (Python, JS)
- `notebooks/` - Jupyter notebooks for exploration
- `docs/` - Documentation
- `.github/workflows/` - CI/CD and data quality workflows

## Firebase Project
- Project ID: stacksagemtg

## Setup
- See `docs/` and `mtg_project_setup_guide.md` for full instructions.

## Deploy & Secrets (short)

This repo expects Reddit credentials to be stored in Google Secret Manager or in Firebase Functions secrets. For local testing you can use a `.env` file (excluded by `.gitignore`).

Recommended steps:

- Create Secret Manager secrets named `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN`, `REDDIT_USER_AGENT` and add values via `gcloud secrets create` and `gcloud secrets versions add`.
- Or set `firebase functions:secrets:set` values for the same names.
- Deploy functions after building: `cd functions; npm run build; firebase deploy --only functions:collectRedditMTGData --project stacksagemtg`

