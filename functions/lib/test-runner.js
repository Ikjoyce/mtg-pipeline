"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_helpers_1 = require("./test_helpers");
async function main() {
    try {
        (0, test_helpers_1.runUnitTests)();
        console.log('All tests passed');
        process.exit(0);
    }
    catch (err) {
        console.error('Tests failed:', err?.message || err);
        process.exit(1);
    }
}
main();
