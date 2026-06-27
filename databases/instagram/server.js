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
const projectsRoutes = require('./routes/projects');
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

// --- Start ---
// Vercel handles requests directly by exporting the app
module.exports = app;

// Only listen locally if run directly (not imported as a module by Vercel)
if (require.main === module) {
    async function start() {
        await initDatabase();

        app.listen(PORT, () => {
            const isLocal = !!process.env.LOCAL_DATABASE_URL;
            console.log(`[SERVER] Insta Surfer backend running on http://localhost:${PORT}`);
            console.log(`[SERVER] Detected Environment: ${isLocal ? 'LOCAL' : 'CLOUD'}`);
        });
    }

    start();
}
