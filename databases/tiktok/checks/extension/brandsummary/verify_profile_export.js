/**
 * Verifies TikTok user-detail → profile capture → enriched export mapping.
 * Mirrors sendProfileToBackend() (background.js) + handleInfluencerEnrichedExport()
 * (options.js). Run: node verify_profile_export.js
 */

// Sample webapp.user-detail payload (Marriott Bonvoy, from the live response).
const userInfo = {
    user: {
        id: '6669150739484655622',
        uniqueId: 'marriottbonvoy',
        nickname: 'Marriott Bonvoy',
        avatarLarger: 'https://p16.tiktokcdn.com/large.jpeg',
        avatarMedium: 'https://p16.tiktokcdn.com/medium.jpeg',
        avatarThumb: 'https://p16.tiktokcdn.com/thumb.jpeg',
        signature: 'Official TikTok of Marriott Bonvoy\n\n📍Where Can We Take You?\n\n#MarriottBonvoy',
        verified: true,
        secUid: 'MS4wLjABAAAAUlJ6...',
        bioLink: { link: 'Linktr.ee/marriottbonvoy', risk: 0 },
        commerceUserInfo: { commerceUser: true, category: 'Travel & Tourism' },
        privateAccount: false,
    },
    stats: { followerCount: 412000, followingCount: 53, videoCount: 781 },
};

// --- Mirror of sendProfileToBackend() field extraction ---
const u = userInfo.user, stats = userInfo.stats;
const avatarUrl = u.avatarLarger || u.avatarMedium || u.avatarThumb || null;
const category = u.commerceUserInfo?.category || u.category || '';
const displayName = u.nickname || null;
const profile = {
    id: u.id || u.uniqueId,
    username: u.uniqueId,
    follower_count: stats?.followerCount || 0,
    following_count: stats?.followingCount || 0,
    media_count: stats?.videoCount || 0,
    video_count: stats?.videoCount || 0,
    biography: u.signature || '',
    signature: u.signature || '',
    external_url: u.bioLink?.link || '',
    bio_link: u.bioLink?.link || '',
    is_verified: u.verified || false,
    is_private: u.privateAccount || false,
    business_category: category,
    category_name: category,
    display_name: displayName,
    full_name: displayName,
    avatar_url: avatarUrl,
    profile_pic_url: avatarUrl,
};

// --- Mirror of the enriched export row mapping ---
const cached = profile, inf = { username: profile.username };
const row = {
    'Username': inf.username || '',
    'Full Name': cached.display_name || cached.full_name || cached.nickname || inf.full_name || '',
    'User ID': String(cached.id || cached.pk || cached.user_id || inf.user_id || ''),
    'Followers': cached.follower_count || inf.followers || 0,
    'Following': cached.following_count || 0,
    'Media Count': cached.media_count || cached.video_count || inf.media_count || 0,
    'Verified': (cached.is_verified || inf.is_verified) ? 'Yes' : 'No',
    'Private': (cached.is_private) ? 'Yes' : 'No',
    'Category': cached.business_category || cached.category_name || cached.category || '',
    'Bio': (cached.biography || cached.signature || '').replace(/\n/g, ' '),
    'External URL': cached.external_url || cached.bio_link || '',
    'Profile Pic URL': cached.avatar_url || cached.profile_pic_url || '',
};

console.log('Export row:\n' + JSON.stringify(row, null, 2));

let failures = 0;
const check = (label, actual, expected) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? '✅' : '❌'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

console.log('\nChecks:');
check('Full Name', row['Full Name'], 'Marriott Bonvoy');
check('User ID', row['User ID'], '6669150739484655622');
check('Verified', row['Verified'], 'Yes');
check('Category', row['Category'], 'Travel & Tourism');
check('Bio populated', row['Bio'].includes('Official TikTok of Marriott Bonvoy'), true);
check('Bio has no newlines', /\n/.test(row['Bio']), false);
check('External URL', row['External URL'], 'Linktr.ee/marriottbonvoy');
check('Profile Pic URL populated', row['Profile Pic URL'].length > 0, true);

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
