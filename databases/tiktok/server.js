/**
 * Tik Surfer Backend — Express Server
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const initDatabase = require('./init-db');

const healthRoutes = require('./routes/health');
const usersRoutes = require('./routes/users');
const postsRoutes = require('./routes/posts');
const commentsRoutes = require('./routes/comments');
const scrapeRoutes = require('./routes/scrape');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const projectsRoutes = require('./routes/projects');
const keywordsRoutes = require('./routes/keywords');
const tiktokVideosRoutes = require('./routes/tiktok_videos');
const tiktokCreatorsRoutes = require('./routes/tiktok_creators');
const tiktokCommentsRoutes = require('./routes/tiktok_comments');
const authenticateToken = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '50mb' })); // large payloads from bulk post capture
app.use(express.static('public')); // Serve static admin UI

// --- Routes ---
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Protected routes (requires JWT)
app.use('/api', authenticateToken, usersRoutes);
app.use('/api', authenticateToken, postsRoutes);
app.use('/api', authenticateToken, commentsRoutes);
app.use('/api', authenticateToken, scrapeRoutes);
app.use('/api', authenticateToken, projectsRoutes);
app.use('/api', authenticateToken, keywordsRoutes);
app.use('/api', authenticateToken, tiktokVideosRoutes);
app.use('/api', authenticateToken, tiktokCreatorsRoutes);
app.use('/api', authenticateToken, tiktokCommentsRoutes);

// --- Start ---
// Vercel handles requests directly by exporting the app
module.exports = app;

// Only listen locally if run directly (not imported as a module by Vercel)
if (require.main === module) {
    async function start() {
        await initDatabase();

        // Bind to loopback by default: tailscaled funnel owns the tailnet IP
        // :8443 and proxies to localhost:8443. Binding the wildcard (0.0.0.0)
        // would collide with that listener (EADDRINUSE), so we listen on
        // 127.0.0.1 — reachable by the funnel proxy and local health checks.
        // Override with HOST=<addr> only if you know it won't clash with 8443.
        const HOST = process.env.HOST || '127.0.0.1';
        app.listen(PORT, HOST, () => {
            const isLocal = !!process.env.LOCAL_DATABASE_URL;
            console.log(`[SERVER] Tik Surfer backend running on http://${HOST}:${PORT}`);
            console.log(`[SERVER] Detected Environment: ${isLocal ? 'LOCAL' : 'CLOUD'}`);
        });
    }

    start();
}
