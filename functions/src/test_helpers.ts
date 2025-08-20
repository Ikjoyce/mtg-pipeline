// Minimal test helpers for compiled JS test runner
export function assertEqual(a: any, b: any, msg?: string) {
  if (a !== b) throw new Error(msg || `Assertion failed: ${a} !== ${b}`);
}

import { isRulesQuestion, extractRuleReferences } from './redditMtgCollector';

export function runUnitTests() {
  // isRulesQuestion basic checks
  assertEqual(isRulesQuestion('How does the stack resolve?'), true, 'stack resolve should be detected');
  assertEqual(isRulesQuestion('Nice spicy brew'), false, 'non rules question should be false');

  // extractRuleReferences
  const refs = extractRuleReferences('See 106.4a and 601.2 for details');
  assertEqual(Array.isArray(refs), true, 'refs should be array');
  if (!refs.includes('106.4a')) throw new Error('expected 106.4a');

  return true;
}
