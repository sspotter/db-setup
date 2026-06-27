const fs = require('fs');
const path = require('path');

// Load igtest.json
const dataPath = path.join( 'igtest.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const posts = data.posts || [];
const globalProfilesDataset = data.scrapedProfiles || [];

function calculateCollectiveReach(posts) {
    const collabInfluencers = new Map();
    let collabCount = 0;
    let paidCount = 0;

    const addInfluencer = (username, followers, source, path, extraProfileData = {}) => {
        if (!username) return;

        let is_verified = extraProfileData.is_verified || false;
        let full_name = extraProfileData.full_name || '';
        let category_name = extraProfileData.category_name || '';
        let media_count = extraProfileData.media_count || 0;

        const cachedProfile = globalProfilesDataset.find(p => p.username === username);
        if (!followers || followers === 0) {
            if (cachedProfile && cachedProfile.follower_count) {
                followers = cachedProfile.follower_count;
            }
        }
        if (cachedProfile) {
            if (!is_verified && cachedProfile.is_verified !== undefined) is_verified = cachedProfile.is_verified;
            if (!full_name && cachedProfile.full_name) full_name = cachedProfile.full_name;
            if (!category_name && cachedProfile.category_name) category_name = cachedProfile.category_name;
            if (!media_count && cachedProfile.media_count) media_count = cachedProfile.media_count;
        }

        if (!collabInfluencers.has(username)) {
            collabInfluencers.set(username, {
                username,
                followers: followers || 0,
                sources: new Set([source]),
                paths: [path],
                perUserCollabCount: 0,
                perUserPaidCount: 0,
                postCount: 0,
                is_verified,
                full_name,
                category_name,
                media_count,
            });
        } else {
            const existing = collabInfluencers.get(username);
            existing.sources.add(source);
            existing.paths.push(path);
            if (followers > existing.followers) existing.followers = followers;
            if (is_verified && !existing.is_verified) existing.is_verified = is_verified;
            if (full_name && !existing.full_name) existing.full_name = full_name;
            if (category_name && !existing.category_name) existing.category_name = category_name;
            if (media_count > existing.media_count) existing.media_count = media_count;
        }
    };

    posts.forEach((post, index) => {
        const coauthorList = post.coauthor_producers || post.coauthors || [];
        const hasCoauthors = coauthorList.length > 0;
        const isPaid = post.is_paid_partnership || post.isPaid || post.type === 'paid' || post.type === 'collab' || post.type === 'paid_collab';

        if (isPaid) paidCount++;
        if (hasCoauthors) collabCount++;

        const influencersInThisPost = new Set();
        const localAddInfluencer = (username, followers, source, path, extraProfileData = {}) => {
            addInfluencer(username, followers, source, path, extraProfileData);
            if (username && !influencersInThisPost.has(username)) {
                const inf = collabInfluencers.get(username);
                if (hasCoauthors) inf.perUserCollabCount++;
                if (isPaid) inf.perUserPaidCount++;
                inf.postCount++;
                influencersInThisPost.add(username);
            }
        };

        const mainUser = post.owner?.username || post.user?.username || post.username || post.caption_user?.username;
        const mainReach = post.owner?.follower_count || post.user?.follower_count || post.owner?.edge_followed_by?.count || post.followers || 0;
        localAddInfluencer(mainUser, mainReach, 'Owner', `.items[${index}].user.username`, post.owner || post.user || {});

        // FOR PARIMATCH: check scrapedFromProfile too
        if (post.scrapedFromProfile === 'parimatch' && mainUser !== 'parimatch') {
            localAddInfluencer('parimatch', 0, 'ScrapedFrom', `.items[${index}].scrapedFromProfile`, {});
        }

        if (coauthorList.length > 0) {
            coauthorList.forEach((c, j) => {
                const coReach = c.follower_count || c.edge_followed_by?.count || 0;
                localAddInfluencer(c.username, coReach, 'Co-author', `.items[${index}].coauthor_producers[${j}].username`, c);
            });
        }
    });

    return { 
        influencers: Array.from(collabInfluencers.values()).sort((a, b) => (b.followers * b.postCount) - (a.followers * a.postCount)),
        collabCount, 
        paidCount 
    };
}

const result = calculateCollectiveReach(posts);
const partners = result.influencers;

// Formatting helpers
const formatReachNumber = number => {
    if (number === undefined || number === null) return '0';
    if (number >= 1000000) return (number / 1000000).toFixed(1) + 'M';
    if (number >= 1000) return (number / 1000).toFixed(1) + 'K';
    return number.toLocaleString();
};

const formatStatNumber = number => number ? number.toLocaleString() : '0';

const totalPotentialImpressions = partners.reduce((sum, inf) => sum + (inf.followers * inf.postCount), 0);
const totalFollowers = partners.reduce((sum, inf) => sum + (inf.followers || 0), 0);

console.log(`🌟 Potential Impressions : ${formatStatNumber(totalPotentialImpressions)}`);
console.log(`×`);
console.log(`${formatStatNumber(totalFollowers)}`);
console.log(`Total Followers`);
console.log(`${result.collabCount} Total Collab Posts`);

const brandInf = partners.find(p => p.username === 'parimatch');
if (brandInf) {
    console.log(`Mainbrand:`);
    console.log(`@${brandInf.username}`);
    console.log(`✓`);
    console.log(`Total: 80 posts`);
    console.log(`Followers: ${formatReachNumber(brandInf.followers)}`);
    console.log(`🏢 Brand`);
    console.log(`🐰 Competitor`);
    const reach = brandInf.followers * brandInf.postCount;
    console.log(`Potential Impressions: ${formatReachNumber(reach)}`);
    console.log(`Gathered Posts: ${brandInf.postCount}`);
    console.log(`-------------------`);
}

console.log(`Partner Breakdown`);
console.log(`-------------------`);
partners.filter(p => p.username !== 'parimatch').forEach(inf => {
    const calculatedReach = (inf.followers || 0) * (inf.postCount || 1);
    console.log(`@${inf.username}`);
    if (inf.is_verified) console.log(`✓`);
    console.log(`Total: ${formatStatNumber(inf.media_count)} posts`);
    console.log(`Followers: ${formatReachNumber(inf.followers)}`);
    console.log(`🏢 Brand`);
    console.log(`🐰 Competitor`);
    console.log(`Potential Impressions: ${formatReachNumber(calculatedReach)}`);
    console.log(`Collab Post: ${inf.postCount}`);
    console.log(`-------------------`);
});
