/**
 * Mega Surfer Backend — Unified Express Server
 *
 * Hosts BOTH the Instagram and TikTok backends against a single merged
 * PostgreSQL database (mega_surfer). Each platform's route logic is preserved
 * byte-for-byte in its own subtree and mounted under a distinct URL prefix:
 *
 *   /ig/api/*  → Instagram routes  (databases/Mega_surfer/ig)
 *   /tk/api/*  → TikTok routes     (databases/Mega_surfer/tk)
 *
 * Both subtrees read the same LOCAL_DATABASE_URL, so they share one database.
 * dotenv MUST load before the route/middleware requires below — tk/config/jwt.js
 * throws at import time if JWT_SECRET is unset.
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const initDatabase = require('./init-db');

// --- Instagram app (mounted under /ig) ---
const igHealthRoutes = require('./ig/routes/health');
const igUsersRoutes = require('./ig/routes/users');
const igPostsRoutes = require('./ig/routes/posts');
const igCommentsRoutes = require('./ig/routes/comments');
const igScrapeRoutes = require('./ig/routes/scrape');
const igAuthRoutes = require('./ig/routes/auth');
const igAdminRoutes = require('./ig/routes/admin');
const igProjectsRoutes = require('./ig/routes/projects');
const igAuth = require('./ig/middleware/auth');

// --- TikTok app (mounted under /tk) ---
const tkHealthRoutes = require('./tk/routes/health');
const tkUsersRoutes = require('./tk/routes/users');
const tkPostsRoutes = require('./tk/routes/posts');
const tkCommentsRoutes = require('./tk/routes/comments');
const tkScrapeRoutes = require('./tk/routes/scrape');
const tkAuthRoutes = require('./tk/routes/auth');
const tkAdminRoutes = require('./tk/routes/admin');
const tkProjectsRoutes = require('./tk/routes/projects');
const tkKeywordsRoutes = require('./tk/routes/keywords');
const tkVideosRoutes = require('./tk/routes/tiktok_videos');
const tkCreatorsRoutes = require('./tk/routes/tiktok_creators');
const tkTiktokCommentsRoutes = require('./tk/routes/tiktok_comments');
const tkAuth = require('./tk/middleware/auth');

const app = express();
const PORT = process.env.PORT || 8444;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' })); // large payloads from bulk capture

// Static admin UIs, one per platform
app.use('/ig', express.static(path.join(__dirname, 'ig', 'public')));
app.use('/tk', express.static(path.join(__dirname, 'tk', 'public')));

// ======================== Instagram routes (/ig/api) ========================
app.use('/ig/api', igHealthRoutes);
app.use('/ig/api/auth', igAuthRoutes);
app.use('/ig/api/admin', igAdminRoutes);
app.use('/ig/api', igAuth, igUsersRoutes);
app.use('/ig/api', igAuth, igPostsRoutes);
app.use('/ig/api', igAuth, igCommentsRoutes);
app.use('/ig/api', igAuth, igScrapeRoutes);
app.use('/ig/api', igAuth, igProjectsRoutes);

// ======================== TikTok routes (/tk/api) ========================
app.use('/tk/api', tkHealthRoutes);
app.use('/tk/api/auth', tkAuthRoutes);
app.use('/tk/api/admin', tkAdminRoutes);
app.use('/tk/api', tkAuth, tkUsersRoutes);
app.use('/tk/api', tkAuth, tkPostsRoutes);
app.use('/tk/api', tkAuth, tkCommentsRoutes);
app.use('/tk/api', tkAuth, tkScrapeRoutes);
app.use('/tk/api', tkAuth, tkProjectsRoutes);
app.use('/tk/api', tkAuth, tkKeywordsRoutes);
app.use('/tk/api', tkAuth, tkVideosRoutes);
app.use('/tk/api', tkAuth, tkCreatorsRoutes);
app.use('/tk/api', tkAuth, tkTiktokCommentsRoutes);

// Root landing — quick pointer to the two mounted APIs
app.get('/', (req, res) => {
    res.json({
        service: 'mega-surfer-backend',
        platforms: {
            instagram: '/ig/api',
            tiktok: '/tk/api',
        },
    });
});

// --- Start ---
module.exports = app;

if (require.main === module) {
    async function start() {
        await initDatabase();

        app.listen(PORT, () => {
            const isLocal = !!process.env.LOCAL_DATABASE_URL;
            console.log(`[SERVER] Mega Surfer backend running on http://localhost:${PORT}`);
            console.log(`[SERVER]   Instagram API → http://localhost:${PORT}/ig/api`);
            console.log(`[SERVER]   TikTok API    → http://localhost:${PORT}/tk/api`);
            console.log(`[SERVER] Detected Environment: ${isLocal ? 'LOCAL' : 'CLOUD'}`);
        });
    }

    start();
}
