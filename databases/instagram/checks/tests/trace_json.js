const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));

function findOccurrences(obj, target, path = '') {
    if (typeof obj === 'string') {
        if (obj.includes(target)) {
            console.log(`Found "${target}" at ${path}: "${obj}"`);
        }
    } else if (Array.isArray(obj)) {
        obj.forEach((val, i) => findOccurrences(val, target, `${path}[${i}]`));
    } else if (typeof obj === 'object' && obj !== null) {
        for (const key in obj) {
            findOccurrences(obj[key], target, `${path}.${key}`);
        }
    }
}

findOccurrences(data, 'legacyggbr');
