const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest5.json', 'utf8'));

const targets = ['lnr_motion', 'conallbdoyle', 'kay.eey', '__bypaul', 'legacyggbr'];

data.posts.forEach(p => {
    targets.forEach(t => {
        const inReachBreakdown = p.reachBreakdown && p.reachBreakdown.some(rb => rb.includes(t));
        const inCaption = p.caption && p.caption.includes(`@${t}`);
        if (inReachBreakdown || inCaption) {
            console.log(`Post ${p.shortcode}: @${t} found in ${inReachBreakdown ? 'reachBreakdown' : ''} ${inCaption ? 'caption' : ''}`);
        }
    });
});
