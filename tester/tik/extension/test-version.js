/**
 * Test file for Soft Update version comparison logic
 * Run with: node test-version.js
 */

function isNewerVersion(newV, oldV) {
    const newParts = newV.split('.').map(Number);
    const oldParts = oldV.split('.').map(Number);

    for (let i = 0; i < Math.max(newParts.length, oldParts.length); i++) {
        const n = newParts[i] || 0;
        const o = oldParts[i] || 0;
        if (n > o) return true;
        if (n < o) return false;
    }
    return false;
}

const testCases = [
    { newV: "1.1.0", oldV: "1.0.1", expected: true },
    { newV: "1.0.2", oldV: "1.0.1", expected: true },
    { newV: "2.0.0", oldV: "1.9.9", expected: true },
    { newV: "1.0.1", oldV: "1.0.1", expected: false },
    { newV: "1.0.0", oldV: "1.0.1", expected: false },
    { newV: "1.1",   oldV: "1.0.1", expected: true },
    { newV: "1.0.1", oldV: "1.1",   expected: false },
    { newV: "1.0.0.1", oldV: "1.0.0", expected: true }
];

console.log("--- Testing Version Comparison Logic ---");
let passed = 0;
testCases.forEach(({ newV, oldV, expected }, index) => {
    const result = isNewerVersion(newV, oldV);
    const status = result === expected ? "✅ PASSED" : "❌ FAILED";
    if (result === expected) passed++;
    console.log(`Test ${index + 1}: ${newV} > ${oldV}? Expected: ${expected}, Result: ${result} ${status}`);
});

console.log(`\nResults: ${passed}/${testCases.length} tests passed.`);

if (passed === testCases.length) {
    console.log("All tests passed! The logic is sound. 🚀");
} else {
    console.log("Some tests failed. Please review the logic.");
}
