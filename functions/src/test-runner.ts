import { runUnitTests } from './test_helpers';

async function main() {
  try {
    runUnitTests();
    console.log('All tests passed');
    process.exit(0);
  } catch (err: any) {
    console.error('Tests failed:', err?.message || err);
    process.exit(1);
  }
}

main();
