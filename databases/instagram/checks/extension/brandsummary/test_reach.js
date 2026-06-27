const fs = require('fs');
const path = require('path');

// Load igtest.json
const dataPath = path.join('igtest.json');
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

        if (coauthorList.length > 0) {
            coauthorList.forEach((c, j) => {
                const coReach = c.follower_count || c.edge_followed_by?.count || 0;
                localAddInfluencer(c.username, coReach, 'Co-author', `.items[${index}].coauthor_producers[${j}].username`, c);
            });
        }

        const captionUser = post.caption_user || post.caption?.user;
        if (captionUser && captionUser.username && captionUser.username !== mainUser) {
            const capReach = captionUser.follower_count || captionUser.edge_followed_by?.count || 0;
            localAddInfluencer(captionUser.username, capReach, 'Caption', `.items[${index}].caption.user.username`, captionUser);
        }
    });

    return Array.from(collabInfluencers.values()).sort((a, b) => (b.followers * b.postCount) - (a.followers * a.postCount));
}

const partners = calculateCollectiveReach(posts);

const formatReachNumber = number => {
    if (number === undefined || number === null) return '0';
    if (number >= 1000000) return (number / 1000000).toFixed(1) + 'M';
    if (number >= 1000) return (number / 1000).toFixed(1) + 'K';
    return number.toLocaleString();
};

const totalPotentialImpressions = partners.reduce((sum, inf) => sum + (inf.followers * inf.postCount), 0);
const totalFollowers = partners.reduce((sum, inf) => sum + (inf.followers || 0), 0);
const totalCollabPosts = posts.filter(p => (p.coauthor_producers || p.coauthors || []).length > 0).length;

console.log(`🌟 Potential Impressions : ${totalPotentialImpressions.toLocaleString()}`);
console.log(`×`);
console.log(`${totalFollowers.toLocaleString()}`);
console.log(`Total Followers`);
console.log(`${totalCollabPosts} Total Collab Posts`);
console.log(`Partner Breakdown`);

partners.forEach(inf => {
    const calculatedReach = (inf.followers || 0) * (inf.postCount || 1);
    console.log(`@${inf.username}`);
    if (inf.is_verified) console.log(`✓`);
    console.log(`Total: ${inf.media_count.toLocaleString()} posts`);
    console.log(`Followers: ${formatReachNumber(inf.followers)}`);
    console.log(`🏢 Brand`);
    console.log(`🐰 Competitor`);
    console.log(`Potential Impressions: ${formatReachNumber(calculatedReach)}`);
    console.log(`Collab Post: ${inf.postCount}`);
    console.log(`-------------------`);
});
