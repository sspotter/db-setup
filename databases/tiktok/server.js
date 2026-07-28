/**
 * Tik Surfer Backend — Express Server
 */
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const os = require('os');
const http = require('http');
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

        // Bind explicitly to loopback + every non-Tailscale IPv4 interface.
        //
        // We can't use the wildcard (0.0.0.0): tailscaled runs the Funnel
        // listener on the tailnet IP :8443 (100.x), so a wildcard bind collides
        // with it (EADDRINUSE) and the service crash-loops. Binding specific
        // addresses lets us serve both access paths at once:
        //   - 127.0.0.1   -> the Tailscale Funnel proxy (it dials localhost:8443)
        //   - 192.168.1.3 -> the LAN IP that *.medpushmena.com subdomains resolve to
        // while leaving 100.115.149.3:8443 to tailscaled.
        //
        // Set HOST="a,b,c" to override the auto-detected list.
        const inTailscaleRange = (addr) => {
            const [a, b] = addr.split('.').map(Number);   // Tailscale CGNAT 100.64.0.0/10
            return a === 100 && b >= 64 && b <= 127;
        };
        const hosts = process.env.HOST
            ? process.env.HOST.split(',').map((s) => s.trim()).filter(Boolean)
            : ['127.0.0.1', ...Object.values(os.networkInterfaces()).flat()
                .filter((ni) => ni.family === 'IPv4' && !ni.internal && !inTailscaleRange(ni.address))
                .map((ni) => ni.address)];

        const isLocal = !!process.env.LOCAL_DATABASE_URL;
        console.log(`[SERVER] Detected Environment: ${isLocal ? 'LOCAL' : 'CLOUD'}`);

        // One listener per address. An error handler keeps a single failed bind
        // from throwing an unhandled 'error' event and taking the process down —
        // the other addresses (notably loopback for the Funnel) stay up.
        for (const host of [...new Set(hosts)]) {
            const server = http.createServer(app);
            server.on('error', (err) => {
                console.error(`[SERVER] could not bind ${host}:${PORT} — ${err.code || err.message}`);
            });
            server.listen(PORT, host, () => {
                console.log(`[SERVER] Tik Surfer backend listening on http://${host}:${PORT}`);
            });
        }
    }

    start();
}
