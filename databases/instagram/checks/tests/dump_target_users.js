const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));

const target = 'conallbdoyle';

data.posts.forEach(p => {
    const users = new Set();
    if (p.owner && p.owner.username) users.add(p.owner.username);
    if (p.coauthors) p.coauthors.forEach(c => users.add(c.username));
    if (p.reachBreakdown) {
        p.reachBreakdown.forEach(rb => {
            const match = rb.match(/@([a-zA-Z0-9._]+)/);
            if (match) users.add(match[1]);
        });
    }
    
    if (users.has(target)) {
        console.log(`Post ${p.shortcode} users:`, Array.from(users).join(', '));
        console.log(`  Caption contains parimatch: ${p.caption && p.caption.toLowerCase().includes('parimatch')}`);
        console.log(`  Scraped from: ${p.scrapedFromProfile}`);
    }
});
