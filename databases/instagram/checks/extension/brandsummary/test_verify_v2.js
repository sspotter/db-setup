require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function verifyMetricsV2(brand) {
    try {
        const dataPath = path.join(__dirname, 'igtest2.json');
        if (!fs.existsSync(dataPath)) {
            console.error(`File not found: ${dataPath}`);
            return;
        }

        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        const posts = data.posts || [];
        const partners = data.collabPartners || [];
        const profiles = data.scrapedProfiles || [];

        // 1. Identify posts where the brand is involved
        // According to original logic: owner, coauthor, or scraped_from
        const brandInvolvedPosts = posts.filter(p => {
            const isOwner = (p.owner && p.owner.username === brand) || p.username === brand;
            const isCoauthor = p.coauthors && p.coauthors.some(c => c.username === brand);
            const isScrapedFrom = p.scrapedFromProfile === brand;
            return isOwner || isCoauthor || isScrapedFrom;
        });

        if (brandInvolvedPosts.length === 0) {
            console.log(`No data found for brand @${brand} in igtest2.json`);
            return;
        }

        const involvedShortcodes = new Set(brandInvolvedPosts.map(p => p.shortcode));

        // 2. Metrics for the brand only (likes, comments, etc.)
        // Filter by posts where brand is actually part of the profile appearances
        const brandOwnedPosts = brandInvolvedPosts.filter(p => {
             // In the original SQL, a.username = ANY($2)
             const isOwner = (p.owner && p.owner.username === brand) || p.username === brand;
             const isCoauthor = p.coauthors && p.coauthors.some(c => c.username === brand);
             // Caption user was also included in SQL union
             const isCaptionUser = p.caption_user && p.caption_user.username === brand;
             return isOwner || isCoauthor || isCaptionUser;
        });

        const totalLikes = brandOwnedPosts.reduce((sum, p) => sum + (p.likes || 0), 0);
        const totalComments = brandOwnedPosts.reduce((sum, p) => sum + (p.comments || 0), 0);
        const totalEngagement = totalLikes + totalComments;
        const postCount = brandOwnedPosts.length;
        const avgEngagement = postCount > 0 ? (totalEngagement / postCount).toFixed(1) : 0;

        // 3. Reach Calculation
        // Count how many posts from brandInvolvedPosts each partner is involved in
        const sharedPostStats = new Map();
        brandInvolvedPosts.forEach(p => {
            const usersInThisPost = new Set();
            const mainUser = (p.owner && p.owner.username) || p.username || (p.user && p.user.username);
            if (mainUser) usersInThisPost.add(mainUser);
            
            if (p.coauthors) p.coauthors.forEach(c => usersInThisPost.add(c.username));
            if (p.scrapedFromProfile === brand) usersInThisPost.add(brand);
            // In the original SQL, post_relations included COAUTHOR and CAPTION_USER
            if (p.caption_user && p.caption_user.username) usersInThisPost.add(p.caption_user.username);

            usersInThisPost.forEach(u => {
                sharedPostStats.set(u, (sharedPostStats.get(u) || 0) + 1);
            });
        });

        const reachResult = [];
        let totalPotentialReach = 0;
        let brandPotentialReach = 0;

        sharedPostStats.forEach((count, username) => {
            // Find partner info (followers) from scrapedProfiles or collabPartners
            const profile = profiles.find(pr => pr.username === username);
            const partner = partners.find(pa => pa.username === username);
            
            const followers = (profile && profile.follower_count) || (partner && partner.followers) || 0;
            const role = profile ? profile.role : (username === brand ? 'brand' : 'partner');
            const reach = followers * count;

            totalPotentialReach += reach;
            if (username === brand) {
                brandPotentialReach = reach;
            }

            reachResult.push({
                username,
                posts_involved: count,
                follower_count: followers,
                role,
                potential_reach: reach
            });
        });

        // Sort reachResult so brand is first or just sort by reach?
        // Original output had a specific order (maybe by reach descending)
        reachResult.sort((a, b) => b.potential_reach - a.potential_reach);

        // 4. Output Generation
        const formatNumber = num => (num || 0).toLocaleString();

        const brandEntry = reachResult.find(r => r.username === brand);
        const collaboratorEntries = reachResult.filter(r => r.username !== brand);

        let reachBreakdown = `🌟 Brand Impressions (Brand)\n`;
        if (brandEntry) {
            reachBreakdown += ` - @${brandEntry.username} (${brandEntry.role}): ${formatNumber(brandEntry.potential_reach)} (${brandEntry.posts_involved} posts)\n`;
        }
        
        reachBreakdown += `Reach Breakdown (Collaborators):\n`;
        collaboratorEntries.forEach(r => {
            if (r.potential_reach > 0) {
                reachBreakdown += ` - @${r.username} (${r.role}): ${formatNumber(r.potential_reach)} (${r.posts_involved} posts)\n`;
            }
        });

        const outputData = `📊 Main Brand Summary for ${brand} Only (v2 from JSON)\n` +
            `👤 Profiles : @${brand}\n` +
            `📷 Total Posts : ${postCount}\n` +
            `📊 Total Engagement : ${formatNumber(totalEngagement)}\n` +
            `📈 AVG EPM : ${avgEngagement}\n` +
            `-🌟 Brand Impressions -- ${brand} : ${formatNumber(brandPotentialReach)}\n` +
            `-🌟 Total Potential Impressions : ${formatNumber(totalPotentialReach)}\n\n` +
            reachBreakdown;

        console.log(outputData);

        // Write to file
        fs.writeFileSync('test_output_cleanV2.txt', outputData, 'utf8');

    } catch (err) {
        console.error("Test failed:", err);
    }
}

// Allow passing brand from command line
const brandArgument = process.argv[2] || "parimatch";
verifyMetricsV2(brandArgument);
