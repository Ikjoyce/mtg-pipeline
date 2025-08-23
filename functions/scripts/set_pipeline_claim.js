#!/usr/bin/env node
// Simple CLI to set pipelineReader claim using service account credentials
// Usage: node functions/scripts/set_pipeline_claim.js <uid> [--disable]

const admin = require('firebase-admin');
const fs = require('fs');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json';
if (!fs.existsSync(keyPath)) {
  console.error('Service account JSON not found. Set GOOGLE_APPLICATION_CREDENTIALS or place service-account.json in functions/');
  process.exit(2);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const uid = process.argv[2];
const disable = process.argv.includes('--disable');
if (!uid) {
  console.error('Usage: node set_pipeline_claim.js <uid> [--disable]');
  process.exit(2);
}

(async () => {
  try {
    if (disable) {
      await admin.auth().setCustomUserClaims(uid, { pipelineReader: null });
      console.log('Removed pipelineReader claim for', uid);
    } else {
      await admin.auth().setCustomUserClaims(uid, { pipelineReader: true });
      console.log('Set pipelineReader claim for', uid);
    }
    process.exit(0);
  } catch (e) {
    console.error('Error setting claim', e);
    process.exit(1);
  }
})();
