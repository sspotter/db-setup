const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));

const brand = 'parimatch';
const involved = data.posts.filter(p => {
    const isOwner = (p.owner && p.owner.username === brand) || p.username === brand;
    const isCoauthor = p.coauthors && p.coauthors.some(c => c.username === brand);
    const isScrapedFrom = p.scrapedFromProfile === brand;
    return isOwner || isCoauthor || isScrapedFrom;
});

console.log('Total brand involved:', involved.length);
involved.forEach(p => {
    console.log(`- ${p.shortcode} (Owner: ${p.owner ? p.owner.username : 'N/A'}, ScrapedFrom: ${p.scrapedFromProfile})`);
});
