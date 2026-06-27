const fs = require('fs');
const data = JSON.parse(fs.readFileSync('igtest4.json', 'utf8'));
const post = data.posts.find(p => p.shortcode === 'DUEaA9-DIBR');
console.log(JSON.stringify(post, null, 2));
