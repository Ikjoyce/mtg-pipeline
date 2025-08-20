// Helper to launch the Reddit auth URL and print instructions to capture the refresh token.
// Usage: node scripts/get_reddit_refresh_token.js <clientId> <clientSecret> <userAgent>
const Snoowrap = require('snoowrap');
const open = (...args) => import('open').then(m => m.default(...args));

async function main() {
  const [,, clientId, clientSecret, userAgent] = process.argv;
  if (!clientId || !clientSecret) {
    console.error('Usage: node scripts/get_reddit_refresh_token.js <clientId> <clientSecret> [userAgent]');
    process.exit(2);
  }

  const r = new Snoowrap({
    userAgent: userAgent || 'MTG_Training_Data_Collector_v1.0',
    clientId,
    clientSecret,
    refreshToken: null,
  });

  const authUrl = r.getAuthUrl({
    duration: 'permanent',
    scope: ['read'],
    state: 'mtg-token'
  });

  console.log('Open this URL in a browser, authorize, then copy the code param from the redirect URL:');
  console.log(authUrl);
  await open(authUrl);
  console.log('\nAfter authorization, run:');
  console.log('  node -e "require(\'snoowrap\').fromAuthCode(\'<your_code>\', {clientId:\'<<CLIENT_ID>>\', clientSecret:\'<<CLIENT_SECRET>>\', userAgent:\'MTG_Training_Data_Collector_v1.0\'})"');
}

main().catch(err => { console.error(err); process.exit(1); });
