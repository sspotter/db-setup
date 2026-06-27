const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest5.json', 'utf8'));

const brand = 'parimatch';
const targets = ['lnr_motion', 'conallbdoyle', 'kay.eey', '__bypaul', 'legacyggbr'];

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
    
    if (users.has(brand)) {
        const foundTargets = targets.filter(t => users.has(t));
        if (foundTargets.length > 0) {
            console.log(`Post ${p.shortcode}: Brand involved with collaborators: ${foundTargets.join(', ')}`);
        }
    }
});
