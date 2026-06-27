const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));

const targets = ['lnr_motion', 'conallbdoyle', 'kay.eey', '__bypaul', 'legacyggbr'];

function deepSearch(obj, target, path = '') {
    if (typeof obj === 'string') {
        if (obj === target || obj === `@${target}` || obj.includes(`@${target}`)) {
            return { path, value: obj };
        }
    } else if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            const res = deepSearch(obj[i], target, `${path}[${i}]`);
            if (res) return res;
        }
    } else if (typeof obj === 'object' && obj !== null) {
        for (const key in obj) {
            const res = deepSearch(obj[key], target, path ? `${path}.${key}` : key);
            if (res) return res;
        }
    }
    return null;
}

data.posts.forEach(p => {
    targets.forEach(t => {
        const res = deepSearch(p, t);
        if (res) {
            console.log(`Found @${t} in post ${p.shortcode} at ${res.path}: "${res.value}"`);
        }
    });
});
