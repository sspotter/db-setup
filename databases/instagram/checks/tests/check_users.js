const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));

const targets = ['lnr_motion', 'conallbdoyle', 'kay.eey', '__bypaul', 'legacyggbr'];

targets.forEach(t => {
    const profile = data.scrapedProfiles.find(p => p.username === t);
    const partner = (data.collabPartners || []).find(p => p.username === t);
    console.log(`User @${t}:`);
    console.log(`  Profile found: ${!!profile} (role: ${profile ? profile.role : 'N/A'}, followers: ${profile ? profile.follower_count : 'N/A'})`);
    console.log(`  Partner found: ${!!partner} (followers: ${partner ? partner.followers : 'N/A'})`);
});
