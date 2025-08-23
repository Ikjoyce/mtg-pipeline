#!/usr/bin/env python3
"""
Orchestrate: collect Reddit -> export Firestore -> validate/split -> (optional) upload & register

Usage examples:
  # Dry-run all steps (no GCS upload, collector dryRun=true)
  python training/orchestrate_reddit_to_training.py --collector-url https://collectredditmtgdata-xa7cbi5cpq-uc.a.run.app --collector-dry-run --export-project stacksagemtg --min-confidence 0.7 --upload-dry-run

  # Full run, upload to GCS and register metadata in Firestore (requires creds)
  python training/orchestrate_reddit_to_training.py --collector-url https://collectredditmtgdata-xa7cbi5cpq-uc.a.run.app --export-project stacksagemtg --gcs-bucket my-bucket --gcs-prefix mtg_llm_training/v20250823_1500

What this does (high-level)
  1) Calls the deployed collector HTTP endpoint to fetch new Reddit content and (optionally) persist to Firestore.
  2) Runs `export_reddit_training_jsonl.py` to convert Firestore `reddit_interactions` documents into cleaned JSONL ready for training.
  3) Runs `upload_and_register.py` to validate, deterministically split, optionally upload the split files to GCS, and register metadata in Firestore.

The script uses subprocess to invoke existing repository tools so it reuses validation and export logic already present.
"""

from __future__ import annotations
import argparse
import json
import os
import subprocess
import sys
import time
from typing import Optional

try:
    import requests
except Exception:
    requests = None


def call_collector(collector_url: str, params: dict, timeout: int = 300) -> dict:
    if requests is None:
        raise RuntimeError('requests library is required to call the collector endpoint (pip install requests)')
    print(f"Calling collector endpoint: {collector_url} with params={params}")
    resp = requests.get(collector_url, params=params, timeout=timeout)
    try:
        body = resp.json()
    except Exception:
        body = {'status_code': resp.status_code, 'text': resp.text}
    if resp.status_code != 200:
        raise RuntimeError(f'Collector returned status {resp.status_code}: {body}')
    return body


def run_subprocess(cmd: list[str], cwd: Optional[str] = None, env: Optional[dict] = None) -> int:
    print('\n$ ' + ' '.join(cmd))
    proc = subprocess.run(cmd, cwd=cwd, env=env)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {proc.returncode}: {' '.join(cmd)}")
    return proc.returncode


def main(argv: list[str]):
    p = argparse.ArgumentParser()
    p.add_argument('--collector-url', default=os.environ.get('COLLECTOR_URL') or 'https://collectredditmtgdata-xa7cbi5cpq-uc.a.run.app', help='HTTP URL of the collectRedditMTGData endpoint')
    p.add_argument('--collector-limit', type=int, default=50, help='Posts to scan per subreddit')
    p.add_argument('--collector-dry-run', action='store_true', help='Ask the collector to run in dryRun mode (no writes to Firestore)')
    p.add_argument('--export-project', default='stacksagemtg', help='GCP project id used by export_reddit_training_jsonl.py')
    p.add_argument('--min-confidence', type=float, default=0.7, help='Minimum confidence to include examples')
    p.add_argument('--export-limit', type=int, default=10000, help='Max documents to export')
    p.add_argument('--output', default='training/mtg_llm_training.jsonl', help='Local output JSONL path')
    p.add_argument('--gcs-bucket', default=None, help='Optional GCS bucket to upload training artifacts')
    p.add_argument('--gcs-prefix', default=None, help='Optional GCS prefix for uploads')
    p.add_argument('--upload-dry-run', action='store_true', help='Do not call GCS/Firestore when running upload_and_register.py')
    p.add_argument('--skip-collector', action='store_true', help='Skip calling the collector endpoint (use existing Firestore data)')
    p.add_argument('--cwd', default='.', help='Repository root (where scripts live)')
    args = p.parse_args(argv)

    repo_root = os.path.abspath(args.cwd)

    # Step 1: call collector endpoint (optional)
    if not args.skip_collector:
        try:
            params = {'limit': args.collector_limit}
            if args.collector_dry_run:
                params['dryRun'] = 'true'
            start = time.time()
            body = call_collector(args.collector_url, params)
            elapsed = time.time() - start
            print(f"Collector completed in {elapsed:.1f}s; summary: {json.dumps(body) if isinstance(body, dict) else body}\n")
        except Exception as e:
            print('Collector call failed:', e)
            print('You can retry the collector manually or run with --skip-collector to proceed with existing Firestore data.')
            return
    else:
        print('Skipping collector call (using existing Firestore data)')

    # Step 2: export Firestore documents to JSONL
    export_cmd = [sys.executable, os.path.join(repo_root, 'training', 'export_reddit_training_jsonl.py'),
                  '--project', args.export_project,
                  '--output', args.output,
                  '--min-confidence', str(args.min_confidence),
                  '--limit', str(args.export_limit)]
    try:
        run_subprocess(export_cmd, cwd=repo_root)
        print(f"Exported Firestore documents to {args.output}")
    except Exception as e:
        print('Export step failed:', e)
        return

    # Step 3: run upload_and_register.py to validate, split, and optionally upload/register
    upload_cmd = [sys.executable, os.path.join(repo_root, 'training', 'upload_and_register.py'),
                  '--input', args.output,
                  '--out-dir', os.path.join(repo_root, 'training', 'output')]
    if args.gcs_bucket:
        upload_cmd += ['--gcs-bucket', args.gcs_bucket]
    if args.gcs_prefix:
        upload_cmd += ['--gcs-prefix', args.gcs_prefix]
    if args.upload_dry_run:
        upload_cmd.append('--dry-run')

    try:
        run_subprocess(upload_cmd, cwd=repo_root)
        print('Upload and register step completed (see output directory and Firestore registration).')
    except Exception as e:
        print('Upload/Register step failed:', e)
        return

    print('\nOrchestration complete. Artifacts written to:')
    print(' - Local splits: training/output/<version>/')
    if args.gcs_bucket and not args.upload_dry_run:
        pref = args.gcs_prefix or 'mtg_llm_training/<version>'
        print(f' - GCS bucket: gs://{args.gcs_bucket}/{pref}/')
    print('\nNext steps: run token statistics, validate sample examples, and proceed to model training.')


if __name__ == '__main__':
    main(sys.argv[1:])
