const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));

console.log('--- collabPartners ---');
console.log(JSON.stringify(data.collabPartners, null, 2));

console.log('\n--- scrapedProfiles (usernames and roles only) ---');
console.log(data.scrapedProfiles.map(p => ({ username: p.username, role: p.role, follower_count: p.follower_count })));
