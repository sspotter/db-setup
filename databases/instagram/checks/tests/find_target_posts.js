const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));

const target = 'legacyggbr';

data.posts.forEach(p => {
    const jsonStr = JSON.stringify(p);
    if (jsonStr.includes(target)) {
        console.log('--- FOUND POST ---');
        console.log(JSON.stringify(p, null, 2));
    }
});
