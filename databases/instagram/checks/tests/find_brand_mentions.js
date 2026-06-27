const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));

const brand = 'parimatch';

data.posts.forEach(p => {
    const jsonStr = JSON.stringify(p);
    if (jsonStr.toLowerCase().includes(brand.toLowerCase())) {
        console.log(`Post ${p.shortcode} mentions ${brand}`);
        // Check where exactly
        const locations = [];
        if (p.owner && p.owner.username === brand) locations.push('owner');
        if (p.coauthors && p.coauthors.some(c => c.username === brand)) locations.push('coauthor');
        if (p.scrapedFromProfile === brand) locations.push('scrapedFromProfile');
        if (p.caption && p.caption.toLowerCase().includes(brand.toLowerCase())) locations.push('caption');
        if (p.reachBreakdown && p.reachBreakdown.some(rb => rb.toLowerCase().includes(brand.toLowerCase()))) locations.push('reachBreakdown');
        
        console.log(`  Locations: ${locations.join(', ')}`);
        if (p.owner && p.owner.username !== brand) {
             console.log(`  Owner: ${p.owner.username}`);
        }
    }
});
