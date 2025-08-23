Orchestration: Collect Reddit -> Refine -> Export Training JSONL

This document explains the end-to-end process for taking new Reddit data from the collector HTTP endpoint and turning it into curated, validated LLM training files that are stored locally and optionally uploaded/registered to GCS and Firestore.

Overview of steps
-----------------
1) Call the collector HTTP endpoint (`collectRedditMTGData`) which fetches posts and candidate answers from Reddit and writes deduplicated documents into the `reddit_interactions` Firestore collection.

2) Run the exporter (`training/export_reddit_training_jsonl.py`) which queries `reddit_interactions`, filters by confidence, converts documents into LLM-friendly JSONL messages, and writes `mtg_llm_training.jsonl` plus deterministic splits.

3) Run the validator/uploader (`training/upload_and_register.py`) which validates JSONL, creates deterministic train/val/test splits, computes checksums, optionally uploads the artifacts to a GCS bucket, and optionally writes a `training_artifacts` metadata document to Firestore.

Orchestrator script
-------------------
We've added an orchestrator script that runs these steps in sequence and documents each action.

- Script: `training/orchestrate_reddit_to_training.py`
- Purpose: Call collector -> run exporter -> run upload_and_register
- Example: Dry run (no writes to cloud):

```powershell
python training/orchestrate_reddit_to_training.py --collector-url https://collectredditmtgdata-xa7cbi5cpq-uc.a.run.app --collector-dry-run --export-project stacksagemtg --min-confidence 0.7 --upload-dry-run
```

Detailed step-by-step (what we're doing and why)
------------------------------------------------
1) Call collector endpoint
   - What: HTTP GET to `collectRedditMTGData` with optional query params (limit, dryRun).
   - Why: fetch new Reddit posts and candidate answers and persist them into `reddit_interactions` so downstream tasks have fresh data.
   - Important: the collector will deduplicate by deterministic ID and avoid overwriting existing documents. Use `dryRun` to test collection logic without writes.

2) Export Firestore -> JSONL
   - What: `training/export_reddit_training_jsonl.py` queries `reddit_interactions` and writes cleaned JSONL with the following form per line:
     {
       "messages": [ {"role":"system","content":SYSTEM_PROMPT}, {"role":"user","content":question}, {"role":"assistant","content":answer} ],
       "metadata": { "confidence": 0.85, "interaction_type": "stack_interaction", ... }
     }
   - Why: the exporter normalizes document fields, enforces the minimum confidence threshold, anonymizes optional PII when requested, and creates deterministic train/val/test splits.

3) Validate, split, upload, register
   - What: `training/upload_and_register.py` reads the merged JSONL, performs content-level validation, deterministically splits (consistent hashing), writes local split files, computes checksums, optionally uploads the files to GCS, and optionally writes a metadata doc to Firestore.
   - Why: ensures training artifacts are reproducible and registered for tracking and reproducibility.

Post-run checks
---------------
- Inspect `training/output/<version>/` for the three split files and checksums.
- Run token statistics: `python training/scripts/token_stats.py training/output/<version>/mtg_llm_training.train.jsonl`.
- Review a handful of samples in the train/val/test files to ensure examples are high quality.

Permissions & credentials
-------------------------
- Collector endpoint: uses Secrets or functions v2 secrets at runtime; for testing locally, set environment variables or use `.env` with your Reddit credentials.
- Exporter and upload tools: require application default credentials or `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service-account JSON with Firestore and GCS permissions when you want to upload/register.

Safety & best practices
-----------------------
- Use `--collector-dry-run` and `--upload-dry-run` during initial runs.
- Seed `pipelineReader` claims for partner access via the admin flow rather than exposing raw collections to clients.
- Keep a separate GCS bucket for versioned training artifacts (do not overwrite versions).

Frequently used commands
------------------------
# Dry-run everything locally (no writes):

```powershell
python training/orchestrate_reddit_to_training.py --collector-dry-run --export-project stacksagemtg --upload-dry-run
```

# Full run (requires GOOGLE_APPLICATION_CREDENTIALS -> service-account with Firestore + Storage permissions):

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\service-account.json'
python training/orchestrate_reddit_to_training.py --export-project stacksagemtg --gcs-bucket my-bucket --gcs-prefix mtg_llm_training/v20250823_1500
```

Questions or next steps
-----------------------
- Want me to add a CI job that runs the exporter and upload pipeline on a schedule? Say `add CI job` and I will scaffold a GitHub Actions workflow that runs nightly and uploads artifacts to a dated GCS prefix.
- Want sample validations or automated acceptance checks? I can add unit checks that fail if average confidence drops below a threshold or if token counts change drastically.

