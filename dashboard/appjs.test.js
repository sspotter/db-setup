const fs = require('fs');
const path = require('path');

// app.js is one script: a second `function name()` silently replaces the first (hoisting),
// which once made the user-overview loader override the status-panel loader.
describe('public/app.js', () => {
    it('declares every top-level function only once', () => {
        const src = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
        const names = [...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
        const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
        expect([...new Set(duplicates)]).toEqual([]);
    });
});
