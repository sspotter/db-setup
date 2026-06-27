const fs = require('fs');
const data = JSON.parse(fs.readFileSync('e:/codinnnn/Develeopment_Extensions/insta_surfer_cloudproject/backend/igtest.json', 'utf8'));

let totalPotentialReach = 0;
const userReach = {};

// We need follower counts. In the script it comes from ig_users table.
// In igtest.json, is there a follower count?
// Let's check a post.
/*
      "owner": {
        "username": "parimatch"
      },
*/
// It doesn't seem to have follower counts in the posts.

// Wait, the test_verify.js script uses the database for follower counts.
// Maybe I should look at the database.

// Let's see the breakdown in test_verify.js output again.
//  - @conallbdoyle (tracked): 684,362 (2 posts)
//  - @lnr_motion (tracked): 980,316 (12 posts)
//  - @parimatch (tracked): 3,284,280 (60 posts)
// These three sum to exactly 4,948,958.

// Why these three?
// Maybe because they are the ONLY ones with posts in the project posts list?
// Wait, all of them have posts.
// drinkrani has 60 posts.
// h29u has 12 posts.

// WAIT!
// I noticed something.
// parimatch follower count: 3,284,280 / 60 = 54,738
// lnr_motion follower count: 980,316 / 12 = 81,693
// conallbdoyle follower count: 684,362 / 2 = 342,181

// Maybe only profiles that actually APPEAR on parimatch posts?
// Or maybe the project profiles have a 'role' that I'm missing?
// In the output:
// conallbdoyle (tracked)
// lnr_motion (tracked)
// parimatch (tracked)
// h29u (tracked)
// lovinriyadh (tracked)
// lovinsaudi (tracked)
// drinkrani (reference)

// Wait, I should check the 'post_relations'!
// Maybe conallbdoyle and lnr_motion are the ONLY ones with relations to parimatch posts?
