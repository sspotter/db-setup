/**
 * Insta Surfer Backend — Express Server
 */
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
const adminInsightsRoutes = require('./routes/adminInsights');
const adminProjectsRoutes = require('./routes/adminProjects');
const adminAuditRoutes = require('./routes/adminAudit');
const adminUsageRoutes = require('./routes/adminUsage');
const adminPlansRoutes = require('./routes/adminPlans');
const adminAccountsRoutes = require('./routes/adminAccounts');
const adminBlocksRoutes = require('./routes/adminBlocks');
const adminUserOverviewRoutes = require('./routes/adminUserOverview');
const adminProjectPostsRoutes = require('./routes/adminProjectPosts');
const projectsRoutes = require('./routes/projects');
const authenticateToken = require('./middleware/auth');
const { activityLog, startRetention } = require('./middleware/activityLog');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors());
// Before express.json so 400/413 body-parse failures are logged too -> api_events
app.use('/api', activityLog);
app.use(express.json({ limit: '50mb' })); // large payloads from bulk post capture
app.use(express.static('public')); // Serve static admin UI

// --- Routes ---
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminInsightsRoutes);
app.use('/api/admin', adminProjectsRoutes);
app.use('/api/admin', adminAuditRoutes);
app.use('/api/admin', adminUsageRoutes);
app.use('/api/admin', adminPlansRoutes);
app.use('/api/admin', adminAccountsRoutes);
app.use('/api/admin', adminBlocksRoutes);
app.use('/api/admin', adminUserOverviewRoutes);
app.use('/api/admin', adminProjectPostsRoutes);

// Protected routes (requires JWT)
app.use('/api', authenticateToken, usersRoutes);
app.use('/api', authenticateToken, postsRoutes);
app.use('/api', authenticateToken, commentsRoutes);
app.use('/api', authenticateToken, scrapeRoutes);
app.use('/api', authenticateToken, projectsRoutes);

// --- Start ---
// Vercel handles requests directly by exporting the app
module.exports = app;

// Only listen locally if run directly (not imported as a module by Vercel)
if (require.main === module) {
    async function start() {
        await initDatabase();
        startRetention();

        app.listen(PORT, () => {
            const isLocal = !!process.env.LOCAL_DATABASE_URL;
            console.log(`[SERVER] Insta Surfer backend running on http://localhost:${PORT}`);
            console.log(`[SERVER] Detected Environment: ${isLocal ? 'LOCAL' : 'CLOUD'}`);
        });
    }

    start();
}
