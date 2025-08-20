"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertEqual = assertEqual;
exports.runUnitTests = runUnitTests;
// Minimal test helpers for compiled JS test runner
function assertEqual(a, b, msg) {
    if (a !== b)
        throw new Error(msg || `Assertion failed: ${a} !== ${b}`);
}
const redditMtgCollector_1 = require("./redditMtgCollector");
function runUnitTests() {
    // isRulesQuestion basic checks
    assertEqual((0, redditMtgCollector_1.isRulesQuestion)('How does the stack resolve?'), true, 'stack resolve should be detected');
    assertEqual((0, redditMtgCollector_1.isRulesQuestion)('Nice spicy brew'), false, 'non rules question should be false');
    // extractRuleReferences
    const refs = (0, redditMtgCollector_1.extractRuleReferences)('See 106.4a and 601.2 for details');
    assertEqual(Array.isArray(refs), true, 'refs should be array');
    if (!refs.includes('106.4a'))
        throw new Error('expected 106.4a');
    return true;
}
