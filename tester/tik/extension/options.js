document.addEventListener('DOMContentLoaded', () => {
    // Dynamically set version
    const versionDisplay = document.getElementById('about-version-display');
    if (versionDisplay && chrome.runtime?.getManifest) {
        versionDisplay.textContent = `Version ${chrome.runtime.getManifest().version}`;
    }

    const { isLocalNetwork } = window.CONFIG;
    // --- Elements ---
    const tabs = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    const fileUpload = document.getElementById('file-upload');
    const btnImportJson = document.getElementById('btn-import-json');
    const btnRefresh = document.getElementById('btn-refresh');
    const postsGrid = document.getElementById('posts-grid');
    const emptyState = document.getElementById('empty-state');
    const loadingState = document.getElementById('loading-state');

    const statTotalPosts = document.getElementById('stat-total-posts');
    const statTotalLikes = document.getElementById('stat-total-likes');
    const statTotalComments = document.getElementById('stat-total-comments');
    const statTotalEngagement = document.getElementById('stat-total-engagement');
    const statAvgLikes = document.getElementById('stat-avg-likes');
    const statAvgComments = document.getElementById('stat-avg-comments');

    const statAvgEpm = document.getElementById('stat-avg-epm');

    const commStatPosts = document.getElementById('comm-stat-posts');
    const commStatLikes = document.getElementById('comm-stat-likes');
    const commStatComments = document.getElementById('comm-stat-comments');
    const commStatEngagement = document.getElementById('comm-stat-engagement');
    const commStatAvgLikes = document.getElementById('comm-stat-avg-likes');
    const commStatAvgComments = document.getElementById('comm-stat-avg-comments');
    const commStatAvgEpm = document.getElementById('comm-stat-avg-epm');
    const commStatScraped = document.getElementById('comm-stat-scraped');
    const commSearchInput = document.getElementById('comm-search-input');
    const commSortSelect = document.getElementById('comm-sort-select');
    const commPostsGrid = document.getElementById('comm-posts-grid');
    const commEmptyState = document.getElementById('comm-empty-state');
    const commLoadingState = document.getElementById('comm-loading-state');
    const commPaginationControls = document.getElementById('comm-pagination-controls');
    const commBtnPrevPage = document.getElementById('comm-btn-prev-page');
    const commBtnNextPage = document.getElementById('comm-btn-next-page');
    const commPageIndicator = document.getElementById('comm-page-indicator');

    const searchInput = document.getElementById('search-input');
    const sortSelect = document.getElementById('sort-select');
    const btnExportCsv = document.getElementById('btn-export-csv');

    const paginationControls = document.getElementById('pagination-controls');
    const btnPrevPage = document.getElementById('btn-prev-page');
    const btnNextPage = document.getElementById('btn-next-page');
    const pageIndicator = document.getElementById('page-indicator');

    const modal = document.getElementById('post-modal');
    const closeBtn = modal.querySelector('.close-modal');
    const modalDetails = document.getElementById('modal-details');

    // Settings elements
    const settingApiUrl = document.getElementById('setting-api-url');
    const settingApiKey = document.getElementById('setting-api-key');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const settingsStatus = document.getElementById('settings-status');
    const toastContainer = document.getElementById('toast-container');
    const btnCheckUpdates = document.getElementById('btn-check-updates');
    const updateCheckStatus = document.getElementById('update-check-status');
    const btnRefetchConfig = document.getElementById('btn-refetch-config');
    const refetchConfigStatus = document.getElementById('refetch-config-status');
    const btnThemeToggle = document.getElementById('btn-theme-toggle');

    // Reach panel toggle elements
    const btnToggleReach = document.getElementById('btn-toggle-reach');
    const commBtnToggleReach = document.getElementById('comm-btn-toggle-reach');
    const reachPanel = document.getElementById('reach-panel');
    const commReachPanel = document.getElementById('comm-reach-panel');
    const btnCloseReach = document.getElementById('btn-close-reach');
    const commBtnCloseReach = document.getElementById('comm-btn-close-reach');
    const btnExportEnriched = document.getElementById('btn-export-enriched');
    const commBtnExportEnriched = document.getElementById('comm-btn-export-enriched');
    const commBtnExportEnrichedComments = document.getElementById('comm-btn-export-enriched-comments');
    // (proj2 reach panel elements removed — now competitive dashboard)



    // --- State ---
    let allPosts = [];
    let filteredPosts = [];
    let currentPage = 1;
    let activeProfileFilter = null;
    let activeClassFilter = 'all';
    let activeScrapeFilter = 'all'; // 'all' | 'scraped' | 'partial' | 'unscraped'
    let _scrapedCountsCache = {}; // { [shortcode]: scrapedCount } — refreshed on each async filter pass
    const POSTS_PER_PAGE = 24;
    let currentPartnersList = [];

    // How Competitive Analysis decides which posts belong to a tracked profile.
    //   'relationship' — owner OR coauthor (PostIndex), matching the Dataset Viewer.
    //   'capture'      — the legacy rule: also credits scrapedFromProfile and
    //                    caption_user, so a post counts for whichever profile was
    //                    being browsed when it was captured.
    // Kept switchable (rather than deleting the legacy path) so the two can be
    // compared on real data before the old rule is retired.
    let compAttributionMode = 'relationship';
    let globalProfilesDataset = [];
    let localRolesMap = {};

    // Flag to suppress storage listener during programmatic imports (must be in outer scope)
    let _suppressStorageReload = false;

    // Profile filter elements
    const profileFilterBar = document.getElementById('profile-filter-bar');

    // Date filter elements
    const filterDateFrom = document.getElementById('filter-date-from');
    const filterDateTo = document.getElementById('filter-date-to');
    const btnClearDates = document.getElementById('btn-clear-dates');

    // Classification filter elements
    const classFilterChips = document.querySelectorAll('.class-filter-chip');

    const toggleCollabPosts = document.getElementById('toggle-collab-posts');
    const commToggleCollabPosts = document.getElementById('comm-toggle-collab-posts');

    // JSON export button
    const btnExportJson = document.getElementById('btn-export-json');
    const commBtnExportJson = document.getElementById('comm-btn-export-json');
    const commBtnExportCsv = document.getElementById('comm-btn-export-csv');
    const commBtnExportXlsx = document.getElementById('comm-btn-export-xlsx');
    const commBatchScrapeBtn = document.getElementById('comm-batch-scrape-btn');

    // Capture log elements
    const consoleBody = document.getElementById('console-body');
    const consoleEmpty = document.getElementById('console-empty');
    const consoleLiveDot = document.getElementById('console-live-dot');
    const btnClearConsole = document.getElementById('btn-clear-console');




            const RANK_COLORS = [
            { bg:'#F0F7FF', border:'#93C5FD', accent:'#3B82F6', badge:'#DBEAFE', badgeText:'#2563EB', textDark:'#1E3A8A', textMid:'#1E40AF', textLight:'#1D4ED8' }, // Blue
  // Muted Teal
  { bg:'#F0FDFA', border:'#6EE7B7', accent:'#2DD4BF', badge:'#CCFBF1', badgeText:'#0F766E', textDark:'#134E4A', textMid:'#0F766E', textLight:'#14B8A6' },
            { bg:'#FFFBF0', border:'#F6C84B', accent:'#F59E0B', badge:'#FEF3C7', badgeText:'#D97706', textDark:'#78350F', textMid:'#92400E', textLight:'#B45309' }, // Gold
            { bg:'#F8F5FF', border:'#C4B5FD', accent:'#8B5CF6', badge:'#EDE9FE', badgeText:'#7C3AED', textDark:'#3B0764', textMid:'#4C1D95', textLight:'#6D28D9' }, // Violet
          // Soft Pink
  { bg:'#FFF1F2', border:'#FBCFE8', accent:'#F472B6', badge:'#FCE7F3', badgeText:'#9D174D', textDark:'#831843', textMid:'#BE185D', textLight:'#EC4899' },
//   // Calm Green
  { bg:'#F0FDF4', border:'#86EFAC', accent:'#4ADE80', badge:'#DCFCE7', badgeText:'#166534', textDark:'#14532D', textMid:'#166534', textLight:'#22C55E' },

//           // Warm Coral
//   { bg:'#FFF4F1', border:'#FCA5A5', accent:'#F87171', badge:'#FEE2E2', badgeText:'#B91C1C', textDark:'#7F1D1D', textMid:'#991B1B', textLight:'#B91C1C' },

//   // Soft Lavender
//   { bg:'#F9F5FF', border:'#C7D2FE', accent:'#818CF8', badge:'#E0E7FF', badgeText:'#4338CA', textDark:'#312E81', textMid:'#4338CA', textLight:'#6366F1' },

//   // Muted Orange
//   { bg:'#FFF8F1', border:'#FED7AA', accent:'#FBBF24', badge:'#FFEDD5', badgeText:'#B45309', textDark:'#78350F', textMid:'#92400E', textLight:'#B7791F' },

//   // Calm Green
//   { bg:'#F0FDF4', border:'#86EFAC', accent:'#4ADE80', badge:'#DCFCE7', badgeText:'#166534', textDark:'#14532D', textMid:'#166534', textLight:'#22C55E' },

//   // Dusty Blue
//   { bg:'#EFF6FF', border:'#93C5FD', accent:'#60A5FA', badge:'#DBEAFE', badgeText:'#1E40AF', textDark:'#1E3A8A', textMid:'#2563EB', textLight:'#3B82F6' },

//   // Soft Pink
//   { bg:'#FFF1F2', border:'#FBCFE8', accent:'#F472B6', badge:'#FCE7F3', badgeText:'#9D174D', textDark:'#831843', textMid:'#BE185D', textLight:'#EC4899' },

//   // Muted Teal
//   { bg:'#F0FDFA', border:'#6EE7B7', accent:'#2DD4BF', badge:'#CCFBF1', badgeText:'#0F766E', textDark:'#134E4A', textMid:'#0F766E', textLight:'#14B8A6' },

        
        
        ];


//             const RANK_COLORS = [
//             { bg:'#F0F7FF', border:'#93C5FD', accent:'#3B82F6', badge:'#DBEAFE', badgeText:'#2563EB', textDark:'#1E3A8A', textMid:'#1E40AF', textLight:'#1D4ED8' }, // Blue
//             { bg:'#F0FDF8', border:'#6EE7B7', accent:'#10B981', badge:'#D1FAE5', badgeText:'#059669', textDark:'#064E3B', textMid:'#065F46', textLight:'#047857' }, // Teal
//             { bg:'#FFFBF0', border:'#F6C84B', accent:'#F59E0B', badge:'#FEF3C7', badgeText:'#D97706', textDark:'#78350F', textMid:'#92400E', textLight:'#B45309' }, // Gold
//             { bg:'#F8F5FF', border:'#C4B5FD', accent:'#8B5CF6', badge:'#EDE9FE', badgeText:'#7C3AED', textDark:'#3B0764', textMid:'#4C1D95', textLight:'#6D28D9' }, // Violet
//             { bg:'#FFF5F7', border:'#FDA4AF', accent:'#F43F5E', badge:'#FFE4E6', badgeText:'#E11D48', textDark:'#881337', textMid:'#9F1239', textLight:'#BE185D' }, // Rose
        
//           // Warm Coral
//   { bg:'#FFF4F1', border:'#FCA5A5', accent:'#F87171', badge:'#FEE2E2', badgeText:'#B91C1C', textDark:'#7F1D1D', textMid:'#991B1B', textLight:'#B91C1C' },

//   // Soft Lavender
//   { bg:'#F9F5FF', border:'#C7D2FE', accent:'#818CF8', badge:'#E0E7FF', badgeText:'#4338CA', textDark:'#312E81', textMid:'#4338CA', textLight:'#6366F1' },

//   // Muted Orange
//   { bg:'#FFF8F1', border:'#FED7AA', accent:'#FBBF24', badge:'#FFEDD5', badgeText:'#B45309', textDark:'#78350F', textMid:'#92400E', textLight:'#B7791F' },

//   // Calm Green
//   { bg:'#F0FDF4', border:'#86EFAC', accent:'#4ADE80', badge:'#DCFCE7', badgeText:'#166534', textDark:'#14532D', textMid:'#166534', textLight:'#22C55E' },

//   // Dusty Blue
//   { bg:'#EFF6FF', border:'#93C5FD', accent:'#60A5FA', badge:'#DBEAFE', badgeText:'#1E40AF', textDark:'#1E3A8A', textMid:'#2563EB', textLight:'#3B82F6' },

//   // Soft Pink
//   { bg:'#FFF1F2', border:'#FBCFE8', accent:'#F472B6', badge:'#FCE7F3', badgeText:'#9D174D', textDark:'#831843', textMid:'#BE185D', textLight:'#EC4899' },

//   // Muted Teal
//   { bg:'#F0FDFA', border:'#6EE7B7', accent:'#2DD4BF', badge:'#CCFBF1', badgeText:'#0F766E', textDark:'#134E4A', textMid:'#0F766E', textLight:'#14B8A6' },

        
        
//         ];



    // --- Remote Config & Feature Flags ---
    function applyRemoteConfig(config) {
        if (!config) return;

        // 1) Global Kill Switch
        if (config.global?.enabled === false) {
            document.body.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f0f13;color:#fff;font-family:Inter,sans-serif;text-align:center;">
                    <div>
                        <div style="font-size:48px;margin-bottom:16px;">🔒</div>
                        <h2 style="margin:0 0 8px;">Temporarily Disabled</h2>
                        <p style="color:#a1a1aa;margin:0;">The extension has been disabled remotely. Please check back later.</p>
                    </div>
                </div>`;
            return;
        }

        // 2) Maintenance Mode
        if (config.global?.maintenanceMode === true) {
            document.body.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f0f13;color:#fff;font-family:Inter,sans-serif;text-align:center;">
                    <div>
                        <div style="font-size:48px;margin-bottom:16px;">🔧</div>
                        <h2 style="margin:0 0 8px;">Under Maintenance</h2>
                        <p style="color:#a1a1aa;margin:0;">We're performing maintenance. The extension will be back shortly.</p>
                    </div>
                </div>`;
            return;
        }

        // 3) Feature flags
        if (config.features?.scraperEnabled === false) {
            if (commBatchScrapeBtn) commBatchScrapeBtn.style.display = 'none';
        } else if (config.features?.scraperEnabled === true) {
            if (commBatchScrapeBtn) commBatchScrapeBtn.style.display = '';
        }

        // 3b) Competitive Dashboard Granular Flags
        const compFeatures = {
            'comp_renderSelectorBar': '.comp-selector-bar',
            'comp_renderKPIs': '#comp-summary-cards', // summary cards container
            'comp_renderCollaborations': '#comp-collaborations',
            'comp_renderEngagementComparison': '#comp-engagement-bars',
            'comp_renderCharts': '#comp-chart-canvas',
            'comp_renderReachBreakdown': '#comp-reach-breakdown',
            'comp_renderTopPosts': '#comp-top-posts',
            'comp_renderExportData': '.comp-export-section',
            'comp_renderDetailedBreakdown': '.comp-breakdown-section'
        };

        Object.entries(compFeatures).forEach(([flag, selector]) => {
            const val = config.features?.[flag];
            if (val === undefined) return; // Skip if flag missing

            const el = document.querySelector(selector);
            if (el) {
                // For nested IDs, we might want to hide the parent .comp-section
                const section = el.classList.contains('comp-section') ? el : el.closest('.comp-section') || el;
                section.style.display = (val === false) ? 'none' : '';
            }
        });

        // 4) UI — Tab visibility
        if (config.ui?.tabs) {
            let firstVisibleTab = null;
            let activeTabHidden = false;

            tabs.forEach(tab => {
                const tabId = tab.getAttribute('data-tab');
                if (config.ui.tabs[tabId] === false) {
                    tab.style.display = 'none';
                    if (tab.classList.contains('active')) {
                        activeTabHidden = true;
                    }
                } else {
                    tab.style.display = ''; // Ensure visible
                    if (!firstVisibleTab) firstVisibleTab = tab;
                }
            });

            // If the currently active tab was hidden, switch to the first visible one
            if (activeTabHidden && firstVisibleTab) {
                firstVisibleTab.click();
            }
        }
    }

    chrome.storage.local.get(['remoteConfig'], (result) => {
        applyRemoteConfig(result.remoteConfig);
    });

    // --- Theme Toggle ---
    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', () => {
            const isLight = document.body.classList.toggle('light-theme');
            chrome.storage.local.set({ theme: isLight ? 'light' : 'dark' });
            btnThemeToggle.textContent = isLight ? '🌙' : '☀️';
            try {
                if (typeof compTimeseriesData !== 'undefined' && compTimeseriesData) {
                    comp_renderTimeSeries(compTimeseriesData);
                }
            } catch (e) {
                console.log('Failed to re-render chart on theme toggle:', e);
            }
        });

        chrome.storage.local.get(['theme'], (res) => {
            if (res.theme === 'light') {
                document.body.classList.add('light-theme');
                btnThemeToggle.textContent = '🌙';
            } else {
                btnThemeToggle.textContent = '☀️';
            }
        });
    }

    // --- Light Theme Depth Slider ---
    const lightDepthSlider = document.getElementById('setting-light-depth');
    const lightDepthValue = document.getElementById('light-depth-value');

    const updateLightDepth = (val) => {
        let labels = ['Soft', 'Medium', 'Heavy'];
        if (lightDepthValue) lightDepthValue.textContent = labels[val - 1];
        document.body.classList.remove('light-depth-1', 'light-depth-2', 'light-depth-3');
        document.body.classList.add(`light-depth-${val}`);
        chrome.storage.local.set({ lightDepth: val });
    };

    if (lightDepthSlider) {
        lightDepthSlider.addEventListener('input', (e) => {
            updateLightDepth(parseInt(e.target.value));
        });

        chrome.storage.local.get(['lightDepth'], (res) => {
            const val = res.lightDepth || 2;
            lightDepthSlider.value = val;
            updateLightDepth(val);
        });
    }

    // --- Tab Navigation ---
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tab.getAttribute('data-tab')).classList.add('active');
        });
    });

    // --- Potential Impressions Toggle ---
    let isReachVisible = false;

    function updateReachVisibility(visible) {
        isReachVisible = visible;
        const display = visible ? 'block' : 'none';
        if (reachPanel) reachPanel.style.display = display;
        if (commReachPanel) commReachPanel.style.display = display;


        // Update button text/state if needed
        const label = visible ? '📊 Hide Potential Impressions' : '📊 View Potential Impressions';
        if (btnToggleReach) btnToggleReach.textContent = label;
        if (commBtnToggleReach) commBtnToggleReach.textContent = label;


        // Persist
        chrome.storage.local.set({ reach_panel_visible: visible });
    }

    // Load initial state
    chrome.storage.local.get(['reach_panel_visible'], (result) => {
        if (result.reach_panel_visible !== undefined) {
            updateReachVisibility(result.reach_panel_visible);
        }
    });

    if (btnToggleReach) btnToggleReach.addEventListener('click', () => updateReachVisibility(!isReachVisible));
    if (commBtnToggleReach) commBtnToggleReach.addEventListener('click', () => updateReachVisibility(!isReachVisible));
    if (btnCloseReach) btnCloseReach.addEventListener('click', () => updateReachVisibility(false));
    if (commBtnCloseReach) commBtnCloseReach.addEventListener('click', () => updateReachVisibility(false));

    const compAttributionModeEl = document.getElementById('comp-attribution-mode');
    if (compAttributionModeEl) compAttributionModeEl.addEventListener('change', (e) => {
        compAttributionMode = e.target.value === 'capture' ? 'capture' : 'relationship';
        chrome.storage.local.get(['extension_settings'], (result) => {
            const settings = result.extension_settings || {};
            settings.compAttributionMode = compAttributionMode;
            chrome.storage.local.set({ extension_settings: settings });
        });
        // Recompute the dashboard only if one is already on screen.
        if (compSelectedBrand) comp_loadDashboard();
    });

    const btnScrollEnd = document.getElementById('btn-scroll-end');
    if (btnScrollEnd) btnScrollEnd.addEventListener('click', beginScrollPick);

    const btnToggleCapture = document.getElementById('btn-toggle-capture');
    if (btnToggleCapture) btnToggleCapture.addEventListener('click', handleToggleCapture);
    chrome.storage.local.get(['capture_state'], (r) => renderCaptureToggle(r.capture_state));

    const btnRecheck = document.getElementById('btn-recheck-data');
    if (btnRecheck) btnRecheck.addEventListener('click', runDataRecheck);
    const btnCloseAudit = document.getElementById('btn-close-audit');
    if (btnCloseAudit) btnCloseAudit.addEventListener('click', () => {
        document.getElementById('audit-modal').style.display = 'none';
    });
    const btnApplyFixes = document.getElementById('btn-apply-fixes');
    if (btnApplyFixes) btnApplyFixes.addEventListener('click', handleApplyFixes);

    ['btn-show-calculations', 'comm-btn-show-calculations'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', showCalculations);
    });
    const btnCloseCalc = document.getElementById('btn-close-calc');
    if (btnCloseCalc) btnCloseCalc.addEventListener('click', () => {
        document.getElementById('calc-modal').style.display = 'none';
    });

    // --- Data Loading ---
    async function loadLocalData() {
        showLoading(true);
        try {
            // Load profiles and roles from chrome.storage
            const stored = await new Promise(r => chrome.storage.local.get(['profiles_dataset', 'local_roles_map', 'extension_settings'], r));
            globalProfilesDataset = stored.profiles_dataset || [];
            localRolesMap = stored.local_roles_map || {};
            const activeProjectId = projCurrentProjectId || stored.extension_settings?.activeProjectId || null;

            if (stored.extension_settings?.compAttributionMode === 'capture') {
                compAttributionMode = 'capture';
            }
            const compModeEl = document.getElementById('comp-attribution-mode');
            if (compModeEl) compModeEl.value = compAttributionMode;

            // Read posts from PostsStore — strict bucket resolution (no fallback)
            let posts;
            if (activeProjectId) {
                posts = await PostsStore.getProjectPosts(activeProjectId);
            } else {
                posts = await PostsStore.getUnassignedPosts();
            }
            // Empty means truly empty — no cross-bucket merging
            allPosts = (posts || []).map(normalizePostData);

            // Update empty state messaging to be contextual
            _updateEmptyStateMessage(activeProjectId, allPosts.length);

            // Reset filters to prevent sticky selections across different projects
            activeProfileFilter = null;
            activeClassFilter = 'all';
            activeScrapeFilter = 'all';

            document.querySelectorAll('.class-filter-chip, .comm-class-filter-chip').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-filter') === 'all');
            });
            document.querySelectorAll('.comm-scrape-filter-chip').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-scrape-filter') === 'all');
            });

            processData();

            // No posts locally? processData() has just rendered the reach panel empty.
            // Fall back to the persisted snapshot so Potential Impressions still loads
            // after a refresh. MUST run after processData() so it isn't clobbered.
            if (allPosts.length === 0) {
                await hydrateReachFromSnapshot();
            }
        } catch (err) {
            console.error('[Options] loadLocalData error:', err);
        }
        showLoading(false);
    }

    /**
     * Update empty state message to provide contextual guidance.
     * Shows unassigned count badge when in project context.
     */
    async function _updateEmptyStateMessage(activeProjectId, currentCount) {
        const emptyH3 = emptyState?.querySelector('h3');
        const emptyP = emptyState?.querySelector('p');
        const commEmptyH3 = commEmptyState?.querySelector('h3');
        const commEmptyP = commEmptyState?.querySelector('p');

        if (currentCount > 0) return; // Only update if actually empty

        if (activeProjectId) {
            // Project selected but empty — guide user to assign
            let unassignedCount = 0;
            try {
                const unassigned = await PostsStore.getUnassignedPosts();
                unassignedCount = unassigned.length;
            } catch (e) { /* ignore */ }

            const badgeText = unassignedCount > 0
                ? `You have ${unassignedCount} unassigned post${unassignedCount !== 1 ? 's' : ''} available to assign.`
                : 'Capture data while browsing Instagram first, then assign to this project.';

            if (emptyH3) emptyH3.textContent = 'This project has no posts yet';
            if (emptyP) emptyP.innerHTML = `Assign posts from "Unassigned" to get started.<br><small style="color:var(--text-muted);margin-top:6px;display:inline-block">${badgeText}</small>`;
            if (commEmptyH3) commEmptyH3.textContent = 'This project has no posts yet';
            if (commEmptyP) commEmptyP.innerHTML = `Assign posts from "Unassigned" to get started.<br><small style="color:var(--text-muted);margin-top:6px;display:inline-block">${badgeText}</small>`;
        } else {
            // No project — show default
            if (emptyH3) emptyH3.textContent = 'No captured posts yet';
            if (emptyP) emptyP.textContent = 'Start browsing Instagram with capture enabled, or import a JSON file.';
            if (commEmptyH3) commEmptyH3.textContent = 'No captured posts yet';
            if (commEmptyP) commEmptyP.textContent = 'Start browsing Instagram with capture enabled, or import a JSON file.';
        }
    }

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        showLoading(true);
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                // Handle different formats
                if (Array.isArray(data)) {
                    allPosts = data;
                } else if (data.posts && Array.isArray(data.posts)) {
                    allPosts = data.posts;
                } else if (data.data) {
                    allPosts = extractPostsFromJsonExport(data);
                } else {
                    // Try treating it as a map
                    allPosts = Object.values(data).filter(p => p.shortcode || p.id);
                }
                // Extract global profiles dataset if part of the export
                if (data.scrapedProfiles && Array.isArray(data.scrapedProfiles)) {
                    globalProfilesDataset = data.scrapedProfiles;
                    chrome.storage.local.set({ profiles_dataset: globalProfilesDataset });
                }

                if (allPosts.length === 0) {
                    showToast('Could not find posts in this JSON file.', 'error');
                } else {
                    // Normalise data
                    allPosts = allPosts.map(normalizePostData);
                    // Save imported data to chrome.storage.local
                    saveImportedData(allPosts);
                    
                    // Reset filters to prevent sticky selections across different uploads
                    activeProfileFilter = null;
                    activeClassFilter = 'all';
                    activeScrapeFilter = 'all';
                    
                    document.querySelectorAll('.class-filter-chip, .comm-class-filter-chip').forEach(c => {
                        c.classList.toggle('active', c.getAttribute('data-filter') === 'all');
                    });
                    document.querySelectorAll('.comm-scrape-filter-chip').forEach(c => {
                        c.classList.toggle('active', c.getAttribute('data-scrape-filter') === 'all');
                    });
                    
                    processData();
                }
            } catch (err) {
                showToast('Error parsing JSON: ' + err.message, 'error');
            }
            showLoading(false);
            // Reset input
            event.target.value = '';
        };
        reader.readAsText(file);
    }

    // Sometimes JSON dumps have deeply nested structures; 
    // attempt a loose extraction if we don't recognize it
    function extractPostsFromJsonExport(obj) {
        let found = [];
        const search = (node) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
                node.forEach(search);
                return;
            }
            // Check if looks like a post
            if (node.pk || node.shortcode || node.code) {
                if (node.media_type || node.caption || node.like_count !== undefined) {
                    found.push(node);
                    return; // Don't search deeper in this node
                }
            }
            Object.values(node).forEach(search);
        };
        search(obj);
        return found;
    }

    // Derive the card border CSS class (collab/paid outline) from a post's
    // type/classification/flags. Backend posts carry `classification` + `type`
    // but NOT `border` (a frontend-only CSS concept), so posts loaded from the DB
    // would otherwise render with no collab/paid outline. Keyed off `type` first so
    // the outline stays consistent with the badge (which also reads `type`).
    function borderFromClassification(post) {
        const type = post.type || '';
        const cls = post.classification || '';
        const hasCo = ((post.coauthors && post.coauthors.length) ||
                       (post.coauthor_producers && post.coauthor_producers.length) || 0) > 0;
        const paid = post.isPaid || post.is_paid || post.is_paid_partnership || false;
        if (type === 'paid_collab' || cls === 'Paid Partnership Collab' || (hasCo && paid)) return 'pf-super-collab-card';
        if (type === 'paid'        || cls === 'Paid Partnership'        || paid)          return 'pf-paid-card';
        if (type === 'collab'      || cls === 'Collaboration'           || hasCo)         return 'pf-collab-card';
        return 'pf-normal-card';
    }

    // Normalize imported data to our expected schema
    // Supports: new background.js schema, sample JSON export format, raw IG nodes
    function normalizePostData(post) {
        // Already in the new rich schema — but ensure coauthor aliases are populated
        if (post.shortcode && post.likes !== undefined && post.classification) {
            // Ensure coauthor_producers alias exists (partnership breakdown needs it)
            if (!post.coauthor_producers && post.coauthors) {
                post.coauthor_producers = post.coauthors;
            }
            if (!post.sponsor_tags && post.sponsors) {
                post.sponsor_tags = post.sponsors;
            }
            // Backend posts lack the `border` CSS class — derive it so collab/paid
            // cards keep their golden/orange outline in the grid.
            if (!post.border) {
                post.border = borderFromClassification(post);
            }
            return post;
        }

        const shortcode = post.code || post.shortcode || null;
        const ownerUsername = post.user?.username || post.owner?.username || post.ownerUsername || post.caption_user?.username || null;

        // Determine classification
        const coauthors = post.coauthors || (post.coauthor_producers || []);
        const hasCoauthors = coauthors.length > 0;
        const isPaid = post.isPaid || post.is_paid_partnership || post.isPaidPartnership || false;
        const captionText = (typeof post.caption === 'string' ? post.caption : post.caption?.text) || '';

        let classification = post.classification || 'Normal Post';
        let type = post.type || 'normal';
        let border = post.border || 'pf-normal-card';

        if (!post.classification) {
            if (hasCoauthors && isPaid) {
                classification = 'Paid Partnership Collab'; type = 'paid_collab'; border = 'pf-super-collab-card';
            } else if (isPaid || /#(ad|sponsored|partnership)\b/i.test(captionText)) {
                classification = 'Paid Partnership'; type = 'paid'; border = 'pf-paid-card';
            } else if (hasCoauthors) {
                classification = 'Collaboration'; type = 'collab'; border = 'pf-collab-card';
            }
        }

        return {
            shortcode,
            postUrl: post.postUrl || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : null),
            id: post.id || post.pk || null,
            timestamp: post.taken_at || post.taken_at_timestamp || post.timestamp || null,
            likes: post.likes ?? post.like_count ?? post.edge_media_preview_like?.count ?? post.likesCount ?? 0,
            comments: post.comments ?? post.comment_count ?? post.edge_media_to_comment?.count ?? post.commentsCount ?? 0,
            caption: captionText,
            imageUrl: post.imageUrl || post.image_versions2?.candidates?.[0]?.url || post.display_url || post.thumbnail_src || post.thumbnailUrl || null,
            videoUrl: post.videoUrl || post.video_versions?.[0]?.url || null,
            isVideo: post.isVideo || post.is_video || (post.media_type === 2) || false,
            isCarousel: post.isCarousel || (post.carousel_media_count || 0) > 0 || post.media_type === 8 || false,
            productType: post.productType || post.product_type || post.__typename || post.mediaType || 'unknown',
            videoViewCount: post.videoViewCount || post.video_view_count || 0,
            videoDuration: post.videoDuration || post.video_duration || null,
            isPaid,
            type,
            hasCoauthors,
            classification,
            border,
            coauthors: coauthors.map(c => typeof c === 'string' ? { username: c } : c),
            sponsors: post.sponsors || [],
            sponsor_tags: post.sponsor_tags || [],
            tagged_users: post.tagged_users || [],
            caption_user: post.caption_user || null,
            owner: post.owner || (ownerUsername ? { username: ownerUsername } : null),
            collectiveReach: post.collectiveReach || 0,
            reachBreakdown: post.reachBreakdown || [],
            scrapedFromProfile: post.scrapedFromProfile || post.scraped_from_profile || null,
            is_reference: post.is_reference || post.isReference || false,
        };
    }

    // --- Processing & Rendering ---

    // When no posts are loaded, render the reach panel from the saved snapshot so it
    // survives refresh. Reconstructs currentPartnersList from the aggregate, then
    // reuses the normal render path.
    async function hydrateReachFromSnapshot() {
        if (typeof ReachStore === 'undefined') return false;
        const aggregate = await ReachStore.getAggregate(reachScopeKey());
        if (!aggregate) return false;

        const { partnersList, stats } = ReachStore.toPartnersList(aggregate);
        if (!partnersList.length) return false;

        currentPartnersList = partnersList;   // module-level, consumed by renderCollectiveReachDOM
        renderCollectiveReachDOM(stats, '');
        renderCollectiveReachDOM(stats, 'comm-');
        syncAllRowStyles();
        updateGlobalReachTotals();
        return true;
    }

    // Scope key for the reach snapshot: active project, else 'unassigned'
    // (mirrors the buckets the viewer uses for posts).
    function reachScopeKey() {
        return (typeof projCurrentProjectId !== 'undefined' && projCurrentProjectId)
            ? String(projCurrentProjectId)
            : 'unassigned';
    }

    function processData() {
        // Build profile filter chips
        buildProfileFilter();

        applyFiltersAndSort();
    }

    function buildProfileFilter() {
        if (!profileFilterBar) return;

        // Attribute by relationship (owner OR coauthor), not by capture session.
        // Counts come from the same helper the filter uses, so a badge can never
        // disagree with its own result set.
        const roster = PostIndex.buildProfileRoster(allPosts);
        const profileMap = PostIndex.countByProfile(allPosts, roster);

        const profiles = Object.entries(profileMap).sort((a, b) => b[1] - a[1]);

        const commProfileFilterBar = document.getElementById('comm-profile-filter-bar');

        if (profiles.length <= 1) {
            profileFilterBar.style.display = 'none';
            if (commProfileFilterBar) commProfileFilterBar.style.display = 'none';
            return;
        }

        profileFilterBar.style.display = 'flex';
        profileFilterBar.querySelectorAll('.profile-chip').forEach(c => c.remove());

        if (commProfileFilterBar) {
            commProfileFilterBar.style.display = 'flex';
            commProfileFilterBar.querySelectorAll('.profile-chip').forEach(c => c.remove());
        }

        // "All" chip
        const allChip = document.createElement('button');
        allChip.className = 'profile-chip' + (activeProfileFilter === null ? ' active' : '');
        allChip.dataset.profile = '';
        allChip.innerHTML = `All <span class="chip-count">${allPosts.length}</span>`;
        allChip.addEventListener('click', () => {
            activeProfileFilter = null;
            updateChipActiveState();
            applyFiltersAndSort();
        });
        profileFilterBar.appendChild(allChip);

        if (commProfileFilterBar) {
            const commAllChip = allChip.cloneNode(true);
            commAllChip.addEventListener('click', () => {
                activeProfileFilter = null;
                updateChipActiveState();
                applyFiltersAndSort();
            });
            commProfileFilterBar.appendChild(commAllChip);
        }

        profiles.forEach(([username, count]) => {
            const chip = document.createElement('button');
            chip.className = 'profile-chip' + (activeProfileFilter === username ? ' active' : '');
            chip.dataset.profile = username;
            chip.innerHTML = `@${escapeHtml(username)} <span class="chip-count">${count}</span>`;
            chip.addEventListener('click', () => {
                activeProfileFilter = username;
                updateChipActiveState();
                applyFiltersAndSort();
            });
            profileFilterBar.appendChild(chip);

            if (commProfileFilterBar) {
                const commChip = chip.cloneNode(true);
                commChip.addEventListener('click', () => {
                    activeProfileFilter = username;
                    updateChipActiveState();
                    applyFiltersAndSort();
                });
                commProfileFilterBar.appendChild(commChip);
            }
        });
    }

    function updateChipActiveState() {
        [profileFilterBar, document.getElementById('comm-profile-filter-bar')].forEach(bar => {
            if (!bar) return;
            bar.querySelectorAll('.profile-chip').forEach(chip => {
                chip.classList.remove('active');
            });
            const chips = bar.querySelectorAll('.profile-chip');
            if (activeProfileFilter === null) {
                if (chips[0]) chips[0].classList.add('active');
            } else {
                chips.forEach(chip => {
                    if (chip.dataset.profile === activeProfileFilter) {
                        chip.classList.add('active');
                    }
                });
            }
        });
    }

    function applyFiltersAndSort() {
        // Determine active tab to read the correct inputs
        const isCommTabActive = document.getElementById('tab-commentator')?.classList.contains('active');
        
        const queryInput = isCommTabActive ? document.getElementById('comm-search-input') : searchInput;
        const query = queryInput ? queryInput.value.toLowerCase().trim() : '';

        const scopeEl = isCommTabActive
            ? document.getElementById('comm-search-scope')
            : document.getElementById('search-scope');
        const searchScope = scopeEl ? scopeEl.value : 'all';

        const sortSelectEl = isCommTabActive ? document.getElementById('comm-sort-select') : sortSelect;
        const sortMode = sortSelectEl ? sortSelectEl.value : 'recent';

        const dateFromEl = isCommTabActive ? document.getElementById('comm-filter-date-from') : filterDateFrom;
        const dateToEl = isCommTabActive ? document.getElementById('comm-filter-date-to') : filterDateTo;

        // If scrape filter is active, fetch fresh counts then re-run with populated cache
        if (activeScrapeFilter !== 'all') {
            const allShortcodes = allPosts.map(p => p.shortcode).filter(Boolean);
            if (allShortcodes.length > 0) {
                chrome.runtime.sendMessage({ type: 'CHECK_SCRAPED_POSTS', shortcodes: allShortcodes }, (res) => {
                    if (chrome.runtime.lastError) return;
                    _scrapedCountsCache = (res && res.success) ? res.counts : {};
                    _applyFiltersSync(query, sortMode, dateFromEl, dateToEl, searchScope);
                });
                return; // will re-render after async fetch completes
            }
        }

        _applyFiltersSync(query, sortMode, dateFromEl, dateToEl, searchScope);
    }

    function _applyFiltersSync(query, sortMode, dateFromEl, dateToEl, searchScope = 'all') {
        // Filter
        filteredPosts = allPosts.filter(p => {
            // Profile filter (use explicit attribute if available)
            if (activeProfileFilter) {
                if (!PostIndex.postProfiles(p).has(activeProfileFilter)) return false;
            }

            // Reference post filter
            if (toggleCollabPosts && !toggleCollabPosts.checked) {
                if (p.is_reference) return false;
            }

            // Classification filter
            if (activeClassFilter !== 'all') {
                if (activeClassFilter === 'collab' && p.type !== 'collab' && p.type !== 'paid_collab') return false;
                if (activeClassFilter === 'paid' && p.type !== 'paid' && p.type !== 'paid_collab') return false;
                if (activeClassFilter === 'verified') {
                    const isVerified = p.owner?.is_verified || p.caption_user?.is_verified || false;
                    if (!isVerified) return false;
                }
            }

            // Scrape status filter (Commentator tab only)
            if (activeScrapeFilter !== 'all') {
                const scraped = _scrapedCountsCache[p.shortcode] || 0;
                const total = parseInt(p.comments) || 0;
                const isSentinel = scraped > 0 && total === 0; // zero-comment post auto-marked
                const isFullyScraped = scraped > 0 && (isSentinel || scraped >= total);
                const isPartial = scraped > 0 && !isFullyScraped;

                if (activeScrapeFilter === 'scraped'   && !isFullyScraped) return false;
                if (activeScrapeFilter === 'partial'   && !isPartial)      return false;
                if (activeScrapeFilter === 'unscraped' && scraped > 0)     return false;
            }

            // Date range filter
            if (dateFromEl && dateFromEl.value) {
                const fromTs = new Date(dateFromEl.value).getTime() / 1000;
                const postTs = p.timestamp > 10000000000 ? p.timestamp / 1000 : p.timestamp;
                if (postTs < fromTs) return false;
            }
            if (dateToEl && dateToEl.value) {
                const toTs = new Date(dateToEl.value + 'T23:59:59').getTime() / 1000;
                const postTs = p.timestamp > 10000000000 ? p.timestamp / 1000 : p.timestamp;
                if (postTs > toTs) return false;
            }

            // Text search filter — matches owner, coauthors, tagged users,
            // caption hashtags and caption text (see utils/post_index.js).
            return PostIndex.matchesQuery(p, query, searchScope);
        });
        // Update stats bar to reflect filtered stats ALWAYS
        const fPosts = filteredPosts.length;
        const fLikes = filteredPosts.reduce((sum, p) => sum + (parseInt(p.likes) || 0), 0);
        const fComments = filteredPosts.reduce((sum, p) => sum + (parseInt(p.comments) || 0), 0);
        const fEngagement = fLikes + fComments;
        const avgLikes = fPosts > 0 ? Math.round(fLikes / fPosts) : 0;
        const avgComments = fPosts > 0 ? Math.round(fComments / fPosts) : 0;

        // Idempotent: called on every render to refresh the value, but the click
        // listener is wired only once (guarded) to avoid stacking handlers. The raw
        // avg + the decimal mode live on the element's dataset so both re-renders and
        // the click handler read live state.
        function setupEpmToggle(cardId, valueId) {
            const card = document.getElementById(cardId);
            const valueEl = document.getElementById(valueId);
            if (!valueEl) return;

            // Refresh the raw value for this render.
            const avgEpm = fPosts ? (fEngagement / fPosts) : 0;
            valueEl.dataset.epm = String(avgEpm);

            const render = () => {
                const v = Number(valueEl.dataset.epm) || 0;
                valueEl.textContent = valueEl.dataset.epmDecimal === '1'
                    ? v.toLocaleString(undefined, { maximumFractionDigits: 3 })
                    : Math.round(v).toLocaleString();
            };
            render();

            // Wire once: toggle decimal precision AND copy the precise value on click.
            if (card && card.dataset.epmWired !== '1') {
                card.dataset.epmWired = '1';
                card.style.cursor = 'pointer';
                card.addEventListener("click", () => {
                    valueEl.dataset.epmDecimal = valueEl.dataset.epmDecimal === '1' ? '0' : '1';
                    render();
                    const v = Number(valueEl.dataset.epm) || 0;
                    copyToClipboard(String(v), v.toLocaleString(undefined, { maximumFractionDigits: 3 }));
                });
            }
        }
        setStatValue('stat-total-posts', fPosts);
        setStatValue('stat-total-likes', fLikes);
        setStatValue('stat-total-comments', fComments);
        if (statTotalEngagement) setStatValue('stat-total-engagement', fEngagement);
        if (statAvgLikes) setStatValue('stat-avg-likes', avgLikes);
        if (statAvgComments) setStatValue('stat-avg-comments', avgComments);
        // if (statAvgEpm) {
        //   const avgEpm = fPosts ? (fEngagement / fPosts) : 0;
        //   statAvgEpm.textContent = Math.round(avgEpm).toLocaleString();
        // }
        if (commStatPosts) setStatValue('comm-stat-posts', fPosts);
        if (commStatLikes) setStatValue('comm-stat-likes', fLikes);
        if (commStatComments) setStatValue('comm-stat-comments', fComments);
        if (commStatEngagement) setStatValue('comm-stat-engagement', fEngagement);
        if (commStatAvgLikes) setStatValue('comm-stat-avg-likes', avgLikes);
        if (commStatAvgComments) setStatValue('comm-stat-avg-comments', avgComments);
        //         if (commStatAvgEpm) {
        //   const avgEpm = fPosts ? (fEngagement / fPosts) : 0;
        //   commStatAvgEpm.textContent = Math.round(avgEpm).toLocaleString();
        // }
        setupEpmToggle("epm-card", "stat-avg-epm");
        setupEpmToggle("comm-epm-card", "comm-stat-avg-epm");
        setupEpmToggle("current-potentialreach-card", "stat-current-potentialreach");
        setupEpmToggle("comm-current-potentialreach", "comm-stat-current-potentialreach");

        // Click any headline stat card to copy its precise value + toggle format.
        [
            'stat-total-posts', 'stat-total-likes', 'stat-total-comments', 'stat-total-engagement',
            'influencer-reach-value',
            'comm-stat-posts', 'comm-stat-likes', 'comm-stat-comments', 'comm-stat-engagement',
            'comm-influencer-reach-value',
        ].forEach(setupStatCopyToggle);
        // Update scraped comments count
        if (commStatScraped) {
            const shortcodes = filteredPosts.map(p => p.shortcode).filter(Boolean);
            if (shortcodes.length > 0) {
                chrome.runtime.sendMessage({ type: 'CHECK_SCRAPED_POSTS', shortcodes }, (res) => {
                    const counts = (res && res.success) ? res.counts : {};
                    const totalScraped = Object.values(counts).reduce((sum, count) => sum + count, 0);
                    setStatValue('comm-stat-scraped', totalScraped);
                });
            } else {
                commStatScraped.textContent = '0';
            }
        }

        // Sort
        filteredPosts.sort((a, b) => {
            if (sortMode === 'recent') {
                return (b.timestamp || 0) - (a.timestamp || 0);
            } else if (sortMode === 'oldest') {
                return (a.timestamp || 0) - (b.timestamp || 0);
            } else if (sortMode === 'likes') {
                return (b.likes || 0) - (a.likes || 0);
            } else if (sortMode === 'comments') {
                return (b.comments || 0) - (a.comments || 0);
            } else if (sortMode === 'engagement') {
                const aEng = (parseInt(a.likes) || 0) + (parseInt(a.comments) || 0);
                const bEng = (parseInt(b.likes) || 0) + (parseInt(b.comments) || 0);
                return bEng - aEng;
            }
            return 0;
        });

        const reachStats = calculateCollectiveReach(filteredPosts);
        renderCollectiveReachDOM(reachStats, '');
        renderCollectiveReachDOM(reachStats, 'comm-');
        syncAllRowStyles();
        updateGlobalReachTotals();

        // Persist the computed aggregate so the panel survives refresh without posts.
        // Only overwrite when there is something to store (avoids clobbering a good
        // snapshot with an empty compute during transient empty states).
        if (typeof ReachStore !== 'undefined' && currentPartnersList.length > 0) {
            // filteredPosts[0].scrapedFromProfile is arbitrary now that a bucket can
            // hold posts captured under a different profile. Prefer the active chip.
            const mainUsername = activeProfileFilter
                || (filteredPosts[0] && PostIndex.getOwner(filteredPosts[0]))
                || null;
            const aggregate = ReachStore.buildAggregate(currentPartnersList, mainUsername, {
                projectId: (typeof projCurrentProjectId !== 'undefined' ? projCurrentProjectId : null) || null,
                collabCount: reachStats.collabCount,
                paidCount: reachStats.paidCount,
            });
            ReachStore.saveAggregate(reachScopeKey(), aggregate); // fire-and-forget
        }

        // Update the dynamic influencer reach cards based on campaign profile filter
        [ '', 'comm-' ].forEach(prefix => {
            const reachCard = document.getElementById(`${prefix}influencer-reach-card`);
            const reachUser = document.getElementById(`${prefix}influencer-reach-username`);
            
            // Sync both card values if available
            const valueElements = [
                document.getElementById(`${prefix}influencer-reach-value`),
                document.getElementById(`${prefix}stat-current-potentialreach-value`)
            ].filter(el => el !== null);
            
            if (activeProfileFilter && reachCard && reachUser && valueElements.length > 0) {
                // Show reach for the selected campaign profile
                const profileReach = currentPartnersList.find(p => p.username === activeProfileFilter);
                if (profileReach) {
                    reachCard.style.display = 'flex';
                    reachUser.textContent = `@${activeProfileFilter}`;
                    const reach = (profileReach.followers || 0) * (profileReach.postCount || 1);
                    valueElements.forEach(el => setStatValue(el, reach));
                }
            } else if (!activeProfileFilter && valueElements.length > 0) {
                // "All" is selected — show grand total of all campaign profiles
                const grandTotal = currentPartnersList.reduce((sum, inf) => sum + ((inf.followers || 0) * (inf.postCount || 1) * (inf.is_excluded_manually ? 0 : 1)), 0);
                if (reachCard) reachCard.style.display = 'flex';
                if (reachUser) reachUser.textContent = 'All Profiles';
                valueElements.forEach(el => setStatValue(el, grandTotal));
            }
        });

        currentPage = 1;
        renderPage();
    }

    function renderPage() {
        postsGrid.innerHTML = '';
        if (commPostsGrid) commPostsGrid.innerHTML = '';

        if (filteredPosts.length === 0) {
            emptyState.style.display = 'block';
            paginationControls.style.display = 'none';
            if (commEmptyState) commEmptyState.style.display = 'block';
            if (commPaginationControls) commPaginationControls.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        if (commEmptyState) commEmptyState.style.display = 'none';

        const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
        const endIndex = Math.min(startIndex + POSTS_PER_PAGE, filteredPosts.length);
        const pagePosts = filteredPosts.slice(startIndex, endIndex);

        // Render cards SYNCHRONOUSLY first (no dependency on background script)
        pagePosts.forEach(post => {
            const card = document.createElement('div');
            card.className = `post-card ${post.border || ''}`;
            card.onclick = () => openModal(post);

            // Format date
            let dateStr = 'Unknown Date';
            if (post.timestamp) {
                const d = new Date(post.timestamp * (post.timestamp > 10000000000 ? 1 : 1000));
                dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            }

            // Media type badge
            let typeStr = 'PHOTO';
            if (post.isVideo) typeStr = 'VIDEO';
            else if (post.isCarousel) typeStr = 'CAROUSEL';

            const imgUrl = post.imageUrl || 'icons/placeholder.png';
            const ownerName = post.owner?.username || post.caption_user?.username || 'unknown';

            // Build collaborator label for post header
            const coauthorsForCard = post.coauthors || post.coauthor_producers || [];
            const coauthorLabel = coauthorsForCard.length > 0
                ? ', ' + coauthorsForCard.map(c => '@' + escapeHtml(c.username || c)).join(', ')
                : '';

            // Classification badges
            let classificationBadge = '';
            if (post.type === 'paid_collab') {
                classificationBadge = '<span class="badge badge-paid">💰 PAID</span><span class="badge badge-collab">🤝 COLLAB</span>';
            } else if (post.type === 'paid') {
                classificationBadge = '<span class="badge badge-paid">💰 PAID PARTNERSHIP</span>';
            } else if (post.type === 'collab') {
                classificationBadge = '<span class="badge badge-collab">🤝 COLLAB</span>';
            }

            card.innerHTML = `
                <div class="post-img-wrapper">
                    <img src="${imgUrl}" alt="Post thumbnail" class="post-img" loading="lazy">
                    <span class="badge">${typeStr}</span>
                    ${classificationBadge}
                </div>
                <div class="post-content">
                    <div class="post-header">
                        <span class="post-username">@${escapeHtml(ownerName)}${coauthorLabel}</span>
                        <span>${dateStr}</span>
                    </div>
                    <div class="post-footer">
                        <div class="metric">❤️ <span class="stat-value" data-value="${post.likes || 0}">${formatStatNumber(post.likes || 0)}</span></div>
                        <div class="metric">💬 <span class="stat-value" data-value="${post.comments || 0}">${formatStatNumber(post.comments || 0)}</span></div>
                        <div class="metric">📊 <span class="stat-value" data-value="${(post.likes || 0) + (post.comments || 0)}">${formatStatNumber((post.likes || 0) + (post.comments || 0))}</span></div>
                        </div>
                        </div>
                        `;
                        // ${post.collectiveReach ? `<div class="metric" title="Reach">📊 <span class="stat-value" data-value="${post.collectiveReach}">${formatStatNumber(post.collectiveReach)}</span></div>` : ''}
            card.setAttribute('data-shortcode', post.shortcode || '');
            postsGrid.appendChild(card);

            if (commPostsGrid) {
                const commCard = card.cloneNode(true);
                commCard.onclick = () => openModal(post);
                commPostsGrid.appendChild(commCard);
            }
        });

        // Asynchronously fetch scraped comment counts and overlay them on existing cards
        const shortcodes = pagePosts.map(p => p.shortcode).filter(Boolean);
        if (shortcodes.length > 0) {
            chrome.runtime.sendMessage({ type: 'CHECK_SCRAPED_POSTS', shortcodes }, (res) => {
                if (chrome.runtime.lastError) return; // Gracefully handle disconnected background
                const counts = (res && res.success) ? res.counts : {};
                // Add scraped indicators to already-rendered cards
                [postsGrid, commPostsGrid].forEach(grid => {
                    if (!grid) return;
                    grid.querySelectorAll('.post-card').forEach(card => {
                        const sc = card.getAttribute('data-shortcode');
                        const scraped = counts[sc] || 0;
                        if (scraped <= 0) return;

                        // Find the post to get its total comment count
                        const post = pagePosts.find(p => p.shortcode === sc);
                        const total = parseInt(post?.comments) || 0;
                        const isSentinel = total === 0; // zero-comment auto-marked
                        const isFullyScraped = isSentinel || scraped >= total;

                        // Apply scrape status border class
                        card.classList.remove('scrape-full', 'scrape-partial');
                        card.classList.add(isFullyScraped ? 'scrape-full' : 'scrape-partial');

                        const footer = card.querySelector('.post-footer');
                        if (!footer) return;

                        const indicator = document.createElement('div');
                        indicator.className = 'metric scraped-status-indicator';

                        if (isFullyScraped) {
                            indicator.textContent = `✅ Scraped (${scraped})`;
                            indicator.style.color = '#10b981';
                        } else {
                            indicator.textContent = `⚡ Partial (${scraped}/${total})`;
                            indicator.style.color = '#f59e0b';
                        }
                        footer.appendChild(indicator);
                    });
                });
            });
        }

        // Update pagination
        const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE);
        if (totalPages > 1) {
            paginationControls.style.display = 'flex';
            pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
            btnPrevPage.disabled = currentPage === 1;
            btnNextPage.disabled = currentPage === totalPages;

            if (commPaginationControls) {
                commPaginationControls.style.display = 'flex';
                if (commPageIndicator) commPageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
                if (commBtnPrevPage) commBtnPrevPage.disabled = currentPage === 1;
                if (commBtnNextPage) commBtnNextPage.disabled = currentPage === totalPages;
            }
        } else {
            paginationControls.style.display = 'none';
            if (commPaginationControls) commPaginationControls.style.display = 'none';
        }
    }

    // --- Modal ---
    function openModal(post) {
        let dateStr = 'Unknown Date';
        if (post.timestamp) {
            const d = new Date(post.timestamp * (post.timestamp > 10000000000 ? 1 : 1000));
            dateStr = d.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
        }

        const imgUrl = post.imageUrl || 'icons/icon128.png';
        const postLink = post.postUrl || (post.shortcode ? `https://www.instagram.com/p/${post.shortcode}/` : '#');
        const ownerName = post.owner?.username || post.caption_user?.username || 'unknown';

        // Classification badge in modal
        let classLabel = '';
        if (post.type === 'paid_collab') {
            classLabel = '<span class="modal-badge modal-badge-paid">💰 PAID PARTNERSHIP</span><span class="modal-badge modal-badge-collab">🤝 COLLAB</span>';
        } else if (post.type === 'paid') {
            classLabel = '<span class="modal-badge modal-badge-paid">💰 PAID PARTNERSHIP</span>';
        } else if (post.type === 'collab') {
            classLabel = '<span class="modal-badge modal-badge-collab">🤝 COLLABORATION</span>';
        }

        // Coauthors list
        let coauthorsHtml = '';
        if (post.coauthors && post.coauthors.length > 0) {
            coauthorsHtml = `<p><strong>Co-authors:</strong> ${post.coauthors.map(c => '@' + escapeHtml(c.username || c)).join(', ')}</p>`;
        }

        // Sponsors list
        let sponsorsHtml = '';
        if (post.sponsors && post.sponsors.length > 0) {
            sponsorsHtml = `<p><strong>Sponsors:</strong> ${post.sponsors.map(s => '@' + escapeHtml(s.username || s)).join(', ')}</p>`;
        }

        // Tagged users
        let taggedHtml = '';
        if (post.tagged_users && post.tagged_users.length > 0) {
            taggedHtml = `<p><strong>Tagged:</strong> ${post.tagged_users.map(t => '@' + escapeHtml(t.username || t)).join(', ')}</p>`;
        }

        // Reach
        let reachHtml = '';
        if (post.collectiveReach) {
            reachHtml = `<p><strong>🌟Potential Impressions:</strong> <span class="stat-value" data-value="${post.collectiveReach}">${formatStatNumber(post.collectiveReach)}</span></p>`;
            if (post.reachBreakdown && post.reachBreakdown.length > 0) {
                reachHtml += `<p class="reach-breakdown">${post.reachBreakdown.join(' · ')}</p>`;
            }
        }

        modalDetails.innerHTML = `
            <div class="modal-img-container">
                <img src="${imgUrl}" class="modal-img" alt="Post media">
            </div>
            <div class="modal-info-container">
                <div class="modal-info-header">
                    <div class="modal-username">@${escapeHtml(ownerName)}</div>
                    ${classLabel}
                </div>
                
                <div class="modal-stats">
                    <div class="modal-stat-box">
                        <div class="val"><span class="stat-value" data-value="${post.likes || 0}">${formatStatNumber(post.likes || 0)}</span></div>
                        <div class="lbl">Likes</div>
                    </div>
                    <div class="modal-stat-box">
                        <div class="val"><span class="stat-value" data-value="${post.comments || 0}">${formatStatNumber(post.comments || 0)}</span></div>
                        <div class="lbl">Comments</div>
                    </div>
                    <div class="modal-stat-box">
                        <div class="val"><span class="stat-value" data-value="${(post.likes || 0) + (post.comments || 0)}">${formatStatNumber((post.likes || 0) + (post.comments || 0))}</span></div>
                        <div class="lbl">Total Post Engagement</div>
                    </div>
                    ${post.videoViewCount ? `
                    <div class="modal-stat-box" style="grid-column: span 2;">
                        <div class="val"><span class="stat-value" data-value="${post.videoViewCount}">${formatStatNumber(post.videoViewCount)}</span></div>
                        <div class="lbl">Views</div>
                    </div>` : ''}
                </div>
                
                <div class="modal-caption">${escapeHtml(post.caption || 'No caption')}</div>
                
                <div class="modal-meta">
                    <p><strong>Shortcode:</strong> <a href="${postLink}" target="_blank">${post.shortcode || 'N/A'} ↗</a></p>
                    <p><strong>Posted:</strong> ${dateStr}</p>
                    <p><strong>Type:</strong> ${post.classification || 'Normal Post'}</p>
                    <p><strong>ID:</strong> ${post.id || 'N/A'}</p>
                    ${coauthorsHtml}
                    ${sponsorsHtml}
                    ${taggedHtml}
                    ${reachHtml}
                </div>
                <div class="modal-actions" id="modal-actions-container" style="margin-top: 20px; display: flex; gap: 10px;">
                    <button class="btn btn-warning" style="flex: 1;" disabled>⏳ Checking Status...</button>
                    <a href="${postLink}" target="_blank" class="btn btn-secondary" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center;">IG ↗</a>
                </div>

                <div id="modal-comments-viewer" class="modal-comments-viewer" style="display: none; margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h4 style="margin: 0;">💬 Scraped Comments</h4>
                        <button id="btn-export-single-xlsx" class="btn btn-success btn-sm">Export Enriched XLSX</button>
                    </div>
                    <div id="comments-list" class="comments-list" style="max-height: 300px; overflow-y: auto;">
                        <!-- Comments injected here -->
                    </div>
                </div>
            </div>
        `;

        modal.style.display = 'block';

        // Check if we already have comments for this post
        chrome.runtime.sendMessage({ type: 'CHECK_SCRAPED_POSTS', shortcodes: [post.shortcode] }, (res) => {
            const scrapedCount = (res && res.success && res.counts) ? (res.counts[post.shortcode] || 0) : 0;
            const totalComments = parseInt(post.comments) || 0;
            const isSentinel = scrapedCount > 0 && totalComments === 0;
            const isFullyScraped = scrapedCount > 0 && (isSentinel || scrapedCount >= totalComments);
            const isPartial = scrapedCount > 0 && !isFullyScraped;
            const actionContainer = document.getElementById('modal-actions-container');
            if (!actionContainer) return;

            if (scrapedCount > 0) {
                // Build the right secondary action button
                let scrapeBtn;
                if (isPartial) {
                    scrapeBtn = `<button id="btn-modal-scrape-comments" class="btn btn-warning" style="flex: 1;">⚡ Continue (${scrapedCount}/${totalComments})</button>`;
                } else {
                    scrapeBtn = `<button id="btn-modal-scrape-comments" class="btn btn-secondary" style="flex: 1;">🔄 Re-Scrape</button>`;
                }

                actionContainer.innerHTML = `
                    <button id="btn-modal-view-comments" class="btn btn-success" style="flex: 1;">👁️ View ${scrapedCount} Comments</button>
                    ${scrapeBtn}
                    <a href="${postLink}" target="_blank" class="btn btn-secondary" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center;">IG ↗</a>
                `;

                document.getElementById('btn-modal-view-comments').onclick = () => {
                    const viewer = document.getElementById('modal-comments-viewer');
                    const listEl = document.getElementById('comments-list');
                    if (!viewer || !listEl) return;

                    if (viewer.style.display === 'block') {
                        viewer.style.display = 'none';
                        return;
                    }

                    showToast('Loading comments...', 'info');
                    chrome.runtime.sendMessage({ type: 'GET_COMMENTS_FOR_POSTS', shortcodes: [post.shortcode] }, (response) => {
                        if (!response || !response.success || response.comments.length === 0) {
                            showToast('No comments found.', 'warning');
                            return;
                        }

                        viewer.style.display = 'block';
                        listEl.innerHTML = response.comments.map(c => `
                            <div class="comment-item" style="padding: 10px 0; border-bottom: 1px solid var(--bg-hover);">
                                <div style="display: flex; justify-content: space-between; font-size: 0.85em; margin-bottom: 4px;">
                                    <strong>@${escapeHtml(c.username)}</strong>
                                    <span style="color: var(--text-muted);">${new Date(c.created_at * (c.created_at > 10000000000 ? 1 : 1000)).toLocaleDateString()}</span>
                                </div>
                                <div class="comment-text" style="font-size: 0.9em;">${escapeHtml(c.text)}</div>
                            </div>
                         `).join('');

                        document.getElementById('btn-export-single-xlsx').onclick = () => {
                            const enriched = enrichComments(response.comments, [post]);
                            downloadAsXLSX(enriched);
                        };
                    });
                };
            } else {
                // No existing comments
                actionContainer.innerHTML = `
                    <button id="btn-modal-scrape-comments" class="btn btn-warning" style="flex: 1;">📝 Scrape Comments</button>
                    <a href="${postLink}" target="_blank" class="btn btn-secondary" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center;">IG ↗</a>
                `;
            }

            // Attach scrape/continue listener
            const modalScrapeBtn = document.getElementById('btn-modal-scrape-comments');
            if (modalScrapeBtn) {
                modalScrapeBtn.onclick = isPartial ? triggerContinue : triggerScrape;
            }
        });

        async function triggerScrape() {
            const modalScrapeBtn = document.getElementById('btn-modal-scrape-comments');
            if (!modalScrapeBtn) return;

            const originalText = modalScrapeBtn.textContent;
            modalScrapeBtn.textContent = 'Scraping...';
            modalScrapeBtn.disabled = true;

            showToast(`Starting comment scrape for ${post.shortcode}...`, 'info');

            try {
                console.log(`[Modal Scraper] Sending StartParsing for ${post.shortcode}...`);
                chrome.runtime.sendMessage({
                    type: "StartParsing",
                    shortcode: post.shortcode,
                    limit: 1000 // Higher limit for single post
                }, (response) => {
                    console.log(`[Modal Scraper] Response for ${post.shortcode}:`, response);
                    modalScrapeBtn.textContent = originalText;
                    modalScrapeBtn.disabled = false;

                    if (response && response.success) {
                        const comments = response.comments || [];
                        showToast(`Scraped ${comments.length} comments!`, 'success');

                        // Automatically close modal or update UI here if desired
                        // For now we just let the user know success
                    } else {
                        showToast(`Error: ${response?.error || 'Unknown error'}`, 'error');
                    }
                });
            } catch (err) {
                modalScrapeBtn.textContent = originalText;
                modalScrapeBtn.disabled = false;
                showToast(`Scrape failed: ${err.message}`, 'error');
            }
        }

        // Continue a partial scrape from the last saved cursor
        async function triggerContinue() {
            const modalScrapeBtn = document.getElementById('btn-modal-scrape-comments');
            if (!modalScrapeBtn) return;

            const originalText = modalScrapeBtn.textContent;
            modalScrapeBtn.textContent = '⏳ Continuing...';
            modalScrapeBtn.disabled = true;

            showToast(`Continuing comment scrape for ${post.shortcode}...`, 'info');

            try {
                chrome.runtime.sendMessage({
                    type: 'RESUME_COMMENTS',
                    shortcode: post.shortcode,
                    limit: 1000,
                }, (response) => {
                    modalScrapeBtn.textContent = originalText;
                    modalScrapeBtn.disabled = false;

                    if (response && response.success) {
                        showToast(`Added ${response.newCount} more comments!`, 'success');
                        // Refresh the button state to reflect new count
                        chrome.runtime.sendMessage({ type: 'CHECK_SCRAPED_POSTS', shortcodes: [post.shortcode] }, (res) => {
                            const newCount = (res && res.success && res.counts) ? (res.counts[post.shortcode] || 0) : 0;
                            const total = parseInt(post.comments) || 0;
                            const nowFull = newCount >= total || total === 0;
                            if (nowFull) {
                                modalScrapeBtn.textContent = '🔄 Re-Scrape';
                                modalScrapeBtn.onclick = triggerScrape;
                            } else {
                                modalScrapeBtn.textContent = `⚡ Continue (${newCount}/${total})`;
                            }
                        });
                    } else {
                        showToast(`Error: ${response?.error || 'Unknown error'}`, 'error');
                    }
                });
            } catch (err) {
                modalScrapeBtn.textContent = originalText;
                modalScrapeBtn.disabled = false;
                showToast(`Continue failed: ${err.message}`, 'error');
            }
        }
    }

    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    // --- Settings Save / Load ---

    function loadSettings() {
        chrome.storage.local.get(['extension_settings'], (result) => {
            const settings = result.extension_settings || {};
            if (settingApiUrl) settingApiUrl.value = settings.apiUrl || CONFIG.DEFAULT_API_URL;
            if (settingApiKey) settingApiKey.value = settings.apiKey || '';
        });
    }

    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', () => {
            const settings = {
                apiUrl: settingApiUrl.value.trim(),
                apiKey: settingApiKey.value.trim(),
                updatedAt: Date.now(),
            };
            chrome.storage.local.set({ extension_settings: settings }, () => {
                if (chrome.runtime.lastError) {
                    showSettingsStatus('✗ Error saving', 'error');
                    showToast('Failed to save settings', 'error');
                } else {
                    showSettingsStatus('✓ Saved', 'success');
                    showToast('Settings saved successfully', 'success');
                }
            });
        });
    }

    function showSettingsStatus(text, type) {
        if (!settingsStatus) return;
        settingsStatus.textContent = text;
        settingsStatus.className = 'status-msg ' + (type === 'success' ? 'status-success' : 'status-error');
        setTimeout(() => {
            settingsStatus.textContent = '';
            settingsStatus.className = 'status-msg';
        }, 3000);
    }

    // --- Import to Storage ---

    async function saveImportedData(newPosts) {
        try {
            const stored = await new Promise(r => chrome.storage.local.get(['extension_settings'], r));
            const settings = stored.extension_settings || {};
            const activeProjectId = projCurrentProjectId || settings.activeProjectId || null;

            // Add posts to PostsStore (deduplication handled internally)
            const result = await PostsStore.addPosts(newPosts);

            if (result.added > 0) {
                // If a project is active, assign the new posts to it
                if (activeProjectId) {
                    const newShortcodes = newPosts
                        .map(p => p.shortcode)
                        .filter(Boolean);
                    await PostsStore.assignToProject(newShortcodes, activeProjectId);

                    showToast(`Imported ${result.added} posts and syncing to Project...`, 'success');
                    // Sync to project in background
                    chrome.runtime.sendMessage({
                        type: 'SYNC_POSTS_TO_BACKEND',
                        posts: newPosts,
                        projectId: activeProjectId
                    }, (response) => {
                        if (response && response.success) {
                            showToast(`Project sync complete!`, 'success');
                        } else {
                            console.warn('[Options] Project sync failed:', response?.error);
                        }
                    });
                } else {
                    showToast(`Imported ${result.added} new posts locally (unassigned)!`, 'success');
                }

                // Legacy posts_dataset dual-write REMOVED — PostsStore is the single source of truth

                // Refresh display
                loadLocalData();
            } else {
                showToast('All posts in this file are already in your dataset.', 'info');
            }
        } catch (err) {
            console.error('[Options] saveImportedData error:', err);
            showToast('Failed to save imported data: ' + err.message, 'error');
        }
    }

    // --- Toast Notification System ---

    function showToast(message, type = 'info', duration = 4000) {
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${message}</span>
        `;

        toastContainer.appendChild(toast);

        // Trigger enter animation
        requestAnimationFrame(() => toast.classList.add('toast-visible'));

        setTimeout(() => {
            toast.classList.remove('toast-visible');
            toast.classList.add('toast-exit');
            toast.addEventListener('transitionend', () => toast.remove());
        }, duration);
    }

    // --- Data Management ---

    document.getElementById('btn-clear-data').addEventListener('click', async () => {
        if (confirm("Are you sure you want to delete all locally captured posts? This cannot be undone.")) {
            try {
                await PostsStore.clearPostsStore();
                if (typeof ReachStore !== 'undefined') await ReachStore.clear();
                chrome.storage.local.remove(['posts_dataset', 'capture_stats', 'graphql_queries'], () => {
                    showToast('Local data cleared', 'success');
                    allPosts = [];
                    processData();
                });
            } catch (err) {
                showToast('Failed to clear data: ' + err.message, 'error');
            }
        }
    });

    btnExportCsv.addEventListener('click', () => {
        if (filteredPosts.length === 0) return;

        const headers = ["Shortcode", "Post URL", "Username", "Likes", "Comments", "Timestamp", "Type", "Classification", "Is Video", "Is Carousel", "Coauthors", "Tagged Users", "Collective Reach", "Caption"];
        const rows = filteredPosts.map(p => [
            p.shortcode || '',
            p.postUrl || '',
            p.owner?.username || '',
            p.likes || 0,
            p.comments || 0,
            p.timestamp || '',
            p.productType || '',
            p.classification || 'Normal Post',
            p.isVideo ? 'true' : 'false',
            p.isCarousel ? 'true' : 'false',
            (p.coauthors || []).map(c => c.username || c).join('; '),
            (p.tagged_users || []).map(t => t.username || t).join('; '),
            p.collectiveReach || 0,
            `"${(p.caption || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`
        ]);

        const content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([content], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `instagram_export_${Date.now()}.csv`;
        a.click();
    });

    searchInput.addEventListener('input', (e) => {
        if (commSearchInput) commSearchInput.value = e.target.value;
        applyFiltersAndSort();
    });
    if (commSearchInput) commSearchInput.addEventListener('input', (e) => {
        searchInput.value = e.target.value;
        applyFiltersAndSort();
    });

    const searchScopeEl = document.getElementById('search-scope');
    if (searchScopeEl) searchScopeEl.addEventListener('change', applyFiltersAndSort);
    const commSearchScopeEl = document.getElementById('comm-search-scope');
    if (commSearchScopeEl) commSearchScopeEl.addEventListener('change', applyFiltersAndSort);

    sortSelect.addEventListener('change', (e) => {
        if (commSortSelect) commSortSelect.value = e.target.value;
        applyFiltersAndSort();
    });
    if (commSortSelect) commSortSelect.addEventListener('change', (e) => {
        sortSelect.value = e.target.value;
        applyFiltersAndSort();
    });

    fileUpload.addEventListener('change', handleFileUpload);
    btnRefresh.addEventListener('click', loadLocalData);
    btnImportJson.addEventListener('click', () => fileUpload.click());

    if (commBtnExportCsv) commBtnExportCsv.addEventListener('click', () => btnExportCsv.click());
    if (commBtnExportJson) commBtnExportJson.addEventListener('click', () => btnExportJson.click());

    // Date filter listeners
    const syncDates = () => {
        const commFilterDateFrom = document.getElementById('comm-filter-date-from');
        const commFilterDateTo = document.getElementById('comm-filter-date-to');
        if (commFilterDateFrom && filterDateFrom) commFilterDateFrom.value = filterDateFrom.value;
        if (commFilterDateTo && filterDateTo) commFilterDateTo.value = filterDateTo.value;
        applyFiltersAndSort();
    };
    const syncCommDates = () => {
        const commFilterDateFrom = document.getElementById('comm-filter-date-from');
        const commFilterDateTo = document.getElementById('comm-filter-date-to');
        if (commFilterDateFrom && filterDateFrom) filterDateFrom.value = commFilterDateFrom.value;
        if (commFilterDateTo && filterDateTo) filterDateTo.value = commFilterDateTo.value;
        applyFiltersAndSort();
    };

    if (filterDateFrom) filterDateFrom.addEventListener('change', syncDates);
    if (filterDateTo) filterDateTo.addEventListener('change', syncDates);
    const commFilterDateFrom = document.getElementById('comm-filter-date-from');
    const commFilterDateTo = document.getElementById('comm-filter-date-to');
    if (commFilterDateFrom) commFilterDateFrom.addEventListener('change', syncCommDates);
    if (commFilterDateTo) commFilterDateTo.addEventListener('change', syncCommDates);

    if (btnClearDates) {
        btnClearDates.addEventListener('click', () => {
            if (filterDateFrom) filterDateFrom.value = '';
            if (filterDateTo) filterDateTo.value = '';
            syncDates();
        });
    }
    const commBtnClearDates = document.getElementById('comm-btn-clear-dates');
    if (commBtnClearDates) {
        commBtnClearDates.addEventListener('click', () => {
            if (commFilterDateFrom) commFilterDateFrom.value = '';
            if (commFilterDateTo) commFilterDateTo.value = '';
            syncCommDates();
        });
    }

    // Classification filter listeners
    function setClassFilter(val) {
        activeClassFilter = val;
        classFilterChips.forEach(c => c.classList.toggle('active', c.getAttribute('data-filter') === val));
        document.querySelectorAll('.comm-class-filter-chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-filter') === val));
        applyFiltersAndSort();
    }
    classFilterChips.forEach(chip => {
        chip.addEventListener('click', () => setClassFilter(chip.getAttribute('data-filter')));
    });
    document.querySelectorAll('.comm-class-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => setClassFilter(chip.getAttribute('data-filter')));
    });

    // Scrape status filter listeners (Commentator tab)
    function setScrapeFilter(val) {
        activeScrapeFilter = val;
        document.querySelectorAll('.comm-scrape-filter-chip').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-scrape-filter') === val);
        });
        applyFiltersAndSort();
    }    document.querySelectorAll('.comm-scrape-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => setScrapeFilter(chip.getAttribute('data-scrape-filter')));
    });

    if (toggleCollabPosts) toggleCollabPosts.addEventListener('change', (e) => {
        if (commToggleCollabPosts) commToggleCollabPosts.checked = e.target.checked;
        applyFiltersAndSort();
    });
    if (commToggleCollabPosts) commToggleCollabPosts.addEventListener('change', (e) => {
        if (toggleCollabPosts) toggleCollabPosts.checked = e.target.checked;
        applyFiltersAndSort();
    });

    // ---- Capture toggle (start/stop scraping while browsing Instagram) --
    // Mirrors the popup's Start/Stop Capture control so it can be driven
    // without reopening the small popup. Status is read from capture_state
    // in chrome.storage.local (written by background.js) and kept live via
    // the storage.onChanged listener below, so toggling from the popup while
    // this tab stays open updates the button here too.

    function renderCaptureToggle(captureState) {
        const btn = document.getElementById('btn-toggle-capture');
        if (!btn) return;
        const active = !!(captureState && captureState.active);
        btn.className = 'btn ' + (active ? 'btn-capture-on' : 'btn-capture-off');
        btn.textContent = active ? '■ Stop Scraping' : '▶ Start Scraping';
    }

    async function handleToggleCapture() {
        const btn = document.getElementById('btn-toggle-capture');
        const active = btn && btn.classList.contains('btn-capture-on');
        if (btn) btn.disabled = true;
        try {
            const response = await chrome.runtime.sendMessage({
                type: active ? 'STOP_CAPTURE' : 'START_CAPTURE',
            });
            if (response && response.success) {
                renderCaptureToggle(response.state);
            } else {
                showToast('Could not toggle capture.', 'error');
            }
        } catch (err) {
            console.error('[Viewer] Toggle capture error:', err);
            showToast('Could not toggle capture.', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ---- Scroll to End -------------------------------------------------
    // Click the button to arm, then click anywhere on the page; whatever
    // scroll container sits under the pointer jumps to its bottom.
    //
    // A synthetic KeyboardEvent for the End key is untrusted, so Chrome will
    // not perform its default scroll — a programmatic scroll is the working
    // equivalent, and it does not depend on what currently has focus.
    let scrollPickArmed = false;
    let scrollPickOverlay = null;
    let scrollPickTarget = null;

    /**
     * Nearest ancestor (or self) that actually scrolls. Needs BOTH an
     * overflow that permits scrolling AND content that overflows — either test
     * alone matches elements that cannot move. Falls back to the document.
     */
    function findScrollableAncestor(el) {
        for (let node = el; node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node);
            const canScroll = /(auto|scroll|overlay)/.test(style.overflowY);
            if (canScroll && node.scrollHeight > node.clientHeight + 1) return node;
        }
        const doc = document.scrollingElement || document.documentElement;
        return doc.scrollHeight > doc.clientHeight + 1 ? doc : null;
    }

    function scrollPickHighlight(el) {
        if (!scrollPickOverlay) return;
        if (!el || el === document.scrollingElement || el === document.documentElement) {
            // Whole document — outline the viewport instead of a zero-size rect.
            Object.assign(scrollPickOverlay.style, {
                top: '0px', left: '0px',
                width: `${window.innerWidth}px`, height: `${window.innerHeight}px`,
            });
            return;
        }
        const r = el.getBoundingClientRect();
        Object.assign(scrollPickOverlay.style, {
            top: `${r.top}px`, left: `${r.left}px`,
            width: `${r.width}px`, height: `${r.height}px`,
        });
    }

    function scrollPickMove(e) {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        // Highlight the container that will actually move, not the element the
        // pointer is over — clicking a post card scrolls its tab panel, and an
        // outline hugging the card would read as "nothing happened".
        scrollPickTarget = under ? findScrollableAncestor(under) : null;
        scrollPickHighlight(scrollPickTarget);
    }

    function scrollPickSuppress(e) {
        if (!scrollPickArmed) return;
        e.preventDefault();
        e.stopPropagation();
    }

    function scrollPickCommit(e) {
        if (!scrollPickArmed) return;
        e.preventDefault();
        e.stopPropagation();
        // Clicking the button again while armed cancels rather than picking
        // whatever sits behind it.
        if (e.target.closest && e.target.closest('#btn-scroll-end')) {
            endScrollPick();
            return;
        }
        const target = scrollPickTarget;
        endScrollPick();
        if (!target) {
            showToast('Nothing scrollable there.', 'warning');
            return;
        }
        target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
    }

    function scrollPickKey(e) {
        if (e.key === 'Escape') endScrollPick();
    }

    function beginScrollPick() {
        if (scrollPickArmed) { endScrollPick(); return; }
        scrollPickArmed = true;

        scrollPickOverlay = document.createElement('div');
        scrollPickOverlay.className = 'scroll-pick-overlay';
        document.body.appendChild(scrollPickOverlay);
        document.body.classList.add('scroll-pick-active');

        const btn = document.getElementById('btn-scroll-end');
        if (btn) btn.classList.add('active');

        document.addEventListener('mousemove', scrollPickMove, true);
        // mousedown too: the post grid opens its modal on mousedown, which would
        // fire before a click-only interceptor could stop it.
        document.addEventListener('mousedown', scrollPickSuppress, true);
        document.addEventListener('click', scrollPickCommit, true);
        document.addEventListener('keydown', scrollPickKey, true);
    }

    function endScrollPick() {
        scrollPickArmed = false;
        scrollPickTarget = null;
        if (scrollPickOverlay) { scrollPickOverlay.remove(); scrollPickOverlay = null; }
        document.body.classList.remove('scroll-pick-active');

        const btn = document.getElementById('btn-scroll-end');
        if (btn) btn.classList.remove('active');

        document.removeEventListener('mousemove', scrollPickMove, true);
        document.removeEventListener('mousedown', scrollPickSuppress, true);
        document.removeEventListener('click', scrollPickCommit, true);
        document.removeEventListener('keydown', scrollPickKey, true);
    }

    function runDataRecheck() {
        if (!allPosts || allPosts.length === 0) {
            showToast('No posts loaded to check.', 'error');
            return;
        }
        // currentPartnersList is the reach side of the invariant check — without
        // it that check has nothing independent to compare against. It is built
        // by calculateCollectiveReach(filteredPosts), so filteredPosts is the
        // basis the chip side must be counted over; the other checks still run
        // across the whole dataset.
        const report = DataAudit.runAudit(
            allPosts, globalProfilesDataset, currentPartnersList, filteredPosts);
        renderAuditReport(report);
        document.getElementById('audit-modal').style.display = 'flex';
    }

    function renderAuditReport(report) {
        const summaryEl = document.getElementById('audit-summary');
        const resultsEl = document.getElementById('audit-results');
        if (!summaryEl || !resultsEl) return;

        summaryEl.innerHTML = `
            <strong>${report.totalPosts.toLocaleString()}</strong> posts checked ·
            <strong>${report.issueCount.toLocaleString()}</strong> issues found`;

        resultsEl.innerHTML = report.checks.map(c => {
            const icon = c.count === 0 ? '✅' : (c.severity === 'error' ? '❌' : (c.severity === 'info' ? 'ℹ️' : '⚠️'));
            const rows = c.items.slice(0, 50).map(item =>
                `<li>${escapeHtml(JSON.stringify(item))}</li>`).join('');
            const more = c.items.length > 50
                ? `<li>…and ${c.items.length - 50} more</li>` : '';
            return `
                <details class="audit-check audit-${c.severity}" ${c.count > 0 ? 'open' : ''}>
                    <summary>${icon} ${escapeHtml(c.label)} — <strong>${c.count}</strong></summary>
                    ${c.note ? `<p class="audit-note">${escapeHtml(c.note)}</p>` : ''}
                    ${c.count > 0 ? `<ul class="audit-items">${rows}${more}</ul>` : ''}
                </details>`;
        }).join('');
    }

    function showCalculations() {
        const scopeEl = document.getElementById('calc-scope');
        const tableEl = document.getElementById('calc-table');
        const warnEl = document.getElementById('calc-warnings');
        const footEl = document.getElementById('calc-footer');
        if (!scopeEl || !tableEl) return;

        // Empty state — show a message, not a table with a zero total.
        if (!currentPartnersList || currentPartnersList.length === 0) {
            scopeEl.innerHTML = '';
            tableEl.innerHTML = '<p class="calc-empty">No profiles in scope. '
                + 'Import or capture posts, or widen the current filters.</p>';
            warnEl.innerHTML = '';
            footEl.innerHTML = '';
            document.getElementById('calc-modal').style.display = 'flex';
            return;
        }

        // 1. Scope — the totals are filter-dependent, so state the filters.
        const isComm = document.getElementById('tab-commentator')?.classList.contains('active');
        const qEl = isComm ? document.getElementById('comm-search-input') : searchInput;
        const sEl = document.getElementById(isComm ? 'comm-search-scope' : 'search-scope');
        const dF = isComm ? document.getElementById('comm-filter-date-from') : filterDateFrom;
        const dT = isComm ? document.getElementById('comm-filter-date-to') : filterDateTo;
        scopeEl.innerHTML = `
            <strong>${filteredPosts.length.toLocaleString()}</strong> posts in scope ·
            Profile: <strong>${escapeHtml(activeProfileFilter || 'All')}</strong> ·
            Dates: <strong>${escapeHtml(dF?.value || 'any')} → ${escapeHtml(dT?.value || 'any')}</strong> ·
            Search: <strong>${escapeHtml(qEl?.value || '(none)')}</strong>
                (${escapeHtml(sEl?.value || 'all')}) ·
            Class: <strong>${escapeHtml(activeClassFilter)}</strong>`;

        // 2. One row per profile, sorted by impressions.
        const rows = currentPartnersList
            .map(inf => {
                const followers = inf.followers || 0;
                const posts = inf.postCount || 0;
                const excluded = !!inf.is_excluded_manually;
                return {
                    username: inf.username, followers, posts, excluded,
                    is_verified: inf.is_verified,
                    sources: [...(inf.sources || [])],
                    impressions: excluded ? 0 : followers * posts,
                };
            })
            .sort((a, b) => b.impressions - a.impressions);

        const grand = rows.reduce((s, r) => s + r.impressions, 0);

        tableEl.innerHTML = `
            <table class="calc-grid">
                <thead><tr>
                    <th>Profile</th><th>Followers</th><th>Posts</th>
                    <th>Impressions</th><th>Share</th><th>Role</th>
                </tr></thead>
                <tbody>${rows.map((r, i) => `
                    <tr class="calc-row ${r.impressions === 0 ? 'calc-zero' : ''}" data-row="${i}">
                        <td>@${escapeHtml(r.username)}${r.is_verified ? ' ✔' : ''}</td>
                        <td>${r.followers.toLocaleString()}</td>
                        <td>${r.posts.toLocaleString()}</td>
                        <td>${r.impressions.toLocaleString()}</td>
                        <td>${grand ? ((r.impressions / grand) * 100).toFixed(1) : '0.0'}%</td>
                        <td>${escapeHtml(r.sources.join(', '))}</td>
                    </tr>
                    <tr class="calc-detail" id="calc-detail-${i}" style="display:none;">
                        <td colspan="6">
                            <div class="calc-per-post-note">Impression per post: <strong>${
                                (r.excluded ? 0 : r.followers).toLocaleString()
                            }</strong>${r.excluded ? ' <span class="calc-excluded-note">(excluded &mdash; counted as 0)</span>' : ''}</div>
                            <ul>${
                                filteredPosts
                                    .filter(p => PostIndex.postProfiles(p).has(r.username))
                                    .map(p => `<li>${escapeHtml(p.shortcode || '?')} · `
                                        + `${new Date((p.timestamp > 1e10 ? p.timestamp : p.timestamp * 1000)).toLocaleDateString()} · `
                                        + `${(parseInt(p.likes) || 0).toLocaleString()} likes · `
                                        + `${(parseInt(p.comments) || 0).toLocaleString()} comments</li>`)
                                    .join('')
                            }</ul>
                            <div class="calc-formula-line">${r.followers.toLocaleString()} followers &times; ${r.posts.toLocaleString()} posts = <strong>${r.impressions.toLocaleString()}</strong>${r.excluded ? ' <span class="calc-excluded-note">(excluded &mdash; counted as 0)</span>' : ''}</div>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>`;

        // Expand a row to see exactly which posts it counted.
        tableEl.querySelectorAll('.calc-row').forEach(tr => {
            tr.addEventListener('click', () => {
                const d = document.getElementById(`calc-detail-${tr.dataset.row}`);
                if (d) d.style.display = d.style.display === 'none' ? 'table-row' : 'none';
            });
        });

        // 3. Why the total may be understated.
        const zero = rows.filter(r => r.followers === 0);
        const excl = rows.filter(r => r.excluded);
        warnEl.innerHTML = [
            zero.length ? `<p>⚠️ <strong>${zero.length}</strong> profile(s) contribute 0 because no
                follower count has been captured for them: ${zero.map(r => '@' + escapeHtml(r.username)).join(', ')}.
                Visit them on Instagram with capture running to complete the total.</p>` : '',
            excl.length ? `<p>🚫 <strong>${excl.length}</strong> profile(s) are manually excluded:
                ${excl.map(r => '@' + escapeHtml(r.username)).join(', ')}.</p>` : '',
        ].join('');

        footEl.innerHTML = `<strong>Total: ${grand.toLocaleString()}</strong>
            · ${filteredPosts.length ? Math.round(grand / filteredPosts.length).toLocaleString() : 0} per post`;

        document.getElementById('calc-modal').style.display = 'flex';
    }

    async function handleApplyFixes() {
        const summary = DataAudit.applyFixes(allPosts, globalProfilesDataset);

        // Persist ONLY the posts whose stored fields actually changed, via the
        // local-only PostsStore.updatePost.
        //
        // Do NOT use saveImportedData() here. Despite the name it is the import
        // path: it runs PostsStore.addPosts, shows "Imported N posts" toasts,
        // and — when a project is active — fires SYNC_POSTS_TO_BACKEND for
        // everything passed to it. Apply Fixes is a local repair and must not
        // push to the backend.
        let persisted = 0;
        for (const shortcode of summary.changed) {
            const post = allPosts.find(p => p.shortcode === shortcode);
            if (!post) continue;
            const ok = await PostsStore.updatePost(shortcode, {
                coauthors: post.coauthors,
                coauthor_producers: post.coauthor_producers,
            });
            if (ok) persisted++;
        }

        processData(); // recomputes reach + breakdown from the repaired data
        renderAuditReport(DataAudit.runAudit(
            allPosts, globalProfilesDataset, currentPartnersList, filteredPosts));
        showToast(
            `Fixed ${summary.aliasesSynced} alias pairs and ${summary.followersBackfilled} follower `
            + `counts across ${persisted} saved posts.`, 'success');
    }

    function calculateCollectiveReach(posts) {
        console.log('[calculateCollectiveReach] Processing', posts ? posts.length : 0, 'posts');

        const collabInfluencers = new Map();
        let collabCount = 0;
        let paidCount = 0;

        if (!posts || posts.length === 0) {
            currentPartnersList = [];
            return { collabCount: 0, paidCount: 0 };
        }

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
                // Determine initial exclusion state based on old values to preserve user clicks if possible
                let is_excluded_manually = false;
                const oldPartner = currentPartnersList.find(p => p.username === username);
                if (oldPartner) {
                    is_excluded_manually = oldPartner.is_excluded_manually;
                }

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
                    is_excluded_manually
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
            // Objects (for follower_count), ordered by the same alias rule as PostIndex.
            const coauthorList = (post.coauthors && post.coauthors.length)
                ? post.coauthors
                : (post.coauthor_producers || []);
            const hasCoauthors = coauthorList.length > 0;
            const isPaid = post.is_paid_partnership || post.isPaid || post.type === 'paid' || post.type === 'collab' || post.type === 'paid_collab';

            if (isPaid) paidCount++;
            if (hasCoauthors) collabCount++;

            const influencersInThisPost = new Set();
            const postReachBreakdown = [];
            let postCollectiveReach = 0;

            const localAddInfluencer = (username, followers, source, path, extraProfileData = {}) => {
                addInfluencer(username, followers, source, path, extraProfileData);
                if (username && !influencersInThisPost.has(username)) {
                    const inf = collabInfluencers.get(username);
                    if (hasCoauthors) inf.perUserCollabCount++;
                    if (isPaid) inf.perUserPaidCount++;
                    inf.postCount++;
                    influencersInThisPost.add(username);

                    postReachBreakdown.push(`@${username} (${followers || 0})`);
                    postCollectiveReach += (followers || 0);
                }
            };

            const mainUser = PostIndex.getOwner(post);
            const mainReach = post.owner?.follower_count || post.user?.follower_count || post.owner?.edge_followed_by?.count || post.followers || 0;
            localAddInfluencer(mainUser, mainReach, 'Owner', `.items[${index}].user.username`, post.owner || post.user || {});

            // Coauthors. Every collaborator on a multi-collab post is credited,
            // which is what puts them in the Potential Impressions list.
            coauthorList.forEach((c, j) => {
                const co = (typeof c === 'string') ? { username: c } : (c || {});
                const coReach = co.follower_count || co.edge_followed_by?.count || 0;
                localAddInfluencer(co.username, coReach, 'Co-author', `.items[${index}].coauthor_producers[${j}].username`, co);
            });

            post.collectiveReach = postCollectiveReach;
            post.reachBreakdown = postReachBreakdown;
        });

        currentPartnersList = Array.from(collabInfluencers.values());
        return { collabCount, paidCount };
    }



    function updateGlobalReachTotals() {
        const grandTotal = currentPartnersList.reduce((sum, inf) => sum + ((inf.followers || 0) * inf.postCount * (inf.is_excluded_manually ? 0 : 1)), 0);
        const formattedTotal = formatStatNumber(grandTotal);

        const totalValueElViewer = document.getElementById('reach-total-value');
        if (totalValueElViewer) setStatValue(totalValueElViewer, grandTotal);

        const totalValueElComm = document.getElementById('comm-reach-total-value');
        if (totalValueElComm) setStatValue(totalValueElComm, grandTotal);

        const totalValueElProj2 = document.getElementById('proj2-reach-total-value');
        if (totalValueElProj2) setStatValue(totalValueElProj2, grandTotal);
    }

    function syncAllRowStyles() {
        // Sync exclusion styles across both panels
        currentPartnersList.forEach(inf => {
            const calculatedReach = (inf.followers || 0) * (inf.postCount || 1);
            const isExcluded = calculatedReach === 0 || inf.is_excluded_manually;
            const rows = document.querySelectorAll(`.pf-reach-item[data-username="${inf.username}"]`);

            rows.forEach(row => {
                const isMain = row.classList.contains('main-user');
                row.className = 'pf-reach-item' + (isMain ? ' main-user' : '') + (isExcluded ? ' excluded' : '');
                row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); font-size: 12px; cursor: pointer; transition: 0.2s; border-radius: 4px; margin: 0px -5px;';
                if (isExcluded) {
                    row.style.cssText += ' opacity: 0.4; filter: grayscale(0.6); background: rgba(255, 255, 255, 0.02);';
                }
                if (isMain && !isExcluded) {
                    row.style.borderBottom = '1px solid var(--border-color, rgba(255,255,255,0.2))';
                    row.style.paddingBottom = '12px';
                    row.style.marginBottom = '12px';
                }
            });
        });
    }

    function renderCollectiveReachDOM(stats, contextPrefix = '') {
        const panel = document.getElementById(`${contextPrefix}reach-panel`);
        const listEl = document.getElementById(`${contextPrefix}reach-breakdown-list`);
        const scrapInfluencersBtn = document.getElementById(`${contextPrefix}btn-scrap-influencers`);

        if (!panel || !listEl) return;

        if (currentPartnersList.length === 0) {
            panel.style.display = 'none';
            if (scrapInfluencersBtn) scrapInfluencersBtn.style.display = 'none';
            return;
        }

        panel.style.display = isReachVisible ? 'block' : 'none';
        if (scrapInfluencersBtn) scrapInfluencersBtn.style.display = 'block';
        listEl.innerHTML = '';

        const collabCountEl = document.getElementById(`${contextPrefix}reach-collab-count`);
        const paidCountEl = document.getElementById(`${contextPrefix}reach-paid-count`);
        if (collabCountEl) setStatValue(collabCountEl, stats.collabCount);
        if (paidCountEl) setStatValue(paidCountEl, stats.paidCount);

        const sorted = [...currentPartnersList].sort((a, b) => ((b.followers || 0) * b.postCount) - ((a.followers || 0) * a.postCount));
        
        // Same reasoning as _applyFiltersSync's mainUsername: filteredPosts[0]
        // .scrapedFromProfile is arbitrary now that a bucket can hold posts
        // captured under another profile, so the active chip wins when set.
        let mainUserItem = null;
        const mainCandidate = activeProfileFilter
            || (typeof filteredPosts !== 'undefined' && filteredPosts.length > 0
                && PostIndex.getOwner(filteredPosts[0]));
        if (mainCandidate) {
            mainUserItem = sorted.find(inf => inf.username === mainCandidate);
        }
        if (!mainUserItem) {
            mainUserItem = sorted.find(inf => inf.sources.has('Owner'));
        }
        const others = sorted.filter(inf => inf !== mainUserItem);

        const escapeHtml = str => str ? str.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])) : '';



        const renderItem = (inf, isMain = false, targetContainer = listEl, rankIndex = 0) => {
            const calculatedReach = (inf.followers || 0) * (inf.postCount || 1);
            const row = document.createElement('div');
            row.setAttribute('data-username', inf.username);
            row.className = 'pf-reach-item' + (isMain ? ' main-user' : '');

            const followersFormatted = formatStatNumber(inf.followers || 0);
            const verifiedBadge = inf.is_verified ? `
                <span style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; margin-left:4px; flex-shrink:0;">
                    <svg fill="#0095F6" viewBox="0 0 40 40" width="14" height="14">
                        <path d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v5.905h5.975L14.638 40l5.36-3.094L25.358 40l3.232-5.6h6.162v-6.01L40 25.359 36.905 20 40 14.641l-5.248-3.03v-6.46h-6.419L25.358 0l-5.36 3.094Zm7.415 11.225 2.254 2.287-11.43 11.5-6.835-6.93 2.244-2.258 4.587 4.581 9.18-9.18Z"></path>
                    </svg>
                </span>` : "";
            
            const userLink = `https://www.instagram.com/${inf.username}/`;
            const activeRole = localRolesMap[inf.username];
            const brandActiveStyle = activeRole === 'brand' ? 'background:rgba(99,102,241,0.8); color:#fff;' : 'background:rgba(99,102,241,0.1); color:#818cf8;';
            const compActiveStyle = activeRole === 'competitor' ? 'background:rgba(239,68,68,0.8); color:#fff;' : 'background:rgba(239,68,68,0.1); color:#f87171;';

            const roleButtonsHtml = `
                <div style="display:flex; align-items:center; gap:4px; margin-top:6px;">
                </div>
                `;
                // <button class="pf-role-btn" data-username="${inf.username}" data-role="brand" style="font-size:9px; padding:2px 6px; border-radius:4px; border:1px solid rgba(99,102,241,0.5); cursor:pointer; font-weight:600; transition:0.2s; ${brandActiveStyle}">🏢 Brand</button>
                // <button class="pf-role-btn" data-username="${inf.username}" data-role="competitor" style="font-size:9px; padding:2px 6px; border-radius:4px; border:1px solid rgba(239,68,68,0.5); cursor:pointer; font-weight:600; transition:0.2s; ${compActiveStyle}">🐰 Competitor</button>

            const c = RANK_COLORS[Math.min(rankIndex, RANK_COLORS.length - 1)];
            const rankLabel = `#${rankIndex + 1}`;

            row.innerHTML = `
            <div style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 14px 16px;
                border-radius: 16px;
                background: ${c.bg};
                border: 1.5px solid ${c.border};
                margin-bottom: 10px;
                width: 100%;
                box-sizing: border-box;
                position: relative;
                overflow: hidden;
                cursor: pointer;
                font-family: 'DM Sans', system-ui, sans-serif;
                transition: transform 0.15s;
            ">

                <!-- Left accent bar -->
                <div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:${c.accent};border-radius:16px 0 0 16px;"></div>

                <!-- Rank badge -->
                <div style="
                    width:28px; height:28px;
                    border-radius:8px;
                    background:${c.badge};
                    color:${c.badgeText};
                    display:flex; align-items:center; justify-content:center;
                    font-size:11px; font-weight:700;
                    flex-shrink:0;
                    letter-spacing:-0.3px;
                    font-family:monospace;
                ">${rankLabel}</div>

                <!-- Profile info -->
                <div style="flex:1; min-width:0; padding-left:2px;">
                    <div style="display:flex; align-items:center; gap:4px;">
                        <a href="${userLink}" target="_blank" style="
                            font-weight:700; font-size:13px;
                            color:${c.textDark}; text-decoration:none;
                            white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                            letter-spacing:-0.2px;
                        ">@${inf.username}</a>
                        ${verifiedBadge}
                    </div>
                    <div style="font-size:11px; color:${c.textMid}; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:0.7;">
                        ${inf.full_name || ''}
                    </div>
                    <div style="font-size:10px; color:${c.textMid}; margin-top:3px; opacity:0.6; font-weight:500; letter-spacing:0.2px;">
                        ${followersFormatted} followers
                    </div>
                    ${roleButtonsHtml}
                </div>

                <!-- Metrics -->
                <div style="text-align:right; flex-shrink:0;">
                    <div style="font-size:9px; text-transform:uppercase; letter-spacing:0.08em; color:${c.textLight}; font-weight:600;">
                        Impressions
                    </div>
                    <div style="font-size:18px; font-weight:800; color:${c.textDark}; letter-spacing:-0.5px; line-height:1.1; margin:2px 0;">
                        ${formatStatNumber(calculatedReach)}
                    </div>
                    <div style="font-size:10px; color:${c.textMid}; opacity:0.65; font-weight:500;">
                        ${isMain ? 'Posts' : 'Collabs'} · ${inf.postCount}
                    </div>
                </div>

                <!-- Chevron -->
                <div style="font-size:18px; flex-shrink:0; color:${c.accent}; opacity:0.6; margin-left:4px;">›</div>

            </div>
            `;

            row.addEventListener('click', (e) => {
                if (e.target.tagName.toLowerCase() === 'a' || e.target.classList.contains('pf-role-btn')) return;
                inf.is_excluded_manually = !inf.is_excluded_manually;
                syncAllRowStyles();
                updateGlobalReachTotals();
            });

            // Hover effect handled via CSS .pf-reach-item-inner:hover
            // Potential impressions are now determined by campaign profile filter, not hover

            const roleBtns = row.querySelectorAll('.pf-role-btn');
            roleBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const role = btn.getAttribute('data-role');
                    if (localRolesMap[inf.username] === role) {
                        delete localRolesMap[inf.username];
                    } else {
                        localRolesMap[inf.username] = role;
                    }
                    chrome.storage.local.set({ local_roles_map: localRolesMap }, () => {
                        document.querySelectorAll(`.pf-role-btn[data-username="${inf.username}"]`).forEach(otherBtn => {
                            const btnRole = otherBtn.getAttribute('data-role');
                            const isActive = localRolesMap[inf.username] === btnRole;
                            if (btnRole === 'brand') {
                                otherBtn.style.background = isActive ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.1)';
                                otherBtn.style.color = isActive ? '#fff' : '#818cf8';
                            } else {
                                otherBtn.style.background = isActive ? 'rgba(239,68,68,0.8)' : 'rgba(239,68,68,0.1)';
                                otherBtn.style.color = isActive ? '#fff' : '#f87171';
                            }
                        });

                        if (typeof projCurrentProjectId !== 'undefined' && projCurrentProjectId) {
                            const activeRole = localRolesMap[inf.username];
                            const projectRole = activeRole || 'tracked';
                            if (activeRole === 'brand') {
                                compSelectedBrand = inf.username;
                                compSelectedCompetitors = compSelectedCompetitors.filter(c => c !== inf.username);
                            } else if (activeRole === 'competitor') {
                                if (compSelectedBrand === inf.username) compSelectedBrand = null;
                                if (!compSelectedCompetitors.includes(inf.username)) {
                                    if (compSelectedCompetitors.length < 3) compSelectedCompetitors.push(inf.username);
                                    else { compSelectedCompetitors.pop(); compSelectedCompetitors.push(inf.username); }
                                }
                            } else {
                                if (compSelectedBrand === inf.username) compSelectedBrand = null;
                                compSelectedCompetitors = compSelectedCompetitors.filter(c => c !== inf.username);
                            }

                            if (typeof compBrandSelect !== 'undefined' && compBrandSelect) compBrandSelect.value = compSelectedBrand || '';
                            if (typeof comp_renderCompetitorChips === 'function') comp_renderCompetitorChips();

                            chrome.storage.local.set({ comp_pinned: { brand: compSelectedBrand, competitors: compSelectedCompetitors, projectId: projCurrentProjectId } }, () => {
                                projChangeRole(inf.username, projectRole, true).then(() => {
                                    if (typeof compDashboard !== 'undefined' && compDashboard && compDashboard.style.display === 'block') {
                                        if (typeof comp_loadDashboard === 'function') comp_loadDashboard();
                                    }
                                });
                            });
                        }
                    });
                });
            });

            targetContainer.appendChild(row);
        };

        if (mainUserItem) {
            const mainHeader = document.createElement('div');
            mainHeader.innerHTML = `<h3 style="margin-bottom: 8px; margin-top: 5px; color: var(--text-secondary); font-size: 14px; font-weight:bold;">Mainbrand:</h3>`;
            listEl.appendChild(mainHeader);
            renderItem(mainUserItem, true, listEl, 0);
        }

        if (others.length > 0) {
            const othersTotalReach = others.reduce((sum, inf) => sum + ((inf.followers || 0) * (inf.postCount || 1)), 0);
            
            const partnersHeader = document.createElement('div');
            partnersHeader.className = 'partners-toggle-header';
            partnersHeader.style.cssText = 'cursor: pointer; transition: background 0.2s; padding: 10px; border-radius: 8px; margin: 0px 0;';
            partnersHeader.innerHTML = `
                <hr style="margin: 5px 0 15px 0; border: 0; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="text-align: center; padding: 0 10px;">
                    <h3 style="margin: 0; color: var(--text-secondary); font-size: 14px; font-weight:bold;">Partner Breakdown (${formatStatNumber(othersTotalReach)})</h3>
                    </div>
                    <hr style="margin: 15px 0 5px 0; border: 0; border-top: 1px solid rgba(255,255,255,0.1);">
                    `;
                    // <div style="font-size: 16px; color: var(--text-secondary); font-weight: bold; margin-top: 4px;">(${formatStatNumber(othersTotalReach)})</div>
            
            const othersContainer = document.createElement('div');
            othersContainer.className = 'partners-list-container';
            othersContainer.style.display = 'block'; // Opened by default
            partnersHeader.style.background = 'rgba(255,255,255,0.05)';
            
            partnersHeader.onclick = () => {
                const isHidden = othersContainer.style.display === 'none';
                othersContainer.style.display = isHidden ? 'block' : 'none';
                partnersHeader.style.background = isHidden ? 'rgba(255,255,255,0.05)' : 'transparent';
            };

            listEl.appendChild(partnersHeader);
            listEl.appendChild(othersContainer);
            others.forEach((inf, idx) => renderItem(inf, false, othersContainer, idx + 1));
        }
    }

    // JSON Export with full collab breakdown and comments
    if (btnExportJson) {
        btnExportJson.addEventListener('click', () => {
            if (filteredPosts.length === 0) {
                showToast('No posts to export', 'warning');
                return;
            }

            const shortcodes = filteredPosts.map(p => p.shortcode);
            showToast(`Preparing JSON export...`, 'info');

            chrome.runtime.sendMessage({ type: 'GET_COMMENTS_FOR_POSTS', shortcodes }, (response) => {
                const scrapedComments = (response && response.success && response.comments) ? response.comments : [];

                // Attach scraped comments to their respective posts
                const postsWithComments = filteredPosts.map(post => {
                    const postComments = scrapedComments.filter(c => c.post_shortcode === post.shortcode);
                    return {
                        ...post,
                        scraped_comments: postComments
                    };
                });

                // collabInfluencers already built by calculateCollectiveReach
                const collabPartners = currentPartnersList.map(inf => ({
                    username: inf.username,
                    followers: inf.followers,
                    sources: Array.from(inf.sources),
                    perUserCollabCount: inf.perUserCollabCount,
                    perUserPaidCount: inf.perUserPaidCount,
                    postCount: inf.postCount,
                    is_verified: inf.is_verified,
                    full_name: inf.full_name,
                    category_name: inf.category_name,
                    media_count: inf.media_count,
                    is_excluded_manually: inf.is_excluded_manually,
                    local_role: localRolesMap[inf.username] || null,
                    calculated_reach: (inf.followers || 0) * (inf.postCount || 1)
                }));

                // Use the correct matching UI calculation for reach
                const totalReach = currentPartnersList.reduce((sum, inf) => {
                    const reach = (inf.followers || 0) * (inf.postCount || 1);
                    return sum + (inf.is_excluded_manually ? 0 : reach);
                }, 0);

                // Determine sourceUsername from the most common owner
                const ownerCounts = {};
                filteredPosts.forEach(p => {
                    const u = p.owner?.username || p.caption_user?.username;
                    if (u) ownerCounts[u] = (ownerCounts[u] || 0) + 1;
                });
                const sourceUsername = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

                const exportData = {
                    timestamp: new Date().toISOString(),
                    version: '1.2',
                    sourceUsername,
                    count: filteredPosts.length,
                    posts: postsWithComments,
                    collabPartners,
                    scrapedProfiles: globalProfilesDataset,
                    summary: {
                        totalPosts: filteredPosts.length,
                        totalCollabPartners: collabPartners.length,
                        totalScrapedComments: scrapedComments.length,
                        totalScrapedProfiles: globalProfilesDataset.length,
                        totalReach,
                    },
                };

                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ig_scrape_results_${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);

                showToast(`Exported ${filteredPosts.length} posts with ${scrapedComments.length} comments and reach data`, 'success');
            });
        });
    }

    async function handleInfluencerEnrichedExport() {
        if (currentPartnersList.length === 0) {
            showToast('No influencer data to export. Try viewing Potential Impressions first.', 'warning');
            return;
        }

        showToast('Enriching influencer profiles...', 'info');

        const enriched = currentPartnersList.map(inf => {
            const cached = globalProfilesDataset.find(p => p.username === inf.username) || {};

            return {
                'Username': inf.username || '',
                'Full Name': cached.full_name || inf.full_name || '',
                'User ID': String(cached.pk || cached.user_id || inf.user_id || ''),
                'Followers': cached.follower_count || inf.followers || 0,
                'Following': cached.following_count || 0,
                'Media Count': cached.media_count || inf.media_count || 0,
                'Verified': (cached.is_verified || inf.is_verified) ? 'Yes' : 'No',
                'Private': (cached.is_private) ? 'Yes' : 'No',
                'Category': cached.category_name || inf.category_name || '',
                'Bio': (cached.biography || '').replace(/\n/g, ' '),
                'External URL': cached.external_url || '',
                'Profile Pic URL': cached.profile_pic_url || inf.profile_pic_url || ''
            };
        });

        downloadAsXLSX(enriched, `influencer_enriched_export_${Date.now()}.xlsx`);
        showToast(`Exported ${enriched.length} influencers!`, 'success');
    }

    async function handleInfluencerCommentsExport() {
        if (projPostsData.length === 0) {
            showToast('No posts in this project to export from.', 'warning');
            return;
        }

        const collabPosts = projPostsData.filter(post => {
            const coauthorList = post.coauthor_producers || post.coauthors || [];
            const hasCoauthors = coauthorList.length > 0;
            const isPaid = post.is_paid_partnership || post.isPaid || post.type === 'paid' || post.type === 'collab' || post.type === 'paid_collab';
            return hasCoauthors || isPaid;
        });

        if (collabPosts.length === 0) {
            showToast('No collab or paid posts found in this project.', 'warning');
            return;
        }

        showToast(`Processing influencer data for ${collabPosts.length} collab/paid posts...`, 'info');

        const exportData = [];

        collabPosts.forEach(post => {
            const postUrl = post.postUrl || (post.shortcode ? `https://www.instagram.com/p/${post.shortcode}/` : '');
            const postType = post.type || (post.is_paid_partnership ? 'paid' : 'collab');

            // Collect all unique influencers for this post
            const influencers = new Map(); // username -> source

            const addInf = (u, source) => {
                if (u && !influencers.has(u)) influencers.set(u, source);
            };

            const mainUser = post.owner?.username || post.user?.username || post.username || post.caption_user?.username;
            addInf(mainUser, 'Owner');

            const coauthors = post.coauthor_producers || post.coauthors || [];
            coauthors.forEach(c => addInf(c.username, 'Co-author'));

            const captionUser = post.caption_user || post.caption?.user;
            if (captionUser && captionUser.username) addInf(captionUser.username, 'Caption');

            // For each unique influencer, create a row
            influencers.forEach((source, username) => {
                const partner = currentPartnersList.find(p => p.username === username) || {};
                const cached = globalProfilesDataset.find(p => p.username === username) || {};

                // Skip if excluded manually or reach is 0
                const calculatedReach = (partner.followers || 0) * (partner.postCount || 1);
                if (partner.is_excluded_manually || calculatedReach === 0) return;

                exportData.push({
                    'Post URL': postUrl,
                    'Post Shortcode': post.shortcode || '',
                    'Post Type': postType,
                    'Influencer Source': source,
                    'Username': username,
                    'Full Name': cached.full_name || partner.full_name || '',
                    'Followers': cached.follower_count || partner.followers || 0,
                    'Verified': (cached.is_verified || partner.is_verified) ? 'Yes' : 'No',
                    'Category': cached.category_name || partner.category_name || '',
                    'Post Count (Total)': cached.media_count || partner.media_count || 0,
                    'Bio': (cached.biography || '').replace(/\n/g, ' '),
                    'External URL': cached.external_url || '',
                });
            });
        });

        if (exportData.length === 0) {
            showToast('No influencer data extracted.', 'warning');
            return;
        }

        downloadAsXLSX(exportData, `project_collab_influencer_export_${Date.now()}.xlsx`);
        showToast(`Exported ${exportData.length} records for ${collabPosts.length} posts from Project!`, 'success');
    }

    async function handleCommInfluencerCommentsExport() {
        if (filteredPosts.length === 0) {
            showToast('No filtered posts to export from.', 'warning');
            return;
        }

        const collabPosts = filteredPosts.filter(post => {
            const coauthorList = post.coauthor_producers || post.coauthors || [];
            const hasCoauthors = coauthorList.length > 0;
            const isPaid = post.is_paid_partnership || post.isPaid || post.type === 'paid' || post.type === 'collab' || post.type === 'paid_collab';
            return hasCoauthors || isPaid;
        });

        if (collabPosts.length === 0) {
            showToast('No collab or paid posts found in filtered results.', 'warning');
            return;
        }

        showToast(`Processing influencer data for ${collabPosts.length} collab/paid posts...`, 'info');

        const exportData = [];

        collabPosts.forEach(post => {
            const postUrl = post.postUrl || (post.shortcode ? `https://www.instagram.com/p/${post.shortcode}/` : '');
            const postType = post.type || (post.is_paid_partnership ? 'paid' : 'collab');

            // Collect all unique influencers for this post
            const influencers = new Map(); // username -> source

            const addInf = (u, source) => {
                if (u && !influencers.has(u)) influencers.set(u, source);
            };

            const mainUser = post.owner?.username || post.user?.username || post.username || post.caption_user?.username;
            addInf(mainUser, 'Owner');

            const coauthors = post.coauthor_producers || post.coauthors || [];
            coauthors.forEach(c => addInf(c.username, 'Co-author'));

            const captionUser = post.caption_user || post.caption?.user;
            if (captionUser && captionUser.username) addInf(captionUser.username, 'Caption');

            // For each unique influencer, create a row
            influencers.forEach((source, username) => {
                const partner = currentPartnersList.find(p => p.username === username) || {};
                const cached = globalProfilesDataset.find(p => p.username === username) || {};

                // Skip if excluded manually or reach is 0
                const calculatedReach = (partner.followers || 0) * (partner.postCount || 1);
                if (partner.is_excluded_manually || calculatedReach === 0) return;

                exportData.push({
                    'Post URL': postUrl,
                    'Post Shortcode': post.shortcode || '',
                    'Post Type': postType,
                    'Influencer Source': source,
                    'Username': username,
                    'Full Name': cached.full_name || partner.full_name || '',
                    'Followers': cached.follower_count || partner.followers || 0,
                    'Verified': (cached.is_verified || partner.is_verified) ? 'Yes' : 'No',
                    'Category': cached.category_name || partner.category_name || '',
                    'Post Count (Total)': cached.media_count || partner.media_count || 0,
                    'Bio': (cached.biography || '').replace(/\n/g, ' '),
                    'External URL': cached.external_url || '',
                });
            });
        });

        if (exportData.length === 0) {
            showToast('No influencer data extracted.', 'warning');
            return;
        }

        downloadAsXLSX(exportData, `collab_influencer_export_${Date.now()}.xlsx`);
        showToast(`Exported ${exportData.length} records for ${collabPosts.length} posts!`, 'success');
    }

    if (btnExportEnriched) btnExportEnriched.addEventListener('click', handleInfluencerEnrichedExport);
    if (commBtnExportEnriched) commBtnExportEnriched.addEventListener('click', () => updateReachVisibility(false));
    if (commBtnExportEnriched) commBtnExportEnriched.addEventListener('click', handleInfluencerEnrichedExport);
    if (commBtnExportEnrichedComments) commBtnExportEnrichedComments.addEventListener('click', handleCommInfluencerCommentsExport);

    // -- Progress panel elements --
    const scraperProgressPanel = document.getElementById('scraper-progress-panel');
    const scraperStatusIcon = document.getElementById('scraper-status-icon');
    const scraperStatusText = document.getElementById('scraper-status-text');
    const scraperProgressBar = document.getElementById('scraper-progress-bar');
    const scraperJobCount = document.getElementById('scraper-job-count');
    const scraperCommentCount = document.getElementById('scraper-comment-count');
    const scraperSkippedCount = document.getElementById('scraper-skipped-count');
    const scraperCurrentPost = document.getElementById('scraper-current-post');
    const scraperCurrentLink = document.getElementById('scraper-current-link');
    const backendStatusDot = document.querySelector('#backend-status-indicator .status-dot');
    const commResumeBtn = document.getElementById('comm-resume-scrape-btn');

    // -- Delay panel elements --
    const scraperDelayInput   = document.getElementById('scraper-delay-input');
    const scraperDelayDec     = document.getElementById('scraper-delay-dec');
    const scraperDelayInc     = document.getElementById('scraper-delay-inc');
    const scraperDelayPreview = document.getElementById('scraper-delay-preview');
    const scraperDelayCountdown    = document.getElementById('scraper-delay-countdown');
    const scraperDelayCountdownVal = document.getElementById('scraper-delay-countdown-val');

    function getPostDelayMin() {
        const val = parseInt(scraperDelayInput?.value) || 10;
        return Math.max(10, val);
    }

    function updateDelayPreview() {
        const min = getPostDelayMin();
        const max = min + 10;
        if (scraperDelayPreview) scraperDelayPreview.textContent = `~${min}–${max}s per post`;
    }

    if (scraperDelayInput) {
        scraperDelayInput.addEventListener('input', () => {
            // Clamp on blur/change
            let v = parseInt(scraperDelayInput.value) || 10;
            if (v < 10) { scraperDelayInput.value = 10; v = 10; }
            updateDelayPreview();
        });
        scraperDelayInput.addEventListener('blur', () => {
            let v = parseInt(scraperDelayInput.value) || 10;
            if (v < 10) scraperDelayInput.value = 10;
            updateDelayPreview();
        });
    }
    if (scraperDelayDec) {
        scraperDelayDec.addEventListener('click', () => {
            const cur = parseInt(scraperDelayInput?.value) || 10;
            if (scraperDelayInput) scraperDelayInput.value = Math.max(10, cur - 1);
            updateDelayPreview();
        });
    }
    if (scraperDelayInc) {
        scraperDelayInc.addEventListener('click', () => {
            const cur = parseInt(scraperDelayInput?.value) || 10;
            if (scraperDelayInput) scraperDelayInput.value = cur + 1;
            updateDelayPreview();
        });
    }
    updateDelayPreview(); // init preview text

    let scrapeStatusPollInterval = null;

    // Check backend connectivity and update indicator
    async function updateBackendStatus() {
        try {
            const settings = await new Promise(resolve => {
                chrome.storage.local.get(['extension_settings'], r => resolve(r.extension_settings || {}));
            });

            const apiUrl = CONFIG.normalizeUrl(settings.apiUrl || CONFIG.DEFAULT_API_URL);
            const res = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
            if (backendStatusDot) backendStatusDot.className = res.ok ? 'status-dot online' : 'status-dot offline';
            return res.ok;
        } catch {
            if (backendStatusDot) backendStatusDot.className = 'status-dot offline';
            return false;
        }
    }

    // Poll for scrape status from background
    function startStatusPolling() {
        if (scrapeStatusPollInterval) clearInterval(scrapeStatusPollInterval);
        scrapeStatusPollInterval = setInterval(() => {
            chrome.runtime.sendMessage({ type: 'GET_SCRAPE_STATUS' }, (status) => {
                if (!status || !status.success) return;
                updateProgressUI(status);

                if (status.status === 'completed' || status.status === 'failed') {
                    stopStatusPolling();
                    onScrapeComplete(status);
                }
            });
        }, 2000);
    }

    function stopStatusPolling() {
        if (scrapeStatusPollInterval) {
            clearInterval(scrapeStatusPollInterval);
            scrapeStatusPollInterval = null;
        }
    }

    function updateProgressUI(status) {
        if (!scraperProgressPanel) return;
        scraperProgressPanel.style.display = 'block';

        const pct = status.totalJobs > 0
            ? Math.round((status.completedJobs / status.totalJobs) * 100)
            : 0;

        if (scraperProgressBar) scraperProgressBar.style.width = `${pct}%`;
        if (scraperJobCount) scraperJobCount.textContent = `${status.completedJobs} / ${status.totalJobs} posts`;
        if (scraperCommentCount) scraperCommentCount.textContent = `${status.totalComments} comments scraped`;
        if (scraperSkippedCount && status.skippedPosts) {
            scraperSkippedCount.textContent = `(${status.skippedPosts} skipped)`;
        }

        switch (status.status) {
            case 'running':
                if (scraperStatusIcon) scraperStatusIcon.textContent = '🔄';
                if (scraperStatusText) scraperStatusText.textContent = `Scraping... ${pct}%`;
                break;
            case 'paused':
                if (scraperStatusIcon) scraperStatusIcon.textContent = '⏸️';
                if (scraperStatusText) scraperStatusText.textContent = 'Paused';
                break;
            case 'completed':
                if (scraperStatusIcon) scraperStatusIcon.textContent = '✅';
                if (scraperStatusText) scraperStatusText.textContent = 'Complete';
                break;
            case 'failed':
                if (scraperStatusIcon) scraperStatusIcon.textContent = '❌';
                if (scraperStatusText) scraperStatusText.textContent = 'Failed';
                break;
            default:
                if (scraperStatusIcon) scraperStatusIcon.textContent = '⏳';
                if (scraperStatusText) scraperStatusText.textContent = 'Initializing...';
        }

        if (status.currentPost && scraperCurrentPost && scraperCurrentLink) {
            scraperCurrentPost.style.display = 'block';
            scraperCurrentLink.textContent = status.currentPost;
            scraperCurrentLink.href = `https://www.instagram.com/p/${status.currentPost}/`;
        } else if (scraperCurrentPost) {
            scraperCurrentPost.style.display = 'none';
        }

        // Countdown display — shown when background is waiting between posts
        if (scraperDelayCountdown && scraperDelayCountdownVal) {
            const nextMs = status.nextDelayMs || 0;
            if (nextMs > 0 && status.status === 'running') {
                scraperDelayCountdown.style.display = 'flex';
                scraperDelayCountdownVal.textContent = `${(nextMs / 1000).toFixed(1)}s`;
            } else {
                scraperDelayCountdown.style.display = 'none';
            }
        }
    }

    function onScrapeComplete(status) {
        // Reset button
        if (commBatchScrapeBtn) {
            commBatchScrapeBtn.textContent = 'Batch Scraper';
            commBatchScrapeBtn.classList.remove('btn-danger');
            commBatchScrapeBtn.classList.add('btn-warning');
        }

        showToast(`Batch scrape complete! ${status.totalComments} comments across ${status.completedJobs} posts.`, 'success');
    }

    // Batch scrape button click handler (V1 Engine)
    if (commBatchScrapeBtn) {
        commBatchScrapeBtn.addEventListener('click', async () => {
            // Stop mode
            if (commBatchScrapeBtn.textContent === 'Pause Scrape') {
                chrome.runtime.sendMessage({ type: 'STOP_SCRAPE' });
                commBatchScrapeBtn.textContent = 'Stopping...';
                stopStatusPolling();
                setTimeout(() => {
                    commBatchScrapeBtn.textContent = 'Batch Scraper';
                    commBatchScrapeBtn.classList.remove('btn-danger');
                    commBatchScrapeBtn.classList.add('btn-warning');
                    if (commResumeBtn) commResumeBtn.style.display = 'inline-flex';
                }, 1500);
                return;
            }

            if (filteredPosts.length === 0) {
                showToast('No posts to scrape', 'warning');
                return;
            }

            // Determine the profile username
            const ownerCounts = {};
            filteredPosts.forEach(p => {
                const u = p.owner?.username || p.caption_user?.username;
                if (u) ownerCounts[u] = (ownerCounts[u] || 0) + 1;
            });
            const profileUsername = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

            const confirmMsg = `Scrape comments for ${filteredPosts.length} posts from @${profileUsername}?\n\nAlready-scraped posts will be skipped automatically.`;
            if (!confirm(confirmMsg)) return;

            // Switch to loading state
            commBatchScrapeBtn.textContent = 'Pause Scrape';
            commBatchScrapeBtn.classList.remove('btn-warning');
            commBatchScrapeBtn.classList.add('btn-danger');

            // Check backend status
            updateBackendStatus();

            // Prepare posts for the engine
            const posts = filteredPosts.map(p => ({
                shortcode: p.shortcode,
                comments_count: p.comments || 0,
            }));

            // Send START_BATCH_SCRAPE to background
            chrome.runtime.sendMessage({
                type: 'START_BATCH_SCRAPE',
                posts,
                profileUsername,
                postDelayMin: getPostDelayMin(),
            }, (response) => {
                if (response && response.success) {
                    console.log('[UI] Batch scrape started:', response);
                    if (response.alreadyScraped > 0) {
                        showToast(`${response.alreadyScraped} posts already scraped, queueing ${response.postsToScrape}`, 'info');
                    }
                    if (response.message === 'All posts already scraped') {
                        showToast('All posts already have comments!', 'success');
                        commBatchScrapeBtn.textContent = 'Batch Scraper';
                        commBatchScrapeBtn.classList.remove('btn-danger');
                        commBatchScrapeBtn.classList.add('btn-warning');
                        return;
                    }
                    startStatusPolling();
                } else {
                    showToast(`Scrape failed: ${response?.error || 'Unknown error'}`, 'error');
                    commBatchScrapeBtn.textContent = 'Batch Scraper';
                    commBatchScrapeBtn.classList.remove('btn-danger');
                    commBatchScrapeBtn.classList.add('btn-warning');
                }
            });
        });
    }

    // Resume button
    if (commResumeBtn) {
        commResumeBtn.addEventListener('click', () => {
            commResumeBtn.style.display = 'none';
            commBatchScrapeBtn.textContent = 'Pause Scrape';
            commBatchScrapeBtn.classList.remove('btn-warning');
            commBatchScrapeBtn.classList.add('btn-danger');

            chrome.runtime.sendMessage({
                type: 'RESUME_BATCH_SCRAPE',
                sessionId: null, // Will use saved state
            }, (response) => {
                if (response && response.success) {
                    showToast(`Resuming scrape: ${response.resumingPosts} posts remaining`, 'info');
                    startStatusPolling();
                } else {
                    showToast(`Resume failed: ${response?.error || 'No session to resume'}`, 'error');
                    commBatchScrapeBtn.textContent = 'Batch Scraper';
                    commBatchScrapeBtn.classList.remove('btn-danger');
                    commBatchScrapeBtn.classList.add('btn-warning');
                }
            });
        });
    }

    // Check for incomplete session on load
    chrome.runtime.sendMessage({ type: 'GET_SCRAPE_STATUS' }, (status) => {
        if (status && status.success && status.active) {
            // Scrape is currently running, show progress
            updateProgressUI(status);
            startStatusPolling();
            if (commBatchScrapeBtn) {
                commBatchScrapeBtn.textContent = 'Pause Scrape';
                commBatchScrapeBtn.classList.remove('btn-warning');
                commBatchScrapeBtn.classList.add('btn-danger');
            }
        } else if (status && status.success && status.status === 'paused') {
            // Show resume button
            if (commResumeBtn) commResumeBtn.style.display = 'inline-flex';
            updateProgressUI(status);
        }
    });

    // Update backend status on load and periodically
    updateBackendStatus();
    setInterval(updateBackendStatus, 30000);

    btnPrevPage.addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; renderPage(); }
    });

    btnNextPage.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE);
        if (currentPage < totalPages) { currentPage++; renderPage(); }
    });

    if (commBtnPrevPage) {
        commBtnPrevPage.addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; renderPage(); }
        });
    }

    if (commBtnNextPage) {
        commBtnNextPage.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE);
            if (currentPage < totalPages) { currentPage++; renderPage(); }
        });
    }

    function showLoading(isLoading) {
        loadingState.style.display = isLoading ? 'block' : 'none';
        if (commLoadingState) commLoadingState.style.display = isLoading ? 'block' : 'none';

        if (isLoading) {
            emptyState.style.display = 'none';
            if (commEmptyState) commEmptyState.style.display = 'none';

            postsGrid.innerHTML = '';
            if (commPostsGrid) commPostsGrid.innerHTML = '';

            paginationControls.style.display = 'none';
            if (commPaginationControls) commPaginationControls.style.display = 'none';
        }
    }

    function formatCompactNumber(num) {
        if (num === undefined || num === null) return '0';
        return num.toLocaleString();
    }

    function formatStatNumber(num) {
        if (num === undefined || num === null || isNaN(num)) return '0';
        const absoluteVal = Math.abs(num);
        if (absoluteVal >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + "B";
        if (absoluteVal >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
        if (absoluteVal >= 1_000) return (num / 1_000).toFixed(1) + "K";
        return num.toLocaleString();
    }

    function setStatValue(idOrEl, value) {
        let el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
        if (!el) return;

        // Store raw value
        el.dataset.value = value;
        
        // Initialize mode if not set
        if (!el.dataset.mode) el.dataset.mode = 'full';

        // Update display
        const num = Number(value);
        if (isNaN(num)) {
            el.textContent = value;
        } else {
            if (el.dataset.mode === 'short') {
                el.textContent = formatStatNumber(num);
            } else {
                el.textContent = num.toLocaleString();
            }
        }
    }

    // Copy text to the clipboard with a short toast; falls back to execCommand
    // for older/edge environments where navigator.clipboard is unavailable.
    function copyToClipboard(text, label) {
        const value = String(text);
        const done = () => showToast(`Copied ${label ?? value} to clipboard`, 'success', 1500);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(value).then(done).catch(() => legacyCopy(value, done));
                return;
            }
        } catch (e) { /* fall through to legacy path */ }
        legacyCopy(value, done);
    }

    function legacyCopy(value, done) {
        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (done) done();
        } catch (e) {
            showToast('Copy failed', 'error', 1500);
        }
    }

    // Wire a headline stat card: clicking it copies the precise value to the
    // clipboard AND toggles the display between full (193,200) and short (193.2K).
    // Idempotent — safe to call on every re-render (wires the listener once).
    function setupStatCopyToggle(valueId) {
        const el = document.getElementById(valueId);
        if (!el || el.dataset.copyToggle === '1') return; // wire once
        el.dataset.copyToggle = '1';

        const card = el.closest('.stat-card') || el;
        card.style.cursor = 'pointer';
        if (!card.title) card.title = 'Click to copy & toggle format';

        card.addEventListener('click', () => {
            const raw = el.dataset.value;
            const num = Number(raw);
            if (raw !== undefined && raw !== '' && !isNaN(num)) {
                // Copy precise digits (cleanest for pasting); toast shows the grouped number.
                copyToClipboard(String(num), num.toLocaleString());
                el.dataset.mode = el.dataset.mode === 'short' ? 'full' : 'short';
                el.textContent = el.dataset.mode === 'short' ? formatStatNumber(num) : num.toLocaleString();
            } else {
                copyToClipboard(el.textContent);
            }
        });
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // XLSX Export for comments with enrichment
    if (commBtnExportXlsx) {
        commBtnExportXlsx.addEventListener('click', async () => {
            if (filteredPosts.length === 0) {
                showToast('No posts to export comments from. Load a profile first.', 'warning');
                return;
            }

            const shortcodes = filteredPosts.map(p => p.shortcode);
            showToast(`Loading comments for ${shortcodes.length} posts...`, 'info');

            // Fetch comments from IndexedDB for ALL filtered posts
            chrome.runtime.sendMessage({ type: 'GET_COMMENTS_FOR_POSTS', shortcodes }, (response) => {
                if (!response || !response.success) {
                    showToast('Failed to retrieve comments from database.', 'error');
                    return;
                }

                if (response.comments.length === 0) {
                    showToast('No comments found in local database. Have you scraped them yet?', 'warning');
                    return;
                }

                // Enrich the comments
                const enriched = enrichComments(response.comments, filteredPosts);
                downloadAsXLSX(enriched);
            });
        });
    }

    function enrichComments(comments, posts) {
        // Build a lookup map for influencers
        const influencerMap = {};
        currentPartnersList.forEach(inf => {
            influencerMap[inf.username] = inf;
        });

        // Build a lookup map for posts
        const postMap = {};
        (posts || []).forEach(p => {
            postMap[p.shortcode] = p;
        });

        return comments.map(c => {
            const influencer = influencerMap[c.username];
            const post = postMap[c.post_shortcode] || {};

            const postLikes = parseInt(post.likes) || 0;
            const postComments = parseInt(post.comments) || 0;
            const totalEngagement = postLikes + postComments;
            const postUrl = post.postUrl || (c.post_shortcode ? `https://www.instagram.com/p/${c.post_shortcode}/` : '');

            // Owner info
            const ownerName = post.owner?.username || post.caption_user?.username || 'unknown';
            const ownerCached = globalProfilesDataset.find(p => p.username === ownerName);
            const ownerFollowers = post.owner?.follower_count || post.owner?.edge_followed_by?.count || ownerCached?.follower_count || 0;

            // Collaborator info (exclude the owner if they are also in the coauthors list)
            const coauthors = post.coauthors || [];
            const collabUsernames = coauthors
                .map(ca => ca.username)
                .filter(u => u && u !== ownerName)
                .join(', ');

            const collabFollowers = coauthors
                .filter(ca => ca.username && ca.username !== ownerName)
                .map(ca => {
                    const username = ca.username;
                    const cached = globalProfilesDataset.find(p => p.username === username);
                    const count = ca.follower_count || ca.edge_followed_by?.count || cached?.follower_count || 0;
                    return count.toLocaleString();
                }).join(', ');

            // Format comment timestamp
            let createdAt = c.timestamp || c.created_at || '';
            if (createdAt && typeof createdAt === 'number') {
                const ms = createdAt > 10000000000 ? createdAt : createdAt * 1000;
                createdAt = new Date(ms).toISOString();
            }

            // Format post timestamp
            let postCreatedAt = post.timestamp || post.taken_at || post.taken_at_timestamp || post.created_at || '';
            if (postCreatedAt && typeof postCreatedAt === 'number') {
                const postMs = postCreatedAt > 10000000000 ? postCreatedAt : postCreatedAt * 1000;
                postCreatedAt = new Date(postMs).toISOString();
            }

            return {
                'Post URL': postUrl,
                'Post Shortcode': c.post_shortcode || '',
                'Post Owner': ownerName,
                'Owner Followers': ownerFollowers,
                'Post Likes': postLikes,
                'Post Comments': postComments,
                'Post Classification': post.classification || 'Normal Post',
                'Total Engagement': totalEngagement,
                'Username': c.username || '',
                'Verified': influencer?.is_verified ? 'Yes' : 'No',
                'Comment Text': c.text || '',
                'Created At': createdAt,
                'Post Created Date': postCreatedAt,
                'Profile Pic URL': c.profilePic || c.profile_pic_url || '',
                'Comment ID': String(c.comment_id || c.id || ''),
                'User ID': String(c.userId || c.ownerId || c.user_id || '')
            };
        });
    }

    function downloadAsXLSX(data, customFilename) {
        if (typeof XLSX === 'undefined') {
            showToast('SheetJS (XLSX) library not loaded. Please refresh the page.', 'error');
            return;
        }

        try {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Scraped Data");

            // Auto-width for columns
            const colWidths = Object.keys(data[0] || {}).map(key => ({
                wch: Math.max(key.length, ...data.map(row => String(row[key] || '').length))
            }));
            ws['!cols'] = colWidths;

            const filename = customFilename || `insta_surfer_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
            XLSX.writeFile(wb, filename);
        } catch (err) {
            console.error('[XLSX Export Error]', err);
            showToast('Failed to generate XLSX file.', 'error');
        }
    }

    // Init
    loadLocalData();
    loadSettings();
    initCaptureLog();

    // Auto-load the active project on page load so Dataset Viewer & Commentator
    // show only that project's data without needing to click "Import to Local"
    chrome.storage.local.get(['extension_settings'], (result) => {
        const savedProjectId = result.extension_settings?.activeProjectId;
        if (savedProjectId) {
            // Load the project list and data automatically
            projLoadProjects();
        }
    });

    // Global click listener to close custom dropdowns
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.proj-role-dropdown.active').forEach(d => {
            d.classList.remove('active');
        });

        // Toggle stat value format
        const statEl = e.target.closest('.stat-value');
        if (statEl && statEl.dataset.value !== undefined) {
            const rawVal = Number(statEl.dataset.value);
            if (!isNaN(rawVal)) {
                if (statEl.dataset.mode === 'short') {
                    statEl.dataset.mode = 'full';
                    statEl.textContent = rawVal.toLocaleString();
                } else {
                    statEl.dataset.mode = 'short';
                    statEl.textContent = formatStatNumber(rawVal);
                }
            }
        }
    });

    // --- Capture Log (Phase 5) ---

    function initCaptureLog() {
        // Load past query discovery history
        chrome.storage.local.get(['graphql_queries', 'connectivity_logs'], (result) => {
            const queries = result.graphql_queries || {};
            const logs = result.connectivity_logs || [];

            // Merge and sort all loggable events
            const queryEntries = Object.values(queries).map(q => ({
                type: q.type,
                hash: q.queryHash,
                timestamp: q.discoveredAt,
                logType: 'query'
            }));

            const connectivityEntries = logs.map(l => ({
                status: l.status,
                url: l.url,
                detail: l.detail,
                timestamp: l.timestamp,
                logType: 'connectivity'
            }));

            const allEntries = [...queryEntries, ...connectivityEntries]
                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                .slice(0, 100);

            if (allEntries.length > 0 && consoleEmpty) {
                consoleEmpty.style.display = 'none';
            }

            allEntries.forEach(e => {
                if (e.logType === 'query') {
                    addConsoleEntry('posts', e.hash, 0, e.timestamp, false);
                } else {
                    addConnectivityEntry(e.status, e.url, e.detail, e.timestamp, false);
                }
            });
        });

        // _suppressStorageReload is declared in outer scope so projImportToLocal() can access it

        // Listen for real-time storage changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;

            if (changes.connectivity_logs) {
                const newLogs = changes.connectivity_logs.newValue;
                const oldLogs = changes.connectivity_logs.oldValue || [];
                // If we have a new log at the top, add it
                if (newLogs && newLogs.length > 0 && (oldLogs.length === 0 || newLogs[0].id !== oldLogs[0].id)) {
                    const l = newLogs[0];
                    addConnectivityEntry(l.status, l.url, l.detail, l.timestamp, true);
                }
            }

            if (changes.capture_stats) {
                const newStats = changes.capture_stats.newValue;
                const oldStats = changes.capture_stats.oldValue || {};
                const diff = (newStats?.totalCaptured || 0) - (oldStats?.totalCaptured || 0);

                if (diff > 0) {
                    addConsoleEntry('posts', null, diff, Date.now(), true);

                    // Update live dot
                    if (consoleLiveDot) consoleLiveDot.classList.add('live');
                }
            }

            if (changes.capture_state) {
                renderCaptureToggle(changes.capture_state.newValue);
            }

            if (changes.posts_store) {
                // Reload data when PostsStore changes (e.g. from background capture)
                // Skip if an import is in progress to avoid race condition
                if (!_suppressStorageReload) loadLocalData();
            }
        });

        // Clear console button
        if (btnClearConsole) {
            btnClearConsole.addEventListener('click', () => {
                if (consoleBody) {
                    consoleBody.innerHTML = '<div class="console-empty" id="console-empty">Log cleared.</div>';
                }
            });
        }
    }

    function addConnectivityEntry(status, url, detail, timestamp, highlight) {
        if (!consoleBody) return;
        const empty = consoleBody.querySelector('.console-empty');
        if (empty) empty.style.display = 'none';

        const entry = document.createElement('div');
        entry.className = 'console-entry';
        if (highlight) entry.style.background = 'rgba(102, 126, 234, 0.06)';
        if (status === 'unreachable') entry.style.borderLeft = '3px solid #ef4444';
        else entry.style.borderLeft = '3px solid #10b981';

        const time = new Date(timestamp || Date.now());
        const timeStr = time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const statusLabel = status === 'connected' ?
            '<span style="color: #10b981; font-weight: bold;">[CONNECTED]</span>' :
            '<span style="color: #ef4444; font-weight: bold;">[UNREACHABLE]</span>';

        let details = ` | ${url}`;
        if (detail) details += ` | <span style="color: #a1a1aa;">${detail}</span>`;

        entry.innerHTML = `<span class="timestamp">[${timeStr}]</span> ${statusLabel}${details}`;
        consoleBody.insertBefore(entry, consoleBody.firstChild);

        while (consoleBody.children.length > 200) {
            consoleBody.removeChild(consoleBody.lastChild);
        }
    }

    function addConsoleEntry(type, queryHash, count, timestamp, highlight) {
        if (!consoleBody) return;

        // Hide empty state
        const empty = consoleBody.querySelector('.console-empty');
        if (empty) empty.style.display = 'none';

        const entry = document.createElement('div');
        entry.className = 'console-entry';
        if (highlight) entry.style.background = 'rgba(102, 126, 234, 0.06)';

        const time = new Date(timestamp || Date.now());
        const timeStr = time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        let details = '';
        if (queryHash) details += ` | hash: ${queryHash.substring(0, 8)}…`;
        if (count > 0) details += ` | <span class="count">+${count} posts captured</span>`;

        entry.innerHTML = `<span class="timestamp">[${timeStr}]</span> Query type: <span class="type-label">${type}</span>${details}`;

        // Prepend (newest first)
        consoleBody.insertBefore(entry, consoleBody.firstChild);

        // Keep max 200 entries
        while (consoleBody.children.length > 200) {
            consoleBody.removeChild(consoleBody.lastChild);
        }
    }

    // ======================== Projects Tab ========================

    const projSelect = document.getElementById('proj-select');
    const projBtnNew = document.getElementById('proj-btn-new');
    const compBtnNewProj = document.getElementById('comp-btn-new-proj');
    const projBtnRefresh = document.getElementById('proj-btn-refresh');
    const projBtnSyncDb = document.getElementById('proj-btn-sync-db');
    const projBtnAssignUnassigned = document.getElementById('proj-btn-assign-unassigned');
    const projBtnImportToLocal = document.getElementById('proj-btn-import-to-local');
    const projBtnDelete = document.getElementById('proj-btn-delete');
    const projStatProfiles = document.getElementById('proj-stat-profiles');
    const projStatPosts = document.getElementById('proj-stat-posts');
    const projStatComments = document.getElementById('proj-stat-comments');
    const projStatReach = document.getElementById('proj-stat-reach');
    const projStatCollabPosts = document.getElementById('proj-stat-collab-posts');
    const projStatCollabs = document.getElementById('proj-stat-collabs');
    const projStatPaid = document.getElementById('proj-stat-paid');
    const projReachBreakdown = document.getElementById('proj-reach-breakdown');
    const projReachBars = document.getElementById('proj-reach-bars');
    const projProfilesGrid = document.getElementById('proj-profiles-grid');
    const projProfilesEmpty = document.getElementById('proj-profiles-empty');
    const projPostsGrid = document.getElementById('proj-posts-grid');
    const projPostsEmpty = document.getElementById('proj-posts-empty');
    const projLoading = document.getElementById('proj-loading');
    const projPagination = document.getElementById('proj-pagination');
    const projPageIndicator = document.getElementById('proj-page-indicator');
    const projBtnPrev = document.getElementById('proj-btn-prev');
    const projBtnNext = document.getElementById('proj-btn-next');
    const projBtnExportCsv = document.getElementById('proj-btn-export-csv');

    // Profiles collapsible and filter elements
    const projProfilesHeader = document.getElementById('proj-profiles-header');
    const projProfilesContent = document.getElementById('proj-profiles-content');
    const projProfilesToggleIcon = document.getElementById('proj-profiles-toggle-icon');
    const projBtnResetFilter = document.getElementById('proj-btn-reset-filter');

    // Create project modal
    const projCreateModal = document.getElementById('proj-create-modal');
    const projModalClose = document.getElementById('proj-modal-close');
    const projNewName = document.getElementById('proj-new-name');
    const projNewDesc = document.getElementById('proj-new-desc');
    const projBtnCreateSubmit = document.getElementById('proj-btn-create-submit');
    const projBtnCreateCancel = document.getElementById('proj-btn-create-cancel');
    const projCreateError = document.getElementById('proj-create-error');

    // Competitive Analysis elements
    const compBrandSelect = document.getElementById('comp-brand-select');
    const compAddCompetitor = document.getElementById('comp-add-competitor');
    const compSearchInput = document.getElementById('comp-search-input');
    const compSearchResults = document.getElementById('comp-search-results');
    const compCompetitorChips = document.getElementById('comp-competitor-chips');
    const compCompetitorCount = document.getElementById('comp-competitor-count');
    const compBtnLoad = document.getElementById('comp-btn-load');
    const compBtnRefresh = document.getElementById('comp-btn-refresh');
    const compBtnReset = document.getElementById('comp-btn-reset');
    const compLoading = document.getElementById('comp-loading');
    const compEmptyState = document.getElementById('comp-empty-state');
    const compDashboard = document.getElementById('comp-dashboard');
    const compChartCanvas = document.getElementById('comp-chart-canvas');
    const compChartMetric = document.getElementById('comp-chart-metric');
    const compChartInterval = document.getElementById('comp-chart-interval');
    const compChartLegend = document.getElementById('comp-chart-legend');

    const compBreakdownToggle = document.getElementById('comp-breakdown-toggle');
    const compBreakdownContent = document.getElementById('comp-breakdown-content');
    const compBreakdownIcon = document.getElementById('comp-breakdown-icon');
    const compBreakdownDownload = document.getElementById('comp-breakdown-download');
    const compBreakdownDownloadChart = document.getElementById('comp-breakdown-download-chart');

    if (compBreakdownToggle) {
        compBreakdownToggle.addEventListener('click', () => {
            const isHidden = compBreakdownContent.style.display === 'none';
            compBreakdownContent.style.display = isHidden ? 'block' : 'none';
            compBreakdownIcon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
            if (compBreakdownDownload) {
                compBreakdownDownload.style.display = isHidden ? 'inline-block' : 'none';
            }
        });
    }

    if (compBreakdownDownload) {
        compBreakdownDownload.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!window.html2canvas) {
                showToast('Image export library not loaded.', 'error');
                return;
            }
            try {
                compBreakdownDownload.innerHTML = '⏱️ Rendering...';
                compBreakdownDownload.disabled = true;
                
                // Temporarily ensure content is visible and fully expanded for capture
                const originalMaxHeight = compBreakdownContent.style.maxHeight;
                compBreakdownContent.style.maxHeight = 'none';

                const canvas = await html2canvas(compBreakdownContent, {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-surface').trim() || '#1e1e2e',
                    windowWidth: document.body.scrollWidth,
                    windowHeight: document.body.scrollHeight
                });
                
                compBreakdownContent.style.maxHeight = originalMaxHeight;

                const link = document.createElement('a');
                link.download = `InstaSurfer_Comp_Analysis_${new Date().toISOString().split('T')[0]}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
                showToast('Image downloaded successfully!', 'success');
            } catch(error) {
                console.error('html2canvas error:', error);
                showToast('Failed to generate image.', 'error');
            } finally {
                compBreakdownDownload.innerHTML = '📸 Download Image';
                compBreakdownDownload.disabled = false;
            }
        });
    }

    if (compBreakdownDownloadChart) {
        compBreakdownDownloadChart.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!window.html2canvas) {
                showToast('Image export library not loaded.', 'error');
                return;
            }
            try {
                compBreakdownDownloadChart.innerHTML = '⏱️ Rendering...';
                compBreakdownDownloadChart.disabled = true;

                // Find the parent section that contains the chart and legend
                const chartSection = compBreakdownDownloadChart.closest('.comp-section');

                const canvas = await html2canvas(chartSection, {
                    scale: 2,
                    useCORS: true,
                    backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-surface').trim() || '#1e1e2e',
                    ignoreElements: (el) => {
                        // Ignore the download button itself and the interval/metric selectors inside the section
                        return el === compBreakdownDownloadChart || el.tagName === 'SELECT' || el.id === 'comp-btn-edit-colors';
                    }
                });

                const link = document.createElement('a');
                link.download = `InstaSurfer_Chart_${new Date().toISOString().split('T')[0]}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
                showToast('Chart image downloaded successfully!', 'success');
            } catch(error) {
                console.error('html2canvas error:', error);
                showToast('Failed to generate chart image.', 'error');
            } finally {
                compBreakdownDownloadChart.innerHTML = '📸 Download Image';
                compBreakdownDownloadChart.disabled = false;
            }
        });
    }

    // Competitive Analysis - Project selector elements
    const compProjSelect = document.getElementById('comp-proj-select');
    const compProjBtnNew = document.getElementById('comp-proj-btn-new');
    const compProjBtnRefresh = document.getElementById('comp-proj-btn-refresh');
    const compProjBtnImportToLocal = document.getElementById('comp-proj-btn-import-to-local');
    const compProjBtnDelete = document.getElementById('comp-proj-btn-delete');

    let projCurrentPage = 1;
    const PROJ_PER_PAGE = 24;
    let projPostsData = [];
    let projProfilesData = [];
    let projActiveProfileFilter = null;
    let projCurrentProjectId = null;

    // Competitive Analysis state
    let compSelectedBrand = null;
    let compSelectedCompetitors = [];
    let compDashboardData = null;
    // Full profile list backing the brand/competitor selectors — kept in sync by
    // comp_initSelectors / comp_initSelectorsFromLocal so the search box can filter it.
    let compAllProfiles = [];
    let compTimeseriesData = null;
    let compCollabsData = null;
    let compChartInstance = null;
    let compStartDate = null;  // ISO date string e.g. '2025-01-01' or null (all time)
    let compEndDate = null;
    let compActivePreset = 'all';
    let compCustomColors = {};  // { username: '#hexcolor' } — user overrides
    let compColorEditMode = false;
    // const COMP_COLORS = [
    //     '#2ac3c5', // Teal — primary / brand
    //     '#6f5ed3', // Purple — Comp 1
    //     '#ce3665', // Pink/Red — Comp 2
    //     '#ffcd1c', // Yellow — Comp 3
    //     '#4A90E2', // Blue — additional neutral
    // ];


    const COMP_COLORS = [
        '#2ac3c5', // Teal — primary / brand
        '#ffcd1c', // Yellow — Comp 2
        '#ce3665', // Pink/Red — Comp 1
        '#4A90E2', // Blue — Comp 3
        '#6f5ed3', // Purple — additional neutral
    ];
    // Get color for a username: custom override → default by index
    function comp_getColor(username, index) {
        return compCustomColors[username] || COMP_COLORS[index] || '#94a3b8';
    }

    // Build ordered color map for all selected profiles
    function comp_getColorMap() {
        const ordered = [compSelectedBrand, ...compSelectedCompetitors].filter(Boolean);
        const map = {};
        ordered.forEach((u, i) => { map[u] = comp_getColor(u, i); });
        return map;
    }

    // Load saved custom colors from storage
    chrome.storage.local.get(['comp_custom_colors'], (result) => {
        if (result.comp_custom_colors) compCustomColors = result.comp_custom_colors;
    });

    // project 1 tab
    const ROLE_COLORS = {
        get brand() { const isLight = document.body.classList.contains('light-theme'); return { bg: 'rgba(99, 102, 241, 0.15)', color: isLight ? '#4f46e5' : '#818cf8', icon: '🏢', label: 'Brand' }; },
        get competitor() { const isLight = document.body.classList.contains('light-theme'); return { bg: 'rgba(239, 68, 68, 0.15)', color: isLight ? '#dc2626' : '#f87171', icon: '🐰', label: 'Competitor' }; },
        get creator() { const isLight = document.body.classList.contains('light-theme'); return { bg: 'rgba(34, 197, 94, 0.15)', color: isLight ? '#16a34a' : '#4ade80', icon: '🎭', label: 'Creator' }; },
        get influencer() { const isLight = document.body.classList.contains('light-theme'); return { bg: 'rgba(251, 191, 36, 0.15)', color: isLight ? '#d97706' : '#fbbf24', icon: '⭐', label: 'Influencer' }; },
        get tracked() { const isLight = document.body.classList.contains('light-theme'); return { bg: 'rgba(148, 163, 184, 0.12)', color: isLight ? '#475569' : '#94a3b8', icon: '👁️', label: 'Tracked' }; }
    };

    // --- Helper: get API credentials from storage ---
    async function getApiCredentials() {
        return new Promise(resolve => {
            chrome.storage.local.get(['extension_settings'], (result) => {
                const settings = result.extension_settings || {};
                const token = settings.token;
                const apiUrl = CONFIG.normalizeUrl(settings.apiUrl || CONFIG.DEFAULT_API_URL);
                resolve({ token, apiUrl });
            });
        });
    }

    // --- Load projects list ---
    async function projLoadProjects() {
        const { token, apiUrl } = await getApiCredentials();
        if (!token) {
            projSelect.innerHTML = '<option disabled selected>Not logged in</option>';
            if (compProjSelect) compProjSelect.innerHTML = '<option disabled selected>Not logged in</option>';
            return;
        }

        try {
            const res = await fetch(`${apiUrl}/api/projects`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!data.success) return;

            projSelect.innerHTML = '';
            if (compProjSelect) compProjSelect.innerHTML = '';
            if (data.projects.length === 0) {
                projSelect.innerHTML = '<option disabled selected>No projects \u2014 click \"+ New Project\"</option>';
                if (compProjSelect) compProjSelect.innerHTML = '<option disabled selected>No projects \u2014 click \"+ New Project\"</option>';
                return;
            }

            // Restore previously selected project
            const stored = await new Promise(r => chrome.storage.local.get(['extension_settings'], r));
            const savedId = stored.extension_settings?.activeProjectId;

            for (const proj of data.projects) {
                const opt = document.createElement('option');
                opt.value = proj.id;
                const collabInfo = proj.collab_post_count ? `, ${proj.collab_post_count} collabs` : '';
                opt.textContent = `${proj.name} (${proj.post_count || 0} posts, ${proj.profile_count || 0} profiles${collabInfo})`;
                if (String(proj.id) === String(savedId)) opt.selected = true;
                projSelect.appendChild(opt);

                // Also populate the Competitive Analysis project selector
                if (compProjSelect) compProjSelect.appendChild(opt.cloneNode(true));
            }

            // Explicitly set both dropdowns to the saved project
            if (savedId) {
                projSelect.value = String(savedId);
                if (compProjSelect) compProjSelect.value = String(savedId);
            }

            // Auto-load the selected project
            if (projSelect.value) {
                projLoadProjectData(projSelect.value);
            }
        } catch (err) {
            console.error('[Projects] Load error:', err);
            showToast('Failed to load projects from server.', 'error');
        }
    }

    // Fetch every post of a project by paging through the /posts endpoint
    // (which caps each response via LIMIT). Returns the same shape as one page:
    // { success, posts, total }.
    async function fetchAllProjectPosts(apiUrl, projectId, token) {
        const PAGE_SIZE = 500;
        const headers = { 'Authorization': `Bearer ${token}` };
        let offset = 0;
        let total = Infinity;
        const allPosts = [];

        try {
            while (offset < total) {
                const res = await fetch(
                    `${apiUrl}/api/projects/${projectId}/posts?limit=${PAGE_SIZE}&offset=${offset}`,
                    { headers }
                );
                if (!res.ok) break;
                const page = await res.json();
                if (!page.success || !Array.isArray(page.posts)) break;

                allPosts.push(...page.posts);
                total = typeof page.total === 'number' ? page.total : allPosts.length;

                // Guard against an endpoint that ignores offset (would loop forever)
                if (page.posts.length === 0) break;
                offset += page.posts.length;
            }
            return { success: true, posts: allPosts, total: Number.isFinite(total) ? total : allPosts.length };
        } catch (err) {
            console.warn('[Projects] fetchAllProjectPosts error:', err);
            // Return whatever we managed to collect rather than failing the whole load
            return { success: allPosts.length > 0, posts: allPosts, total: allPosts.length };
        }
    }

    // --- Load project data (stats + profiles + posts) ---
    async function projLoadProjectData(projectId) {
        if (!projectId) return;
        projCurrentProjectId = String(projectId);
        const { token, apiUrl } = await getApiCredentials();
        if (!token) return;

        // Show loading
        if (projLoading) projLoading.style.display = 'block';
        if (projPostsEmpty) projPostsEmpty.style.display = 'none';
        if (projProfilesEmpty) projProfilesEmpty.style.display = 'none';
        projPostsGrid.innerHTML = '';
        projProfilesGrid.innerHTML = '';

        try {
            // Fetch stats + profiles in parallel; posts are fetched separately with
            // pagination so we load the ENTIRE project (the /posts endpoint caps each
            // page via LIMIT — a single limited fetch truncated large projects).
            const [statsRes, profilesRes] = await Promise.all([
                fetch(`${apiUrl}/api/projects/${projectId}/stats`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${apiUrl}/api/projects/${projectId}/profiles`, { headers: { 'Authorization': `Bearer ${token}` } }),
            ]);

            const [statsData, profiles, posts] = await Promise.all([
                statsRes.ok ? statsRes.json() : { success: false },
                profilesRes.ok ? profilesRes.json() : { success: false },
                fetchAllProjectPosts(apiUrl, projectId, token)
            ]);

            // Reset competitive selectors when loading new project
            compSelectedBrand = null;
            compSelectedCompetitors = [];
            compDashboardData = null;
            compTimeseriesData = null;
            compCollabsData = null;
            if (compChartInstance) { compChartInstance.destroy(); compChartInstance = null; }
            if (compDashboard) compDashboard.style.display = 'none';
            if (compEmptyState) compEmptyState.style.display = 'block';
            if (compCompetitorChips) compCompetitorChips.innerHTML = '';
            if (compCompetitorCount) compCompetitorCount.textContent = '0/3';

            // Update stats
            if (statsData.success && statsData.stats) {
                const s = statsData.stats;
                projStatProfiles.textContent = (s.profiles || 0).toLocaleString();
                projStatPosts.textContent = (s.posts || 0).toLocaleString();
                projStatComments.textContent = (s.comments || 0).toLocaleString();
                projStatReach.textContent = formatReach(s.reach || 0);
                if (projStatCollabPosts) projStatCollabPosts.textContent = (s.collabPosts || 0).toLocaleString();
                if (projStatCollabs) projStatCollabs.textContent = (s.collaborations || 0).toLocaleString();
                if (projStatPaid) projStatPaid.textContent = (s.paidPartnerships || 0).toLocaleString();

                // Render reach by role breakdown
                projRenderReachBreakdown(s.reachByRole || [], s.reach || 0);
            }

            // Render profiles
            projProfilesData = (profiles.success && profiles.profiles) ? profiles.profiles : [];
            projRenderProfiles(projProfilesData);
            comp_initSelectors(projProfilesData);

            // Merge project profiles into globalProfilesDataset so
            // calculateCollectiveReach can look up follower_count for each influencer.
            for (const pp of projProfilesData) {
                const idx = globalProfilesDataset.findIndex(g => g.username === pp.username);
                if (idx !== -1) {
                    // Update existing entry with richer data from project
                    Object.assign(globalProfilesDataset[idx], pp);
                } else {
                    globalProfilesDataset.push({ ...pp });
                }
            }

            // Store and sync posts with Commentator
            projPostsData = (posts.success && posts.posts) ? posts.posts : [];

            // Convert to local format and sync allPosts
            const normalizedProjectPosts = projPostsData.map(p => {
                let likes = 0, comments = 0;
                if (p.latest_metrics && Array.isArray(p.latest_metrics) && p.latest_metrics[0]) {
                    likes = p.latest_metrics[0].likes || 0;
                    comments = p.latest_metrics[0].comments || 0;
                }

                // Look up owner's follower_count from profiles data for reach calculations
                const ownerProfile = projProfilesData.find(pr => pr.username === p.owner_username);
                const ownerFollowers = ownerProfile?.follower_count || 0;

                return normalizePostData({
                    shortcode: p.shortcode,
                    postUrl: p.post_url || `https://www.instagram.com/p/${p.shortcode}/`,
                    caption: p.caption || '',
                    imageUrl: p.image_url || null,
                    videoUrl: p.video_url || null,
                    isVideo: p.is_video || false,
                    isCarousel: p.is_carousel || false,
                    isPaid: p.is_paid || false,
                    classification: p.classification || 'Normal Post',
                    type: p.type || 'normal',
                    likes,
                    comments,
                    timestamp: p.posted_at ? Math.floor(new Date(p.posted_at).getTime() / 1000) : null,
                    owner: { username: p.owner_username, follower_count: ownerFollowers },
                    collectiveReach: p.collective_reach || 0,
                    reachBreakdown: p.reach_breakdown || [],
                    scrapedFromProfile: p.scraped_from_profile || p.owner_username,
                    is_reference: p.is_reference || false,
                    // Collaborator data from server (enriched by post_relations)
                    coauthors: p.coauthors || [],
                    coauthor_producers: p.coauthors || [],  // alias used by partnership breakdown
                    sponsors: p.sponsors || [],
                    sponsor_tags: p.sponsors || [],          // alias used by some renderers
                    tagged_users: p.tagged_users || [],
                    caption_user: p.caption_user || null,
                });
            });

            allPosts = normalizedProjectPosts;

            // Merge server posts into PostsStore and assign to project
            _suppressStorageReload = true;
            try {
                await PostsStore.mergeProjectPosts(normalizedProjectPosts, projCurrentProjectId);

                // Re-derive the viewer's posts from the LOCAL store rather than the
                // raw server response. A freshly-created project returns few/zero
                // posts from the server, but posts captured locally are already
                // assigned to this project in PostsStore (auto-assigned on capture,
                // see background.js). Reading the store keeps those captured-but-
                // not-yet-saved posts visible in the Dataset Viewer until the user
                // clicks "Save to DB" — instead of them flashing then disappearing
                // when the empty server list overwrote allPosts. Matches loadLocalData.
                const localProjectPosts = await PostsStore.getProjectPosts(projCurrentProjectId);
                if (localProjectPosts.length > 0) {
                    allPosts = localProjectPosts.map(normalizePostData);
                }
            } catch (storeErr) {
                console.warn('[Projects] PostsStore merge error:', storeErr);
            }
            _suppressStorageReload = false;

            // Legacy posts_dataset dual-write REMOVED — PostsStore is the single source of truth

            // Refresh Commentator and Viewer tabs
            activeProfileFilter = null; // Reset filter for fresh start
            activeClassFilter = 'all'; // Reset classification filter
            activeScrapeFilter = 'all'; // Reset scrape filter
            
            // Reset classification UI chips
            document.querySelectorAll('.class-filter-chip, .comm-class-filter-chip').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-filter') === 'all');
            });
            document.querySelectorAll('.comm-scrape-filter-chip').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-scrape-filter') === 'all');
            });

            // Persist project profiles to storage so reach data survives refresh.
            // Read-merge-write against storage (not the in-memory globalProfilesDataset)
            // so this doesn't depend on the earlier in-memory merge having already run —
            // and merge by username instead of replacing, so locally-captured profiles
            // not yet saved to the DB keep their follower counts (that's what was
            // zeroing out Potential Impressions for not-yet-saved collaborators).
            if (projProfilesData.length > 0) {
                await new Promise((resolve) => {
                    chrome.storage.local.get(['profiles_dataset'], (result) => {
                        const existing = result.profiles_dataset || [];
                        for (const pp of projProfilesData) {
                            const idx = existing.findIndex(g => g.username === pp.username);
                            if (idx !== -1) {
                                Object.assign(existing[idx], pp);
                            } else {
                                existing.push({ ...pp });
                            }
                        }
                        chrome.storage.local.set({ profiles_dataset: existing }, () => {
                            globalProfilesDataset = existing;
                            resolve();
                        });
                    });
                });
            }

            processData();

            // Render Project grid
            projRenderPosts();

        } catch (err) {
            console.error('[Projects] Load data error:', err);
            showToast('Failed to load project data.', 'error');
        } finally {
            if (projLoading) projLoading.style.display = 'none';
        }
    }

    // --- Render reach breakdown by role ---
    function projRenderReachBreakdown(reachByRole, totalReach) {
        if (!projReachBreakdown || !projReachBars) return;
        if (!reachByRole || reachByRole.length === 0) {
            projReachBreakdown.style.display = 'none';
            return;
        }
        projReachBreakdown.style.display = 'block';
        projReachBars.innerHTML = '';

        for (const entry of reachByRole) {
            const roleInfo = ROLE_COLORS[entry.role] || ROLE_COLORS.tracked;
            const pct = totalReach > 0 ? Math.round((entry.reach / totalReach) * 100) : 0;

            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 10px;';
            row.innerHTML = `
                <span style="min-width: 100px; font-size: 0.85em; color: ${roleInfo.color};">${roleInfo.label} (${entry.count})</span>
                <div style="flex: 1; background: rgba(255,255,255,0.06); border-radius: 6px; height: 22px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${roleInfo.bg}; border: 1px solid ${roleInfo.color}; border-radius: 6px; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; min-width: 40px;">
                        <span style="font-size: 0.75em; color: ${roleInfo.color};">${formatReach(entry.reach)}</span>
                    </div>
                </div>
                <span style="font-size: 0.8em; color: var(--text-muted); min-width: 35px; text-align: right;">${pct}%</span>
            `;
            projReachBars.appendChild(row);
        }
    }

    function formatReach(num) {
        const val = num || 0;
        if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
        if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
        return val.toLocaleString();
    }

    // --- Render profiles ---
    function projRenderProfiles(profiles) {
        projProfilesGrid.innerHTML = '';
        if (profiles.length === 0) {
            if (projProfilesEmpty) projProfilesEmpty.style.display = 'block';
            return;
        }
        if (projProfilesEmpty) projProfilesEmpty.style.display = 'none';

        for (const p of profiles) {
            const card = document.createElement('div');
            card.className = 'proj-profile-card';
            if (projActiveProfileFilter === p.username) {
                card.style.borderColor = 'var(--primary)';
                card.style.boxShadow = '0 0 0 1px var(--primary)';
            }

            const roleKey = p.project_role || 'tracked';
            const roleInfo = ROLE_COLORS[roleKey] || ROLE_COLORS.tracked;
            const isPinned = p.pinned || false;
            const postCount = parseInt(p.post_count) || 0;

            const firstLetter = (p.username || '?')[0].toUpperCase();
            const avatarContent = p.profile_pic_url
                ? `<img src="${p.profile_pic_url}" alt="${escapeHtml(p.username)}">`
                : firstLetter;

            // Build custom dropdown menu items
            let menuItemsHtml = '';
            for (const [key, info] of Object.entries(ROLE_COLORS)) {
                menuItemsHtml += `
                    <div class="proj-role-item ${key === roleKey ? 'active' : ''}" data-role="${key}">
                        <span class="icon">${info.icon}</span>
                        <span>${info.label}</span>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="profile-card-top">
                    <div class="avatar">${avatarContent}</div>
                    <div class="info">
                        <div class="username">
                            @${escapeHtml(p.username)}
                            ${p.is_verified ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="#3b82f6" style="flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' : ''}
                        </div>
                        <div class="followers">${formatReach(p.follower_count || 0)} followers · ${postCount} posts</div>
                    </div>
                    
                    <div class="profile-card-actions">
                        <button class="proj-pin-btn" title="${isPinned ? 'Unpin' : 'Pin'} profile" style="opacity: ${isPinned ? 1 : 0.4};">📌</button>
                        <button class="proj-ig-link" title="Open in Instagram">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        </button>
                        <button class="proj-remove-btn" title="Remove from project">✕</button>
                        
                        <div class="proj-role-dropdown" id="role-dropdown-${p.username}">
                            <div class="proj-role-pill" style="border-color: ${roleInfo.color}; color: ${roleInfo.color}; background: ${roleInfo.bg};">
                                <span>${roleInfo.icon} ${roleInfo.label}</span>
                                <span class="arrow">▼</span>
                            </div>
                            <div class="proj-role-menu">
                                ${menuItemsHtml}
                            </div>
                        </div>
                    </div>
                </div>
            `;
            card.style.cursor = 'pointer';

            // Open IG link
            const igLink = card.querySelector('.proj-ig-link');
            igLink.onclick = (e) => {
                e.stopPropagation();
                window.open(`https://www.instagram.com/${p.username}/`, '_blank');
            };

            // Pin/Unpin
            const pinBtn = card.querySelector('.proj-pin-btn');
            pinBtn.onclick = async (e) => {
                e.stopPropagation();
                await projTogglePin(p.username);
            };

            // Remove from project
            const removeBtn = card.querySelector('.proj-remove-btn');
            removeBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Remove @${p.username} from this project?`)) {
                    await projRemoveProfile(p.username);
                }
            };

            // Custom Dropdown Logic
            const dropdown = card.querySelector('.proj-role-dropdown');
            const pill = dropdown.querySelector('.proj-role-pill');

            pill.onclick = (e) => {
                e.stopPropagation();
                // Close other open dropdowns first
                document.querySelectorAll('.proj-role-dropdown.active').forEach(d => {
                    if (d !== dropdown) d.classList.remove('active');
                });
                dropdown.classList.toggle('active');
            };

            const menuItems = dropdown.querySelectorAll('.proj-role-item');
            menuItems.forEach(item => {
                item.onclick = async (e) => {
                    e.stopPropagation();
                    const newRole = item.dataset.role;
                    dropdown.classList.remove('active');
                    if (newRole !== roleKey) {
                        await projChangeRole(p.username, newRole);
                    }
                };
            });

            // Filter logic
            card.onclick = (e) => {
                // Ignore clicks if they started inside the actions or dropdown
                if (e.target.closest('.profile-card-actions')) return;

                if (projActiveProfileFilter === p.username) {
                    projActiveProfileFilter = null; // Toggle off
                } else {
                    projActiveProfileFilter = p.username;
                }
                projBtnResetFilter.style.display = projActiveProfileFilter ? 'block' : 'none';
                projCurrentPage = 1;
                projRenderProfiles(projProfilesData); // Re-render to update active styling
                projRenderPosts();
            };

            projProfilesGrid.appendChild(card);
        }
    }

    // ======================== Competitive Analysis Dashboard ========================

    function comp_initSelectors(profiles) {
        if (!compBrandSelect || !compAddCompetitor) return;

        compBrandSelect.innerHTML = '<option value="" disabled selected>Select brand...</option>';
        compAddCompetitor.innerHTML = '<option value="" disabled selected>+ Add competitor...</option>';

        const sorted = [...profiles].sort((a, b) => (b.follower_count || 0) - (a.follower_count || 0));
        compAllProfiles = sorted;
        comp_renderSearchResults(compSearchInput ? compSearchInput.value : '');
        for (const p of sorted) {
            const roleKey = p.project_role || 'tracked';
            const roleInfo = ROLE_COLORS[roleKey] || ROLE_COLORS.tracked;

            const opt1 = document.createElement('option');
            opt1.value = p.username;
            opt1.textContent = `${roleInfo.icon} @${p.username} (${formatReach(p.follower_count || 0)})`;
            compBrandSelect.appendChild(opt1);

            const opt2 = opt1.cloneNode(true);
            compAddCompetitor.appendChild(opt2);
        }

        // Try to restore pinned selections first
        chrome.storage.local.get(['comp_pinned'], (result) => {
            const pinned = result.comp_pinned;
            let restored = false;

            if (pinned && String(pinned.projectId) === String(projCurrentProjectId)) {
                // Restore brand
                if (pinned.brand && sorted.find(p => p.username === pinned.brand)) {
                    compBrandSelect.value = pinned.brand;
                    compSelectedBrand = pinned.brand;
                    restored = true;
                }
                // Restore competitors
                if (pinned.competitors && pinned.competitors.length > 0) {
                    compSelectedCompetitors = [];
                    if (compCompetitorChips) compCompetitorChips.innerHTML = '';
                    for (const cu of pinned.competitors) {
                        if (sorted.find(p => p.username === cu)) {
                            comp_addCompetitor(cu);
                        }
                    }
                }
                // Auto-load dashboard with restored selections
                if (restored) {
                    comp_loadDashboard();
                    return;
                }
            }

            // Fallback: pre-select by role if no pinned state
            const brandProfile = sorted.find(p => p.project_role === 'brand');
            if (brandProfile) {
                compBrandSelect.value = brandProfile.username;
                compSelectedBrand = brandProfile.username;
            }

            compSelectedCompetitors = [];
            if (compCompetitorChips) compCompetitorChips.innerHTML = '';
            const compProfiles = sorted.filter(p => p.project_role === 'competitor');
            for (const cp of compProfiles.slice(0, 3)) {
                comp_addCompetitor(cp.username);
            }
        });
    }

    // --- Local-mode selector population (no project required) ---
    function comp_initSelectorsFromLocal() {
        if (!compBrandSelect || !compAddCompetitor) return;
        // Only run if selectors are empty (no project has populated them)
        if (compBrandSelect.options.length > 1) return;

        // Build unique profiles from allPosts owners + globalProfilesDataset
        const profileMap = {};
        allPosts.forEach(p => {
            const username = p.scrapedFromProfile || p.owner?.username || p.caption_user?.username;
            if (username && !profileMap[username]) {
                profileMap[username] = { username, follower_count: 0 };
            }
        });
        // Enrich with globalProfilesDataset follower counts & merge any extra profiles
        globalProfilesDataset.forEach(gp => {
            if (!profileMap[gp.username]) {
                profileMap[gp.username] = { username: gp.username, follower_count: gp.follower_count || 0 };
            } else {
                profileMap[gp.username].follower_count = gp.follower_count || profileMap[gp.username].follower_count || 0;
            }
        });
        // Apply local roles
        Object.values(profileMap).forEach(p => {
            p.project_role = localRolesMap[p.username] || 'tracked';
        });

        const profiles = Object.values(profileMap);
        if (profiles.length === 0) return;

        compBrandSelect.innerHTML = '<option value="" disabled selected>Select brand...</option>';
        compAddCompetitor.innerHTML = '<option value="" disabled selected>+ Add competitor...</option>';

        const sorted = [...profiles].sort((a, b) => (b.follower_count || 0) - (a.follower_count || 0));
        compAllProfiles = sorted;
        comp_renderSearchResults(compSearchInput ? compSearchInput.value : '');
        for (const p of sorted) {
            const roleKey = p.project_role || 'tracked';
            const roleInfo = ROLE_COLORS[roleKey] || ROLE_COLORS.tracked;
            const opt1 = document.createElement('option');
            opt1.value = p.username;
            opt1.textContent = `${roleInfo.icon} @${p.username} (${formatReach(p.follower_count || 0)})`;
            compBrandSelect.appendChild(opt1);
            compAddCompetitor.appendChild(opt1.cloneNode(true));
        }

        // Restore pinned selections for local mode
        chrome.storage.local.get(['comp_pinned'], (result) => {
            const pinned = result.comp_pinned;
            if (pinned && pinned.projectId === 'local') {
                if (pinned.brand && sorted.find(p => p.username === pinned.brand)) {
                    compBrandSelect.value = pinned.brand;
                    compSelectedBrand = pinned.brand;
                }
                if (pinned.competitors && pinned.competitors.length > 0) {
                    compSelectedCompetitors = [];
                    if (compCompetitorChips) compCompetitorChips.innerHTML = '';
                    for (const cu of pinned.competitors) {
                        if (sorted.find(p => p.username === cu)) comp_addCompetitor(cu);
                    }
                }
            } else {
                // Fallback: pre-select by local role
                const brandProfile = sorted.find(p => p.project_role === 'brand');
                if (brandProfile) {
                    compBrandSelect.value = brandProfile.username;
                    compSelectedBrand = brandProfile.username;
                }
                compSelectedCompetitors = [];
                if (compCompetitorChips) compCompetitorChips.innerHTML = '';
                const compProfiles = sorted.filter(p => p.project_role === 'competitor');
                for (const cp of compProfiles.slice(0, 3)) {
                    comp_addCompetitor(cp.username);
                }
            }
        });
    }

    // --- Build dashboard data locally from allPosts (no server needed) ---
    function comp_buildLocalCompareData(brandUsername, competitorUsernames, posts, profilesData, startDate, endDate) {
        const allUsernames = [brandUsername, ...competitorUsernames];

        // Filter posts by date if applicable
        let filtered = posts;
        if (startDate || endDate) {
            const start = startDate ? new Date(startDate + 'T00:00:00').getTime() / 1000 : 0;
            const end = endDate ? new Date(endDate + 'T23:59:59').getTime() / 1000 : Infinity;
            filtered = posts.filter(p => {
                const ts = p.timestamp || 0;
                return ts >= start && ts <= end;
            });
        }

        // Attribution is switchable — see compAttributionMode. The 'capture'
        // branches below are the original pre-2026-07-31 logic, kept verbatim.
        const byRelationship = compAttributionMode !== 'capture';

        // Group posts by owner username
        function getPostOwner(p) {
            if (byRelationship) return PostIndex.getOwner(p) || 'unknown';
            // Prioritize actual owner, then fallback to caption_user or scrapedFromProfile
            return p.owner?.username || p.user?.username || p.username || p.caption_user?.username || p.scrapedFromProfile || 'unknown';
        }

        // Helper to check if a tracked user is involved in a post
        function isUserInvolved(p, username) {
            if (byRelationship) return PostIndex.postProfiles(p).has(username);
            const postUsers = new Set();
            const owner = getPostOwner(p);
            if (owner) postUsers.add(owner);
            if (p.caption_user?.username) postUsers.add(p.caption_user.username);
            if (p.scrapedFromProfile) postUsers.add(p.scrapedFromProfile);
            (p.coauthors || []).forEach(ca => { if (ca.username || (typeof ca === 'string' && ca)) postUsers.add(ca.username || ca); });
            return postUsers.has(username);
        }

        // Collaborator objects for reach. In relationship mode this must read the
        // same alias pair as the involvement rule above, or the two halves of the
        // calculation disagree about who collaborated on a post.
        function getPostCoauthorObjects(p) {
            if (!byRelationship) return p.coauthors || [];
            const list = (p.coauthors && p.coauthors.length)
                ? p.coauthors
                : (p.coauthor_producers || []);
            return (Array.isArray(list) ? list : [])
                .map(ca => (typeof ca === 'string' ? { username: ca } : ca))
                .filter(ca => ca && ca.username);
        }

        // --- compareData ---
        const profiles = allUsernames.map((username, idx) => {
            const userPosts = filtered.filter(p => isUserInvolved(p, username));
            const totalLikes = userPosts.reduce((s, p) => s + (p.likes || 0), 0);
            const totalComments = userPosts.reduce((s, p) => s + (p.comments || 0), 0);
            const totalEngagement = totalLikes + totalComments;
            const postCount = userPosts.length;
            const avgEngagement = postCount > 0 ? Math.round(totalEngagement / postCount) : 0;

            const profileData = profilesData.find(pr => pr.username === username);
            const followers = profileData?.follower_count || 0;

            // Potential reach: own followers * posts + collab followers * collab posts
            const ownReach = followers * postCount;
            let collabReach = 0;
            userPosts.forEach(p => {
                const coauthors = getPostCoauthorObjects(p);
                coauthors.forEach(ca => {
                    if (ca.username && ca.username !== username) {
                        const caProfile = profilesData.find(pr => pr.username === ca.username);
                        collabReach += (caProfile?.follower_count || ca.follower_count || ca.edge_followed_by?.count || 0);
                    }
                });
            });

            return {
                username,
                role: idx === 0 ? 'brand' : 'competitor',
                post_count: postCount,
                total_engagement: totalEngagement,
                avg_engagement: avgEngagement,
                followers,
                own_reach: ownReach,
                potential_reach: ownReach + collabReach,
            };
        });

        const compareData = { success: true, profiles };

        // --- timeseriesData ---
        // Group all filtered posts into weekly buckets
        const interval = compChartInterval ? compChartInterval.value : 'week';
        const bucketMap = {};
        filtered.forEach(p => {
            const involvedTrackedUsers = allUsernames.filter(u => isUserInvolved(p, u));
            if (involvedTrackedUsers.length === 0) return;
            
            const ts = p.timestamp || 0;
            const d = new Date(ts > 10000000000 ? ts : ts * 1000);
            if (isNaN(d.getTime())) return;

            let bucketKey;
            if (interval === 'day') {
                bucketKey = d.toISOString().slice(0, 10);
            } else {
                // Weekly: round to Monday
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(d);
                monday.setDate(diff);
                bucketKey = monday.toISOString().slice(0, 10);
            }

            if (!bucketMap[bucketKey]) bucketMap[bucketKey] = {};
            
            // Allocate stats to all tracked users involved in this post
            involvedTrackedUsers.forEach(username => {
                if (!bucketMap[bucketKey][username]) bucketMap[bucketKey][username] = { posts: 0, likes: 0, comments: 0, engagement: 0, impressions: 0 };
                const bucket = bucketMap[bucketKey][username];
                bucket.posts += 1;
                bucket.likes += (p.likes || 0);
                bucket.comments += (p.comments || 0);
                bucket.engagement += (p.likes || 0) + (p.comments || 0);
                // Impressions = engagement * a simple multiplier based on followers (rough local estimate)
                const targetProfile = profilesData.find(pr => pr.username === username);
                bucket.impressions += (targetProfile?.follower_count || 0);
            });
        });

        const sortedPeriods = Object.keys(bucketMap).sort();
        const timeseries = sortedPeriods.map(period => ({ period, profiles: bucketMap[period] || {} }));
        const timeseriesData = { success: true, timeseries, usernames: allUsernames, interval };

        // --- topPostsData ---
        const topPosts = {};
        for (const username of allUsernames) {
            const userPosts = filtered.filter(p => isUserInvolved(p, username));
            const sorted = userPosts.sort((a, b) => ((b.likes || 0) + (b.comments || 0)) - ((a.likes || 0) + (a.comments || 0)));
            topPosts[username] = sorted.slice(0, 5).map(p => ({
                shortcode: p.shortcode,
                image_url: p.imageUrl,
                likes: p.likes || 0,
                comments: p.comments || 0,
                engagement: (p.likes || 0) + (p.comments || 0),
                caption: p.caption || '',
                posted_at: p.timestamp ? new Date((p.timestamp > 10000000000 ? p.timestamp : p.timestamp * 1000)).toISOString() : null,
                classification: p.classification || 'Normal Post',
                coauthors: p.coauthors || [],
                owner_username: getPostOwner(p),
            }));
        }
        const topPostsData = { success: true, topPosts };

        // --- collabsData ---
        const collaborations = {};
        console.log("=== 🤝 Collaboration Insights Trace ===");
        for (const username of allUsernames) {
            // Find all posts where this username is involved
            const userPosts = filtered.filter(p => isUserInvolved(p, username));

            console.log(`Tracking collabs for @${username} (${userPosts.length} involved posts)`);

            const collabMap = {};
            userPosts.forEach(p => {
                const owner = getPostOwner(p);
                const coauthors = getPostCoauthorObjects(p);

                let involved;
                if (byRelationship) {
                    involved = PostIndex.postProfiles(p);
                } else {
                    involved = new Set();
                    if (owner) involved.add(owner);
                    if (p.caption_user?.username) involved.add(p.caption_user.username);
                    // Included in original SQL as well (caption_user / owner / coauthor)
                    coauthors.forEach(ca => {
                        const caName = ca.username || (typeof ca === 'string' ? ca : null);
                        if (caName) involved.add(caName);
                    });
                }

                // Add everyone *except* the current tracked username as a collaborator
                const involvedArray = Array.from(involved);
                console.log(` - Post ${p.shortcode || p.code}: Involved users -> [${involvedArray.join(', ')}]`);
                
                involvedArray.forEach(caName => {
                    if (!caName || caName === username) return;
                    if (!collabMap[caName]) {
                        const caProfile = profilesData.find(pr => pr.username === caName);
                        // Also try to find from the post itself if not in profilesData
                        let followers = caProfile?.follower_count || 0;
                        if (!followers && caName !== owner) {
                            const postCa = coauthors.find(c => (c.username || c) === caName);
                            if (postCa && postCa.follower_count) followers = postCa.follower_count;
                        }
                        collabMap[caName] = {
                            collaborator: caName,
                            post_count: 0,
                            followers: followers,
                            posts: [],
                        };
                    }
                    collabMap[caName].post_count += 1;
                    collabMap[caName].posts.push({
                        shortcode: p.shortcode || p.code,
                        image_url: p.imageUrl || p.thumbnail_src || p.display_url || 'icons/placeholder.png'
                    });
                });
            });
            const sortedCollabs = Object.values(collabMap).sort((a, b) => b.post_count - a.post_count);
            collaborations[username] = sortedCollabs;
            
            console.log(`   Final Collabs for @${username}:`, sortedCollabs.map(c => `@${c.collaborator} (${c.post_count} posts)`));
        }
        const collabsData = { success: true, collaborations };


        return { compareData, timeseriesData, topPostsData, collabsData };
    }

    function comp_addCompetitor(username) {
        if (compSelectedCompetitors.length >= 3) {
            showToast('Maximum 3 competitors allowed.', 'warning');
            return;
        }
        if (compSelectedCompetitors.includes(username)) return;
        if (username === compSelectedBrand) {
            showToast('Cannot add brand as competitor.', 'warning');
            return;
        }
        compSelectedCompetitors.push(username);
        comp_renderCompetitorChips();
    }

    function comp_removeCompetitor(username) {
        compSelectedCompetitors = compSelectedCompetitors.filter(c => c !== username);
        comp_renderCompetitorChips();
    }

    function comp_renderCompetitorChips() {
        if (!compCompetitorChips || !compCompetitorCount) return;
        compCompetitorChips.innerHTML = '';
        compCompetitorCount.textContent = `${compSelectedCompetitors.length}/3`;

        for (const username of compSelectedCompetitors) {
            const chip = document.createElement('span');
            chip.className = 'comp-chip';
            chip.innerHTML = `@${escapeHtml(username)} <span class="comp-chip-remove" title="Remove">✕</span>`;
            chip.querySelector('.comp-chip-remove').onclick = () => comp_removeCompetitor(username);
            compCompetitorChips.appendChild(chip);
        }

        if (compAddCompetitor) compAddCompetitor.value = '';
    }

    // ---- Username search → assign as brand / competitor (live results) ----

    function comp_persistPinned() {
        const pid = (typeof projCurrentProjectId !== 'undefined' && projCurrentProjectId)
            ? projCurrentProjectId : 'local';
        chrome.storage.local.set({
            comp_pinned: { brand: compSelectedBrand, competitors: compSelectedCompetitors, projectId: pid }
        });
    }

    function comp_assignFromSearch(username, role) {
        if (!username) return;
        if (role === 'brand') {
            compSelectedBrand = username;
            // A profile can't be both brand and competitor.
            compSelectedCompetitors = compSelectedCompetitors.filter(c => c !== username);
            if (compBrandSelect) {
                if (!Array.from(compBrandSelect.options).some(o => o.value === username)) {
                    const o = document.createElement('option');
                    o.value = username;
                    o.textContent = `@${username}`;
                    compBrandSelect.appendChild(o);
                }
                compBrandSelect.value = username;
            }
            comp_renderCompetitorChips();
            showToast(`Set @${username} as Brand`, 'success');
        } else {
            // comp_addCompetitor enforces the 3-cap and the not-the-brand rule.
            comp_addCompetitor(username);
        }
        comp_persistPinned();
        // Re-render so the active brand/competitor state on the rows updates.
        comp_renderSearchResults(compSearchInput ? compSearchInput.value : '');
    }

    function comp_renderSearchResults(query) {
        if (!compSearchResults) return;
        const q = (query || '').trim().toLowerCase().replace(/^@/, '');

        if (!q) {
            compSearchResults.style.display = 'none';
            compSearchResults.innerHTML = '';
            return;
        }

        const matches = compAllProfiles
            .filter(p => p.username && p.username.toLowerCase().includes(q))
            .slice(0, 30);

        if (matches.length === 0) {
            compSearchResults.innerHTML =
                `<div style="padding: 12px 14px; color: var(--text-muted); font-size: 13px;">No profiles match “${escapeHtml(query)}”.</div>`;
            compSearchResults.style.display = 'block';
            return;
        }

        compSearchResults.innerHTML = matches.map(p => {
            const isBrand = compSelectedBrand === p.username;
            const isCompetitor = compSelectedCompetitors.includes(p.username);
            const reach = formatReach(p.follower_count || 0);
            const brandActive = isBrand
                ? 'background:rgba(99,102,241,0.85); color:#fff;'
                : 'background:rgba(99,102,241,0.12); color:#818cf8;';
            const compActive = isCompetitor
                ? 'background:rgba(239,68,68,0.85); color:#fff;'
                : 'background:rgba(239,68,68,0.12); color:#f87171;';
            return `
                <div class="comp-search-row" title="@${escapeHtml(p.username)}" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; border-bottom:1px solid var(--border-color);">
                    <span style="flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; color:var(--text-main);">
                        @${escapeHtml(p.username)}
                        <span style="color:var(--text-muted); font-size:12px;"> · ${reach}</span>
                    </span>
                    <span style="display:flex; gap:6px; flex-shrink:0;">
                        <button type="button" class="comp-search-assign" data-username="${escapeHtml(p.username)}" data-role="brand"
                            style="font-size:11px; padding:4px 8px; border-radius:5px; border:1px solid rgba(99,102,241,0.5); cursor:pointer; font-weight:600; ${brandActive}">🏢 Brand</button>
                        <button type="button" class="comp-search-assign" data-username="${escapeHtml(p.username)}" data-role="competitor"
                            style="font-size:11px; padding:4px 8px; border-radius:5px; border:1px solid rgba(239,68,68,0.5); cursor:pointer; font-weight:600; ${compActive}">🐰 Competitor</button>
                    </span>
                </div>`;
        }).join('');
        compSearchResults.style.display = 'block';
    }

    async function comp_loadDashboard() {
        compSelectedBrand = compBrandSelect ? compBrandSelect.value : null;
        if (!compSelectedBrand) {
            showToast('Please select a brand profile.', 'warning');
            return;
        }

        // ---- LOCAL MODE: no project loaded → compute from allPosts ----
        if (!projCurrentProjectId) {
            if (allPosts.length === 0) {
                showToast('No data available. Capture data while browsing or import a JSON file.', 'warning');
                return;
            }

            if (compLoading) compLoading.style.display = 'block';
            if (compEmptyState) compEmptyState.style.display = 'none';
            if (compDashboard) compDashboard.style.display = 'none';

            try {
                const { compareData, timeseriesData, topPostsData, collabsData } = comp_buildLocalCompareData(
                    compSelectedBrand, compSelectedCompetitors, allPosts, globalProfilesDataset, compStartDate, compEndDate
                );

                compDashboardData = compareData;
                compTimeseriesData = timeseriesData;
                compCollabsData = collabsData;

                // Pin selections for local mode
                chrome.storage.local.set({ comp_pinned: { brand: compSelectedBrand, competitors: compSelectedCompetitors, projectId: 'local' } });

                if (compDashboard) compDashboard.style.display = 'block';
                const compTimeFilter = document.getElementById('comp-time-filter');
                if (compTimeFilter) compTimeFilter.style.display = 'block';
                comp_updateActiveRangeLabel();

                compActiveUsers.clear();
                comp_renderSummaryCards(compareData);
                comp_renderEngagementComparison(compareData);
                comp_renderTimeSeries(timeseriesData);
                comp_renderReachBreakdown(compareData);
                comp_renderTopPosts(topPostsData);
                comp_renderCollaborations(collabsData);
                comp_renderDetailedBreakdown(compareData);
                comp_recalcFromExclusions();

                if (compBtnRefresh) compBtnRefresh.style.display = 'inline-block';
            } catch (err) {
                console.error('[Competitive Local] Error:', err);
                showToast('Failed to compute local competitive analysis.', 'error');
            } finally {
                if (compLoading) compLoading.style.display = 'none';
            }
            return;
        }

        const { token, apiUrl } = await getApiCredentials();
        if (!token) { showToast('Not logged in.', 'error'); return; }

        if (compLoading) compLoading.style.display = 'block';
        if (compEmptyState) compEmptyState.style.display = 'none';
        if (compDashboard) compDashboard.style.display = 'none';

        const competitorsParam = compSelectedCompetitors.join(',');
        const allUsernames = [compSelectedBrand, ...compSelectedCompetitors].join(',');

        // Build date range query string
        let dateParams = '';
        if (compStartDate) dateParams += `&start_date=${encodeURIComponent(compStartDate)}`;
        if (compEndDate) dateParams += `&end_date=${encodeURIComponent(compEndDate)}`;

        // Determine optimal interval based on date range or user selection
        let tsInterval = compChartInterval ? compChartInterval.value : 'week';
        if (!compChartInterval || !compChartInterval.value) {
            if (compStartDate && compEndDate) {
                const diffMs = new Date(compEndDate) - new Date(compStartDate);
                const diffDays = diffMs / (1000 * 60 * 60 * 24);
                tsInterval = diffDays <= 14 ? 'day' : 'week';
            } else if (compActivePreset === '7d') {
                tsInterval = 'day';
            }
        }

        try {
            const [compareRes, timeseriesRes, topPostsRes, collabsRes] = await Promise.all([
                fetch(`${apiUrl}/api/projects/${projCurrentProjectId}/compare?brand=${encodeURIComponent(compSelectedBrand)}&competitors=${encodeURIComponent(competitorsParam)}${dateParams}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${apiUrl}/api/projects/${projCurrentProjectId}/timeseries?brand=${encodeURIComponent(compSelectedBrand)}&competitors=${encodeURIComponent(competitorsParam)}&interval=${tsInterval}${dateParams}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${apiUrl}/api/projects/${projCurrentProjectId}/top-posts?usernames=${encodeURIComponent(allUsernames)}&limit=5${dateParams}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${apiUrl}/api/projects/${projCurrentProjectId}/collaborations?${dateParams.substring(1)}`, { headers: { 'Authorization': `Bearer ${token}` } }),
            ]);

            const [compareData, timeseriesData, topPostsData, collabsData] = await Promise.all([
                compareRes.ok ? compareRes.json() : { success: false },
                timeseriesRes.ok ? timeseriesRes.json() : { success: false },
                topPostsRes.ok ? topPostsRes.json() : { success: false },
                collabsRes.ok ? collabsRes.json() : { success: false }
            ]);

            compDashboardData = compareData;
            compTimeseriesData = timeseriesData;

            // Preserve collaborator exclusion state from previous data
            const prevExclusions = {};
            if (compCollabsData && compCollabsData.collaborations) {
                for (const [username, items] of Object.entries(compCollabsData.collaborations)) {
                    const excluded = (items || []).filter(i => i._excluded).map(i => i.collaborator);
                    if (excluded.length > 0) prevExclusions[username] = new Set(excluded);
                }
            }
            compCollabsData = collabsData;
            // Re-apply exclusion state to fresh data
            if (Object.keys(prevExclusions).length > 0 && collabsData.collaborations) {
                for (const [username, items] of Object.entries(collabsData.collaborations)) {
                    const excludedSet = prevExclusions[username];
                    if (!excludedSet) continue;
                    for (const item of items) {
                        if (excludedSet.has(item.collaborator)) item._excluded = true;
                    }
                }
            }

            // Pin selections so they survive tab navigation
            chrome.storage.local.set({ comp_pinned: { brand: compSelectedBrand, competitors: compSelectedCompetitors, projectId: projCurrentProjectId } });

            if (compDashboard) compDashboard.style.display = 'block';

            // Show time range filter bar
            const compTimeFilter = document.getElementById('comp-time-filter');
            if (compTimeFilter) compTimeFilter.style.display = 'block';
            comp_updateActiveRangeLabel();

            // Reset selection state for fresh data
            compActiveUsers.clear();

            // Render all sections
            comp_renderSummaryCards(compareData);
            comp_renderEngagementComparison(compareData);
            comp_renderTimeSeries(timeseriesData);
            comp_renderReachBreakdown(compareData);
            comp_renderTopPosts(topPostsData);
            comp_renderCollaborations(collabsData);
            comp_renderDetailedBreakdown(compareData);

            // Re-apply reach adjustments to sync numbers with Collaboration Insights (always)
            comp_recalcFromExclusions();

            if (compBtnRefresh) compBtnRefresh.style.display = 'inline-block';
        } catch (err) {
            console.error('[Competitive] Load error:', err);
            showToast('Failed to load competitive analysis.', 'error');
        } finally {
            if (compLoading) compLoading.style.display = 'none';
        }
    }

    function comp_renderSummaryCards(data) {
        if (!data.success || !data.profiles) return;
        const profiles = data.profiles;
        const brand = profiles.find(p => p.role === 'brand');
        const competitors = profiles.filter(p => p.role === 'competitor');
        // console.log("fsdfsdfsdf",brand.username);
        const brandUsername = brand ? brand.username : 'Brand Name';

        const totalPosts = brand ? (brand.post_count || 0) : 0;
        const totalEngagement = brand ? (brand.total_engagement || 0) : 0;
        const avgEng = totalPosts > 0 ? Math.round(totalEngagement / totalPosts) : 0;
        const totalReach = profiles.reduce((s, p) => s + (p.potential_reach || 0), 0);
        const compTotalReach = competitors.reduce((s, p) => s + (p.potential_reach || 0), 0);

        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        setStatValue('comp-summary-title', brandUsername);
        setStatValue('comp-stat-profiles', profiles.length);
        setStatValue('comp-stat-posts', totalPosts);
        setStatValue('comp-stat-engagement', totalEngagement);
        setStatValue('comp-stat-avg-engagement', avgEng);
        setStatValue('comp-stat-brand-reach', brand ? brand.own_reach : 0);
        el('comp-brand-summary-name', brand ? `@${brand.username}` : '{brand}');
        el('comp-stat-brand-reach-name', brand ? brand.username : 'Brand Name');
        setStatValue('comp-stat-comp-reach', brand ? brand.potential_reach : 0);

        // Update new dynamic reach cards
        const reachValueElBrand = document.getElementById('comm-influencer-reach-value');
        const reachUserElBrand = document.getElementById('comm-influencer-reach-username');
        if (reachValueElBrand) setStatValue(reachValueElBrand, brand ? brand.own_reach : 0);
        if (reachUserElBrand) reachUserElBrand.textContent = brand ? brand.username : 'Influencer';

        const reachValueElComp = document.getElementById('comm-stat-current-potentialreach-value');
        if (reachValueElComp) setStatValue(reachValueElComp, brand ? brand.potential_reach : 0);
    }

    function comp_renderEngagementComparison(data) {
        const container = document.getElementById('comp-engagement-bars');
        if (!container || !data.success) return;
        container.innerHTML = '';

        const profiles = data.profiles;
        // Build ordered username list: brand first, then competitors (matches COMP_COLORS order)
        const orderedUsernames = [compSelectedBrand, ...compSelectedCompetitors].filter(Boolean);
        const colorByUsername = {};
        orderedUsernames.forEach((u, i) => { colorByUsername[u] = comp_getColor(u, i); });

        const metrics = [
            { key: 'followers', label: 'Followers' },
            { key: 'total_engagement', label: 'Total Engagement' },
            { key: 'avg_engagement', label: 'Avg Engagement / Post' },
            { key: 'potential_reach', label: 'Potential Impressions' },
        ];

        for (const metric of metrics) {
            const maxVal = Math.max(...profiles.map(p => p[metric.key] || 0), 1);
            const brand = profiles.find(p => p.role === 'brand');
            const brandVal = brand ? (brand[metric.key] || 0) : 0;

            let html = `<div class="comp-metric-group"><div class="comp-metric-label">${metric.label}</div>`;
            for (const p of profiles) {
                const val = p[metric.key] || 0;
                const pct = Math.max((val / maxVal) * 100, 2);
                const barColor = colorByUsername[p.username] || '#94a3b8';

                let diffHtml = '';
                if (p.role === 'competitor' && brandVal > 0) {
                    const diffPct = Math.round(((val - brandVal) / brandVal) * 100);
                    const diffClass = diffPct > 0 ? 'positive' : diffPct < 0 ? 'negative' : 'neutral';
                    diffHtml = `<span class="comp-diff-badge ${diffClass}">${diffPct > 0 ? '+' : ''}${diffPct}%</span>`;
                }

                html += `
                    <div class="comp-bar-row">
                        <span class="comp-bar-username">@${escapeHtml(p.username)}</span>
                        <div class="comp-bar-track">
                            <div class="comp-bar-fill" style="width: ${pct}%; background: ${barColor}">${metric.key === 'avg_engagement' ? val.toFixed(1) : formatStatNumber(val)}</div>
                        </div>
                        ${diffHtml}
                    </div>`;
            }
            html += '</div>';
            container.innerHTML += html;
        }
    }

    let compBreakdownChartInstance = null;
    let compActiveUsers = new Set();

    function comp_renderDetailedBreakdown(data, _isToggle) {
        if (!data.success || !data.profiles || data.profiles.length === 0) return;

        const allProfiles = data.profiles;
        const orderedUsernames = [compSelectedBrand, ...compSelectedCompetitors].filter(Boolean);
        const colorByUsername = {};
        orderedUsernames.forEach((u, i) => { colorByUsername[u] = comp_getColor(u, i); });

        // Initialize active users if empty (first render)
        if (compActiveUsers.size === 0) {
            allProfiles.forEach(p => compActiveUsers.add(p.username));
        }

        // Filtered profiles for charts/stats (only active users)
        const profiles = allProfiles.filter(p => compActiveUsers.has(p.username));

        // Calculate totals from FILTERED profiles
        const totalPosts = profiles.reduce((s, p) => s + (p.post_count || 0), 0);
        const totalEng = profiles.reduce((s, p) => s + (p.total_engagement || 0), 0);
        const totalReach = profiles.reduce((s, p) => s + (p.potential_reach || 0), 0);
        // Total unique authors: each brand + their non-excluded collaborators (influencers)
        let totalAuths = 0;
        if (compCollabsData && compCollabsData.collaborations) {
            const allAuthors = new Set();
            profiles.forEach(p => {
                allAuthors.add(p.username); // brand counts as 1
                const items = compCollabsData.collaborations[p.username] || [];
                items.forEach(item => {
                    if (!item._excluded) allAuthors.add(item.collaborator);
                });
            });
            totalAuths = allAuthors.size;
        } else {
            totalAuths = profiles.length; // fallback: 1 per profile
        }

        // SOV percentages use ALL profiles for context
        const allTotalPosts = allProfiles.reduce((s, p) => s + (p.post_count || 0), 0);

        setStatValue('comp-breakdown-total-vol', totalPosts);
        setStatValue('comp-breakdown-total-eng', totalEng);
        
        let avgEng = Math.round(totalPosts > 0 ? (totalEng / totalPosts) : 0);
        setStatValue('comp-breakdown-avg-eng', avgEng);
        setStatValue('comp-breakdown-imp', totalReach);
        setStatValue('comp-breakdown-auth', totalAuths);
        document.getElementById('comp-breakdown-sent').textContent = '78%'; // Mock Sentiment

        // 1. Share of Voice List — toggle classes in-place for smooth CSS transition
        const sovList = document.getElementById('comp-breakdown-sov-list');
        const existingRows = sovList.querySelectorAll('.sov-row[data-username]');

        if (_isToggle && existingRows.length === allProfiles.length) {
            // In-place toggle: just flip inactive class (CSS handles the animation)
            existingRows.forEach(row => {
                const u = row.dataset.username;
                row.classList.toggle('inactive', !compActiveUsers.has(u));
            });
        } else {
            // Full rebuild (first render or data changed)
            sovList.innerHTML = '';
            allProfiles.forEach(p => {
                const pct = allTotalPosts > 0 ? Math.round((p.post_count / allTotalPosts) * 100) : 0;
                const color = colorByUsername[p.username] || '#94a3b8';
                const isActive = compActiveUsers.has(p.username);
                sovList.innerHTML += `
                    <div class="sov-row ${isActive ? '' : 'inactive'}" data-username="${p.username}">
                        <div class="sov-dot" style="background-color: ${color};"></div>
                        <div class="sov-name">${escapeHtml(p.username)}</div>
                        <div class="sov-pct" style="color: ${color};">${pct}%</div>
                    </div>
                `;
            });
        }

        // SOV click handlers (re-attach after any render path)
        sovList.querySelectorAll('.sov-row').forEach(row => {
            row.onclick = () => {
                const username = row.dataset.username;
                if (compActiveUsers.has(username)) {
                    if (compActiveUsers.size === 1) return; // prevent removing last
                    compActiveUsers.delete(username);
                } else {
                    compActiveUsers.add(username);
                }
                comp_renderDetailedBreakdown(data, true);
            };
        });

        // 2. Donut Chart — use Chart.js update() for smooth animation on toggle
        const ctx = document.getElementById('comp-breakdown-chart');

        // Build data arrays for ALL profiles, set deselected to 0 so chart animates segments smoothly
        const donutData = allProfiles.map(p => compActiveUsers.has(p.username) ? (p.post_count || 0) : 0);
        const donutColors = allProfiles.map(p => {
            const color = colorByUsername[p.username] || '#94a3b8';
            return compActiveUsers.has(p.username) ? color : color + '22'; // ghost color for inactive
        });
        const donutLabels = allProfiles.map(p => p.username);

        if (_isToggle && compBreakdownChartInstance) {
            // Smooth update — Chart.js animates the segment changes
            compBreakdownChartInstance.data.labels = donutLabels;
            compBreakdownChartInstance.data.datasets[0].data = donutData;
            compBreakdownChartInstance.data.datasets[0].backgroundColor = donutColors;
            compBreakdownChartInstance.update('active'); // 'active' mode = smooth animation
        } else {
            // Full create
            if (compBreakdownChartInstance) compBreakdownChartInstance.destroy();
            if (ctx) {
                compBreakdownChartInstance = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: donutLabels,
                        datasets: [{
                            data: donutData,
                            backgroundColor: donutColors,
                            borderWidth: 2,
                            hoverOffset: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '75%',
                        animation: { duration: 500, easing: 'easeInOutQuart' },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                filter: (item) => item.raw > 0, // hide zero-value tooltips
                                callbacks: {
                                    label: function(context) {
                                        const val = context.raw;
                                        const pct = totalPosts > 0 ? Math.round((val / totalPosts) * 100) : 0;
                                        return ` ${context.label}: ${pct}% (${val})`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }

        // 3. Stacked Bars — morph widths for smooth CSS transition
        const renderCustomStackedBar = (id, valueFn) => {
            const container = document.getElementById(id);
            if(!container) return;

            let total = 0;
            allProfiles.forEach(p => {
                if (compActiveUsers.has(p.username)) total += valueFn(p);
            });

            // Build target segments for ALL profiles (active get real width, inactive get 0)
            const segments = allProfiles.map(p => {
                const val = compActiveUsers.has(p.username) ? valueFn(p) : 0;
                const pct = total > 0 ? (val / total) * 100 : 0;
                const color = colorByUsername[p.username] || '#94a3b8';
                return { username: p.username, pct, color };
            }).filter(s => s.pct > 0 || compActiveUsers.has(s.username));

            const existingSegs = container.querySelectorAll('.comp-stacked-segment');

            if (_isToggle && existingSegs.length > 0) {
                // Morph existing segments: update widths (CSS transition handles animation)
                // Clear and re-create but with a requestAnimationFrame for width transition
                container.innerHTML = '';
                segments.forEach(s => {
                    const div = document.createElement('div');
                    div.className = 'comp-stacked-segment';
                    div.style.width = '0%';
                    div.style.backgroundColor = s.color;
                    div.title = `${s.username}: ${Math.round(s.pct)}%`;
                    container.appendChild(div);
                });
                // Trigger reflow then set widths for CSS transition
                container.offsetHeight; // force reflow
                container.querySelectorAll('.comp-stacked-segment').forEach((div, i) => {
                    if (segments[i]) div.style.width = `${segments[i].pct}%`;
                });
            } else {
                container.innerHTML = '';
                segments.forEach(s => {
                    if (s.pct > 0) {
                        const div = document.createElement('div');
                        div.className = 'comp-stacked-segment';
                        div.style.width = `${s.pct}%`;
                        div.style.backgroundColor = s.color;
                        div.title = `${s.username}: ${Math.round(s.pct)}%`;
                        container.appendChild(div);
                    }
                });
            }
        };
        
        renderCustomStackedBar('comp-stacked-eng', p => p.total_engagement || 0);
        renderCustomStackedBar('comp-stacked-avg-eng', p => (p.post_count > 0 ? p.total_engagement / p.post_count : 0));
        renderCustomStackedBar('comp-stacked-imp', p => p.potential_reach || 0);
        renderCustomStackedBar('comp-stacked-auth', p => {
            // authors = non-excluded collaborators (influencers) + 1 (the brand)
            if (compCollabsData && compCollabsData.collaborations) {
                const items = compCollabsData.collaborations[p.username] || [];
                return items.filter(item => !item._excluded).length + 1;
            }
            return 1; // fallback: just the brand
        });
        renderCustomStackedBar('comp-stacked-sent', p => p.post_count || 1);

        // 4. Legend — toggle classes in-place for smooth transition
        const legendContainer = document.getElementById('comp-breakdown-legend');
        const existingLegendItems = legendContainer.querySelectorAll('.legend-item[data-username]');

        if (_isToggle && existingLegendItems.length === orderedUsernames.length) {
            existingLegendItems.forEach(item => {
                const u = item.dataset.username;
                item.classList.toggle('inactive', !compActiveUsers.has(u));
            });
        } else {
            legendContainer.innerHTML = '';
            orderedUsernames.forEach((u, i) => {
                const color = colorByUsername[u] || '#94a3b8';
                const isActive = compActiveUsers.has(u);
                legendContainer.innerHTML += `
                    <div class="legend-item ${isActive ? '' : 'inactive'}" data-username="${u}">
                        <div class="sov-dot" style="background-color: ${color};"></div>
                        <span>${escapeHtml(u)}</span>
                    </div>
                `;
            });
        }

        // Legend click handlers
        legendContainer.querySelectorAll('.legend-item').forEach(item => {
            item.onclick = () => {
                const username = item.dataset.username;
                if (compActiveUsers.has(username)) {
                    if (compActiveUsers.size === 1) return;
                    compActiveUsers.delete(username);
                } else {
                    compActiveUsers.add(username);
                }
                comp_renderDetailedBreakdown(data, true);
            };
        });

        // 5. Insights — crossfade on toggle
        const insightsList = document.getElementById('comp-breakdown-insights-list');
const renderInsights = () => {
    insightsList.innerHTML = '';

    if (!profiles || profiles.length === 0) return;

    const MAX_INSIGHTS = 6;

const pickTone = (category, ...args) => {
    const options = TONES[category];
    const fn = options[Math.floor(Math.random() * options.length)];
    return fn(...args);
};
    const TONES = {
    leader: [
        (u, p) => `<li><strong>${u}</strong> dominated the conversation, capturing <strong>${p}%</strong> share of voice.</li>`,
        (u, p) => `<li><strong>${u}</strong> led the discussion with <strong>${p}%</strong> of total conversation volume.</li>`,
        (u, p) => `<li><strong>${u}</strong> emerged as the primary driver of conversation, holding <strong>${p}%</strong> share of voice.</li>`,
        (u, p) => `<li><strong>${u}</strong> captured the largest portion of discussion at <strong>${p}%</strong> share of voice.</li>`,
        (u, p) => `<li><strong>${u}</strong> stood out as the most visible brand, accounting for <strong>${p}%</strong> of activity.</li>`,
        (u, p) => `<li><strong>${u}</strong> maintained a leading position in conversation volume with <strong>${p}%</strong> share.</li>`,
        (u, p) => `<li><strong>${u}</strong> drove the majority of discussion, securing <strong>${p}%</strong> share of voice.</li>`
    ],

    engagementLeader: [
        u => `<li><strong>${u}</strong> stands out in engagement efficiency, generating significantly higher interactions per post.</li>`,
        u => `<li><strong>${u}</strong> leads in content performance, achieving the highest engagement per post.</li>`,
        u => `<li><strong>${u}</strong> delivers the strongest engagement efficiency across its content.</li>`,
        u => `<li><strong>${u}</strong> outperforms competitors in engagement per post.</li>`,
        u => `<li><strong>${u}</strong> demonstrates superior audience interaction relative to content volume.</li>`,
        u => `<li><strong>${u}</strong> achieves the highest engagement rate among competitors.</li>`,
        u => `<li><strong>${u}</strong> generates the most impactful engagement on a per-post basis.</li>`
    ],

    underperformer: [
        u => `<li><strong>${u}</strong> trails competitors in overall engagement levels.</li>`,
        u => `<li><strong>${u}</strong> shows comparatively weaker engagement performance.</li>`,
        u => `<li><strong>${u}</strong> underperforms relative to peers in audience interaction.</li>`,
        u => `<li><strong>${u}</strong> records the lowest engagement across the competitive set.</li>`,
        u => `<li><strong>${u}</strong> lags behind in generating audience engagement.</li>`,
        u => `<li><strong>${u}</strong> delivers limited engagement compared to competitors.</li>`,
        u => `<li><strong>${u}</strong> remains the weakest performer in terms of engagement.</li>`
    ],

    totalEngagement: [
        v => `<li>Total engagements reached <strong>${v}</strong>, indicating strong audience interaction.</li>`,
        v => `<li>Audience interaction generated <strong>${v}</strong> total engagements across the dataset.</li>`,
        v => `<li>Overall engagement volume totaled <strong>${v}</strong>, reflecting active audience participation.</li>`,
        v => `<li>A cumulative <strong>${v}</strong> engagements were recorded across all content.</li>`,
        v => `<li>The dataset generated <strong>${v}</strong> total engagements, signaling solid interaction levels.</li>`,
        v => `<li>Total audience interactions reached <strong>${v}</strong> engagements.</li>`,
        v => `<li>Engagement activity accumulated to <strong>${v}</strong> across all posts.</li>`
    ],

    avgEngagement: [
        v => `<li>Average engagement per post stands at <strong>${v}</strong>, reflecting solid content performance.</li>`,
        v => `<li>Posts generated an average of <strong>${v}</strong> engagements each.</li>`,
        v => `<li>Content performance averaged <strong>${v}</strong> engagements per post.</li>`,
        v => `<li>Each post delivered approximately <strong>${v}</strong> engagements on average.</li>`,
        v => `<li>Average interactions reached <strong>${v}</strong> per post.</li>`,
        v => `<li>Per-post engagement averaged <strong>${v}</strong> interactions.</li>`,
        v => `<li>Content achieved a mean engagement of <strong>${v}</strong> per post.</li>`
    ],

    authors: [
        v => `<li>A total of <strong>${v}</strong> unique authors contributed to the discussion.</li>`,
        v => `<li>The conversation involved <strong>${v}</strong> distinct contributors.</li>`,
        v => `<li><strong>${v}</strong> unique authors participated across the dataset.</li>`,
        v => `<li>The discussion was driven by <strong>${v}</strong> individual contributors.</li>`,
        v => `<li>A contributor base of <strong>${v}</strong> authors shaped the conversation.</li>`,
        v => `<li><strong>${v}</strong> different voices contributed to the overall discussion.</li>`,
        v => `<li>The dataset reflects participation from <strong>${v}</strong> unique authors.</li>`
    ],

    volume: [
        v => `<li>Overall conversation volume remains <strong>${v}</strong> based on activity levels.</li>`,
        v => `<li>Conversation activity can be classified as <strong>${v}</strong>.</li>`,
        v => `<li>The level of discussion is considered <strong>${v}</strong> overall.</li>`,
        v => `<li>Activity levels indicate a <strong>${v}</strong> volume of conversation.</li>`,
        v => `<li>The dataset reflects a <strong>${v}</strong> level of activity.</li>`,
        v => `<li>Discussion volume falls within a <strong>${v}</strong> range.</li>`,
        v => `<li>Overall engagement suggests a <strong>${v}</strong> conversation scale.</li>`
    ],

    concentration: [
        () => `<li>The conversation is driven by a concentrated group of contributors.</li>`,
        () => `<li>Activity is heavily concentrated among a smaller set of contributors.</li>`,
        () => `<li>A limited group of authors accounts for most of the activity.</li>`,
        () => `<li>The discussion is dominated by a core group of contributors.</li>`,
        () => `<li>Participation is skewed toward a concentrated contributor base.</li>`,
        () => `<li>A small number of authors drive the majority of content.</li>`,
        () => `<li>The conversation shows strong contributor concentration.</li>`
    ]
};

    const insights = [];
    const totalPostsSafe = totalPosts || 0;

    const totalEngagement = profiles.reduce(
        (sum, p) => sum + (p.total_engagement || 0), 0
    );

    // Unique authors = unique influencers (collaborators) + brand profiles
    // Mirrors Total_Authors logic: items.length + 1 per profile
    let uniqueAuthors = 0;
    if (compCollabsData && compCollabsData.collaborations) {
        const authorSet = new Set();
        profiles.forEach(p => {
            // The brand/profile itself counts as an author
            authorSet.add(p.username);
            // Each non-excluded collaborator (influencer) is an author
            const items = compCollabsData.collaborations[p.username] || [];
            items.forEach(item => {
                if (!item._excluded) authorSet.add(item.collaborator);
            });
        });
        uniqueAuthors = authorSet.size;
    } else {
        // Fallback: just count each profile as 1 author
        uniqueAuthors = profiles.length;
    }

    const avgEngagement = Math.round(totalPostsSafe > 0
        ? (totalEngagement / totalPostsSafe)
        : 0);

    // -------------------------
    // 🥇 Leader (ALWAYS FIRST + Tone by Strength)
    // -------------------------
    const topProfiles = [...profiles].sort(
        (a, b) => (b.post_count || 0) - (a.post_count || 0)
    );

    const leader = topProfiles[0];

    if (leader && totalPostsSafe > 0) {
        const sovPct = Math.round(
            (leader.post_count / totalPostsSafe) * 100
        ) || 0;

        // Tone by dominance strength
        let strengthLabel = 'led';
        if (sovPct >= 50) strengthLabel = 'dominated';
        else if (sovPct >= 30) strengthLabel = 'led';
        else strengthLabel = 'slightly led';

        // Inject dynamic phrase into tone pool
        const leaderText = pickTone('leader', leader.username, sovPct)
            .replace(/dominated|led|emerged as the primary driver|captured the largest portion|stood out as the most visible brand|maintained a leading position|drove the majority of discussion/gi, strengthLabel);

        insights.push({
            score: 1000,
            text: leaderText
        });
    }

    // -------------------------
    // Engagement Leader
    // -------------------------
    let maxEng = 0;
    let engLeader = null;

    profiles.forEach(p => {
        const avg = p.post_count > 0
            ? (p.total_engagement || 0) / p.post_count
            : 0;

        if (avg > maxEng) {
            maxEng = avg;
            engLeader = p;
        }
    });

    if (engLeader && maxEng > avgEngagement * 1.5) {
        insights.push({
            score: 80,
            text: pickTone('engagementLeader', engLeader.username)
        });
    }

    // -------------------------
    // Underperformer
    // -------------------------
    if (profiles.length > 2) {
        const underperformer = [...profiles].sort(
            (a, b) => (a.total_engagement || 0) - (b.total_engagement || 0)
        )[0];

        if (
            underperformer &&
            underperformer.total_engagement < totalEngagement * 0.1
        ) {
            insights.push({
                score: 60,
                text: pickTone('underperformer', underperformer.username)
            });
        }
    }

    // -------------------------
    // Total Engagement
    // -------------------------
    if (totalEngagement > 1000) {
        insights.push({
            score: 85,
            text: pickTone(
                'totalEngagement',
                totalEngagement.toLocaleString()
            )
        });
    }

    // -------------------------
    // Avg Engagement
    // -------------------------
    if (avgEngagement > 5) {
        insights.push({
            score: 70,
            text: pickTone(
                'avgEngagement',
                avgEngagement.toFixed(2)
            )
        });
    }

    // -------------------------
    // Unique Authors
    // -------------------------
    if (uniqueAuthors > 5) {
        insights.push({
            score: 65,
            text: pickTone('authors', uniqueAuthors)
        });
    }

    // -------------------------
    // Volume Classification
    // -------------------------
    if (totalPostsSafe > 0) {
        let label = '';
        let score = 40;

        if (totalPostsSafe < 100) label = 'limited';
        else if (totalPostsSafe < 500) label = 'moderate';
        else {
            label = 'high';
            score = 75;
        }

        insights.push({
            score,
            text: pickTone('volume', label)
        });
    }

    // -------------------------
    // Contributor Concentration
    // -------------------------
    if (uniqueAuthors > 0 && totalPostsSafe > 0) {
        const ratio = totalPostsSafe / uniqueAuthors;

        if (ratio > 10) {
            insights.push({
                score: 60,
                text: pickTone('concentration')
            });
        }
    }

    // -------------------------
    // 🎯 FINAL SORT + LIMIT
    // -------------------------
    const finalInsights = insights
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_INSIGHTS)
        .map(i => i.text);

    insightsList.innerHTML = finalInsights.join('');
};


//v2 chat
        //        const renderInsights = () => {
//     insightsList.innerHTML = '';

//     if (!profiles || profiles.length === 0) return;

//     const MAX_INSIGHTS = 6;
//     const insights = [];

//     const totalPostsSafe = totalPosts || 0;
//     const totalEngagement = profiles.reduce((sum, p) => sum + (p.total_engagement || 0), 0);

//     const uniqueAuthors = new Set(
//         profiles.flatMap(p => p.authors || [])
//     ).size;

//     const avgEngagement = totalPostsSafe > 0 ? (totalEngagement / totalPostsSafe) : 0;

//     // -------------------------
//     // 🥇 Leader (ALWAYS FIRST)
//     // -------------------------
//     const topProfiles = [...profiles].sort((a, b) => (b.post_count || 0) - (a.post_count || 0));
//     const leader = topProfiles[0];

//     if (leader && totalPostsSafe > 0) {
//         const sovPct = Math.round((leader.post_count / totalPostsSafe) * 100) || 0;

//         insights.push({
//             score: 1000, // always first
//             text: `<li><strong>${leader.username}</strong> dominated the conversation, capturing <strong>${sovPct}%</strong> share of voice.</li>`
//         });
//     }

//     // -------------------------
//     // Engagement Leader
//     // -------------------------
//     let maxEng = 0;
//     let engLeader = null;

//     profiles.forEach(p => {
//         const avg = p.post_count > 0 ? (p.total_engagement || 0) / p.post_count : 0;
//         if (avg > maxEng) {
//             maxEng = avg;
//             engLeader = p;
//         }
//     });

//     if (engLeader && maxEng > avgEngagement * 1.5) {
//         insights.push({
//             score: 80,
//             text: `<li><strong>${engLeader.username}</strong> stands out in engagement efficiency, generating significantly higher interactions per post.</li>`
//         });
//     }

//     // -------------------------
//     // Underperformer
//     // -------------------------
//     if (profiles.length > 2) {
//         const underperformer = [...profiles].sort(
//             (a, b) => (a.total_engagement || 0) - (b.total_engagement || 0)
//         )[0];

//         if (underperformer && underperformer.total_engagement < totalEngagement * 0.1) {
//             insights.push({
//                 score: 60,
//                 text: `<li><strong>${underperformer.username}</strong> trails competitors in overall engagement levels.</li>`
//             });
//         }
//     }

//     // -------------------------
//     // Total Engagement
//     // -------------------------
//     if (totalEngagement > 1000) {
//         insights.push({
//             score: 85,
//             text: `<li>Total engagements reached <strong>${totalEngagement.toLocaleString()}</strong>, indicating strong audience interaction.</li>`
//         });
//     }

//     // -------------------------
//     // Avg Engagement
//     // -------------------------
//     if (avgEngagement > 5) {
//         insights.push({
//             score: 70,
//             text: `<li>Average engagement per post stands at <strong>${avgEngagement.toFixed(2)}</strong>, reflecting solid content performance.</li>`
//         });
//     }

//     // -------------------------
//     // Unique Authors
//     // -------------------------
//     if (uniqueAuthors > 5) {
//         insights.push({
//             score: 65,
//             text: `<li>A total of <strong>${uniqueAuthors}</strong> unique authors contributed to the discussion.</li>`
//         });
//     }

//     // -------------------------
//     // Volume Classification
//     // -------------------------
//     if (totalPostsSafe > 0) {
//         let label = '';
//         let score = 40;

//         if (totalPostsSafe < 100) label = 'limited';
//         else if (totalPostsSafe < 500) label = 'moderate';
//         else {
//             label = 'high';
//             score = 75;
//         }

//         insights.push({
//             score,
//             text: `<li>Overall conversation volume remains <strong>${label}</strong> based on total activity levels.</li>`
//         });
//     }

//     // -------------------------
//     // Contributor Concentration
//     // -------------------------
//     if (uniqueAuthors > 0 && totalPostsSafe > 0) {
//         const ratio = totalPostsSafe / uniqueAuthors;

//         if (ratio > 10) {
//             insights.push({
//                 score: 60,
//                 text: `<li>The conversation is driven by a concentrated group of contributors.</li>`
//             });
//         }
//     }

//     // -------------------------
//     // 🎯 FINAL SORT + LIMIT
//     // -------------------------
//     const finalInsights = insights
//         .sort((a, b) => b.score - a.score)
//         .slice(0, MAX_INSIGHTS)
//         .map(i => i.text);

//     insightsList.innerHTML = finalInsights.join('');
// };
       
        // const renderInsights = () => {
        //     insightsList.innerHTML = '';
        //     const topProfiles = [...profiles].sort((a,b) => ((b.post_count || 0) - (a.post_count || 0)));
        //     const leader = topProfiles[0];
            
        //     let maxEng = 0; let engLeader = null;
        //     profiles.forEach(p => {
        //         let avg = (p.post_count > 0) ? ((p.total_engagement || 0) / p.post_count) : 0;
        //         if(avg > maxEng) { maxEng = avg; engLeader = p; }
        //     });

        //     if (leader) {
        //         let sovPct = Math.round((leader.post_count / totalPosts) * 100) || 0;
        //         insightsList.innerHTML += `<li><strong>${leader.username}</strong> dominates with ${sovPct}% share of voice.</li>`;
        //     }
        //     if (engLeader && leader && engLeader.username !== leader.username) {
        //         insightsList.innerHTML += `<li><strong>${engLeader.username}</strong> drives the highest engagement quality despite lower volume.</li>`;
        //     } else if (engLeader) {
        //         insightsList.innerHTML += `<li><strong>${engLeader.username}</strong> leads both in post volume and engagement efficiency.</li>`;
        //     }
            
        //     const underperformer = [...profiles].sort((a,b) => ((a.total_engagement || 0) - (b.total_engagement || 0)))[0];
        //     if (underperformer && profiles.length > 2 && underperformer.username !== (leader && leader.username)) {
        //         insightsList.innerHTML += `<li><strong>${underperformer.username}</strong> under-indexes across engagement metrics.</li>`;
        //     }
        // };

        if (_isToggle) {
            // Crossfade: fade out → update → fade in
            insightsList.style.transition = 'opacity 0.25s ease';
            insightsList.style.opacity = '0';
            setTimeout(() => {
                renderInsights();
                insightsList.style.opacity = '1';
            }, 250);
        } else {
            renderInsights();
        }
    }

    function comp_renderTimeSeries(data) {
        if (!compChartCanvas || !data.success) return;

        const rawTimeseries = data.timeseries || [];
        const usernames = data.usernames || [];
        const metric = compChartMetric ? compChartMetric.value : 'engagement';
        const interval = compChartInterval ? compChartInterval.value : (data.interval || 'week');

        if (compChartInstance) {
            compChartInstance.destroy();
            compChartInstance = null;
        }

        if (rawTimeseries.length === 0) {
            const ctx = compChartCanvas.getContext('2d');
            ctx.clearRect(0, 0, compChartCanvas.width, compChartCanvas.height);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No time series data available', compChartCanvas.width / 2, compChartCanvas.height / 2);
            comp_renderLegend(usernames);
            return;
        }

        // --- Frontend Grouping for Monthly & Yearly Views ---
        const monthLabels = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        let timeseries, labels, useCategory = false;

        if (interval === 'month') {
            // Group all data points by month (1-12), aggregate values
            const grouped = {};
            rawTimeseries.forEach(entry => {
                const d = new Date(entry.period + 'T00:00:00');
                const monthKey = d.getMonth() + 1; // 1-12
                if (!grouped[monthKey]) {
                    grouped[monthKey] = { profiles: {} };
                }
                // Aggregate each profile's metrics
                for (const [username, metrics] of Object.entries(entry.profiles || {})) {
                    if (!grouped[monthKey].profiles[username]) {
                        grouped[monthKey].profiles[username] = {};
                    }
                    const target = grouped[monthKey].profiles[username];
                    for (const [key, val] of Object.entries(metrics)) {
                        target[key] = (target[key] || 0) + (val || 0);
                    }
                }
            });

            // Fill all 12 month slots even if empty
            const fullMonths = Array.from({ length: 12 }, (_, i) => i + 1);
            timeseries = fullMonths.map(m => ({
                period: monthLabels[m],
                monthKey: m,
                profiles: grouped[m] ? grouped[m].profiles : {}
            }));
            labels = fullMonths.map(m => monthLabels[m]);
            useCategory = true;

        } else if (interval === 'year') {
            // Group all data points by year
            const grouped = {};
            const yearSet = new Set();
            rawTimeseries.forEach(entry => {
                const d = new Date(entry.period + 'T00:00:00');
                const yearKey = d.getFullYear();
                yearSet.add(yearKey);
                if (!grouped[yearKey]) {
                    grouped[yearKey] = { profiles: {} };
                }
                for (const [username, metrics] of Object.entries(entry.profiles || {})) {
                    if (!grouped[yearKey].profiles[username]) {
                        grouped[yearKey].profiles[username] = {};
                    }
                    const target = grouped[yearKey].profiles[username];
                    for (const [key, val] of Object.entries(metrics)) {
                        target[key] = (target[key] || 0) + (val || 0);
                    }
                }
            });

            // Sort years and fill any gaps
            const years = [...yearSet].sort((a, b) => a - b);
            if (years.length >= 2) {
                const minYear = years[0];
                const maxYear = years[years.length - 1];
                for (let y = minYear; y <= maxYear; y++) {
                    if (!grouped[y]) grouped[y] = { profiles: {} };
                }
            }
            const sortedYears = Object.keys(grouped).map(Number).sort((a, b) => a - b);
            timeseries = sortedYears.map(y => ({
                period: String(y),
                yearKey: y,
                profiles: grouped[y].profiles
            }));
            labels = sortedYears.map(y => String(y));
            useCategory = true;

        } else {
            // Weekly / Daily — keep raw data as-is
            timeseries = rawTimeseries;
            labels = rawTimeseries.map(entry => {
                const d = new Date(entry.period + 'T00:00:00');
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            });
            useCategory = false;
        }

        // Metric display names for axis title and tooltips
        const metricNames = {
            engagement: 'Engagement',
            impressions: 'Impressions',
            reach: 'Reach',
            posts: 'Posts',
            likes: 'Likes',
            comments: 'Comments'
        };
        const metricLabel = metricNames[metric] || metric;

        // Adaptive point size: larger dots when fewer data points
        const pointRadius = timeseries.length <= 7 ? 6 : timeseries.length <= 14 ? 4 : 3;
        const pointHoverRadius = pointRadius + 2;

        const isLight = document.body.classList.contains('light-theme');
        const themeVars = {
            grid: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
            ticks: isLight ? '#475569' : '#94a3b8',
            title: isLight ? '#334155' : '#64748b',
            tooltipBg: isLight ? '#ffffff' : '#1f1f3a',
            tooltipTitle: isLight ? '#0f172a' : '#fff',
            tooltipBody: isLight ? '#334155' : '#e4e4e7',
            tooltipBorder: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
            pointBorder: isLight ? '#f8f9fa' : '#1a1a2e'
        };

        const ctx = compChartCanvas.getContext('2d');
        const datasets = usernames.map((u, i) => {
            const color = comp_getColor(u, i);
            
            // Create vertical gradient for the fill
            const chartHeight = compChartCanvas.clientHeight || 300;
            const gradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
            gradient.addColorStop(0, color + '4d'); // ~30% opacity at top
            gradient.addColorStop(1, color + '00'); // Transparent at bottom

            return {
                label: '@' + u,
                data: timeseries.map(entry => {
                    if (!entry.profiles[u]) return metric === 'posts' ? 0 : null;
                    return entry.profiles[u][metric] !== undefined ? entry.profiles[u][metric] : (metric === 'posts' ? 0 : null);
                }),
                borderColor: color,
                backgroundColor: gradient,
                tension: 0.45,
                borderWidth: 3,
                spanGaps: true,
                pointRadius: pointRadius,
                pointHoverRadius: pointHoverRadius,
                pointBackgroundColor: color,
                pointBorderColor: themeVars.pointBorder,
                pointBorderWidth: 2,
                fill: true,
            };
        });

        // X-axis title based on interval
        const intervalTitles = {
            day: 'Date (Daily)',
            week: 'Date (Weekly)',
            month: 'Month',
            year: 'Year'
        };

        compChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        type: useCategory ? 'category' : undefined,
                        grid: { color: themeVars.grid },
                        ticks: {
                            color: themeVars.ticks,
                            font: { family: 'Inter', size: 11, weight: '500' },
                            maxRotation: useCategory ? 0 : 45,
                            minRotation: 0,
                            autoSkip: !useCategory,
                            maxTicksLimit: useCategory ? undefined : 15,
                        },
                        title: {
                            display: true,
                            text: intervalTitles[interval] || 'Date',
                            color: themeVars.title,
                            font: { family: 'Inter', size: 12, weight: '600' },
                            padding: { top: 8 }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: themeVars.grid },
                        ticks: {
                            color: themeVars.ticks,
                            font: { family: 'Inter', size: 11 },
                            callback: function (value) { return typeof formatReach === 'function' ? formatReach(value) : value; },
                            maxTicksLimit: 8,
                        },
                        title: {
                            display: true,
                            text: metricLabel,
                            color: themeVars.title,
                            font: { family: 'Inter', size: 12, weight: '600' },
                            padding: { bottom: 8 }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: themeVars.tooltipBg,
                        titleColor: themeVars.tooltipTitle,
                        bodyColor: themeVars.tooltipBody,
                        borderColor: themeVars.tooltipBorder,
                        borderWidth: 1,
                        padding: 12,
                        bodyFont: { family: 'Inter', size: 13 },
                        titleFont: { family: 'Inter', size: 13, weight: '600' },
                        callbacks: {
                            title: function (contexts) {
                                if (contexts.length > 0) {
                                    const idx = contexts[0].dataIndex;
                                    const entry = timeseries[idx];
                                    if (entry) {
                                        if (interval === 'month') {
                                            return monthLabels[entry.monthKey] || entry.period;
                                        } else if (interval === 'year') {
                                            return String(entry.yearKey || entry.period);
                                        } else {
                                            const d = new Date(entry.period + 'T00:00:00');
                                            return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
                                        }
                                    }
                                }
                                return contexts[0]?.label || '';
                            },
                            label: function (context) {
                                let val = context.parsed.y;
                                const formatted = typeof formatReach === 'function' ? formatReach(val) : val;
                                return ` ${context.dataset.label}: ${formatted} ${metricLabel.toLowerCase()}`;
                            }
                        }
                    }
                }
            }
        });

        // Render interactive legend
        comp_renderLegend(usernames);
    }

    // Interactive Legend with color editing
    function comp_renderLegend(usernames) {
        if (!compChartLegend) return;
        compChartLegend.innerHTML = '';

        usernames.forEach((u, i) => {
            const color = comp_getColor(u, i);
            const role = u === compSelectedBrand ? 'Brand' : 'Competitor';

            const item = document.createElement('span');
            item.className = 'comp-legend-item';
            item.dataset.username = u;

            // Color dot (clickable for color editing)
            const dot = document.createElement('span');
            dot.className = 'comp-legend-dot';
            dot.style.background = color;
            dot.title = compColorEditMode ? 'Click to change color' : `@${u}`;

            // Hidden color input
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.className = 'comp-color-input';
            colorInput.value = color;
            colorInput.addEventListener('input', (e) => {
                comp_setUserColor(u, i, e.target.value);
            });

            dot.addEventListener('click', (e) => {
                e.stopPropagation();
                colorInput.click();
            });

            // Label text
            const label = document.createElement('span');
            label.innerHTML = `@${escapeHtml(u)} <span class="comp-legend-role">(${role})</span>`;

            item.appendChild(dot);
            item.appendChild(colorInput);
            item.appendChild(label);

            // Click label to toggle line visibility
            label.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!compChartInstance) return;
                const dsIndex = i;
                const meta = compChartInstance.getDatasetMeta(dsIndex);
                meta.hidden = !meta.hidden;
                item.classList.toggle('hidden', meta.hidden);
                compChartInstance.update();
            });

            compChartLegend.appendChild(item);
        });
    }

    // Set custom color for a user and update everything
    function comp_setUserColor(username, index, newColor) {
        compCustomColors[username] = newColor;
        chrome.storage.local.set({ comp_custom_colors: compCustomColors });

        // Update chart dataset
        if (compChartInstance && compChartInstance.data.datasets[index]) {
            const ds = compChartInstance.data.datasets[index];
            ds.borderColor = newColor;
            ds.backgroundColor = newColor + '18';
            ds.pointBackgroundColor = newColor;
            compChartInstance.update();
        }

        // Update legend dot
        const legendItems = compChartLegend.querySelectorAll('.comp-legend-item');
        if (legendItems[index]) {
            const dot = legendItems[index].querySelector('.comp-legend-dot');
            if (dot) dot.style.background = newColor;
        }

        // Re-render engagement bars and reach with new colors
        if (compDashboardData) {
            comp_renderEngagementComparison(compDashboardData);
            comp_renderReachBreakdown(compDashboardData);
            comp_recalcFromExclusions();
        }
    }

    function comp_renderReachBreakdown(data) {
        const container = document.getElementById('comp-reach-breakdown');
        if (!container || !data.success) return;
        container.innerHTML = '';

        // Build color map matching custom/default colors
        const orderedUsernames = [compSelectedBrand, ...compSelectedCompetitors].filter(Boolean);
        const colorByUsername = {};
        orderedUsernames.forEach((u, i) => { colorByUsername[u] = comp_getColor(u, i); });

        console.log("=== REACH BREAKDOWN RENDER ===");
        const profiles = data.profiles.sort((a, b) => b.potential_reach - a.potential_reach);
        for (const p of profiles) {
            console.log(`Profile: @${p.username}`);
            console.log(`  post_count: ${p.post_count}`);
            console.log(`  followers: ${p.followers}`);
            console.log(`  potential_reach: ${p.potential_reach} (Format: ${formatReach(p.potential_reach)})`);

            const avatarColor = colorByUsername[p.username] || '#94a3b8';
            const firstLetter = (p.username || '?')[0].toUpperCase();
            container.innerHTML += `
                <div class="comp-reach-row">
                    <div class="comp-reach-avatar" style="background: ${avatarColor}22; color: ${avatarColor}">${firstLetter}</div>
                    <div class="comp-reach-info">
                        <div class="comp-reach-name">@${escapeHtml(p.username)}</div>
                        <div class="comp-reach-meta">${p.post_count} posts · ${formatReach(p.followers)} followers</div>
                    </div>
                    <div class="comp-reach-value"><span class="stat-value" data-value="${p.potential_reach}">${formatStatNumber(p.potential_reach)}</span></div>
                </div>`;
        }
    }

    // Recalculate reach from collab exclusion state and re-render affected sections
    function comp_recalcFromExclusions() {
        if (!compDashboardData || !compCollabsData) return;

        console.log("=== RECALCULATING REACH FROM EXCLUSIONS ===");
        // Deep-clone the dashboard data so we can patch reach values
        const patched = JSON.parse(JSON.stringify(compDashboardData));
        const collabs = compCollabsData.collaborations || {};

        for (const profile of patched.profiles) {
            const items = collabs[profile.username] || [];
            console.log(`Profile @${profile.username}: items length = ${items.length}`);

            console.log(`  Original reach (from backend mapping own follower count * posts involved): ${profile.potential_reach}`);

            // Recalculate reach purely from non-excluded collaborators
            const adjustedReach = items.reduce((sum, item) => {
                const itemReach = (item.followers || 0) * (item.post_count || 0);
                console.log(`  - Collab @${item.collaborator}: followers=${item.followers}, posts=${item.post_count}, reach=${itemReach}, excluded=${item._excluded}`);
                if (item._excluded) return sum;
                return sum + itemReach;
            }, 0);

            Total_Authors = items.length + 1;

            console.log(`  Total number of authors for @${profile.username}: ${Total_Authors} (including the brand profile)`);

            profile.collab_reach = adjustedReach;
            profile.own_reach = (profile.followers || 0) * (profile.post_count || 0);
            profile.potential_reach = profile.own_reach + profile.collab_reach;
            
            console.log(`  New reach set to: own=${profile.own_reach}, collab=${profile.collab_reach}, total=${profile.potential_reach}`);
        }

        // Re-render only the affected sections
        comp_renderSummaryCards(patched);
        comp_renderEngagementComparison(patched);
        comp_renderReachBreakdown(patched);
        comp_renderDetailedBreakdown(patched);
    }

    function comp_renderTopPosts(data) {
        const container = document.getElementById('comp-top-posts');
        if (!container || !data.success) return;
        container.innerHTML = '';

        const topPosts = data.topPosts || {};
        const allUsernames = [compSelectedBrand, ...compSelectedCompetitors];

        for (const username of allUsernames) {
            const posts = topPosts[username] || [];
            //🏆 Top 5 Performing Posts Posts label
            const roleLabel = username === compSelectedBrand ? '🏢 Brand' : '🐰 Competitor';

            let html = `<div class="comp-profile-posts">
                <div class="comp-profile-posts-header">${roleLabel} — @${escapeHtml(username)}</div>
                <div class="comp-posts-row">`;

            if (posts.length === 0) {
                html += '<p style="color: var(--text-muted); font-size: 13px;">No posts found.</p>';
            } else {
                for (const post of posts) {
                    const img = post.image_url || 'icons/placeholder.png';
                    html += `
                        <div class="comp-post-card" data-shortcode="${post.shortcode}" data-username="${escapeHtml(username)}">
                            <img src="${img}" class="comp-post-img" alt="Post" loading="lazy">
                            <div class="comp-post-stats">
                                <span>❤️ <span class="stat-value" data-value="${post.likes || 0}">${formatStatNumber(post.likes || 0)}</span></span>
                                <span>💬 <span class="stat-value" data-value="${post.comments || 0}">${formatStatNumber(post.comments || 0)}</span></span>
                                <span>📊 <span class="stat-value" data-value="${post.engagement || 0}">${formatStatNumber(post.engagement || 0)}</span></span>
                            </div>
                        </div>`;
                }
            }
            html += '</div></div>';
            container.innerHTML += html;
        }

        // Attach click handlers to open top-post detail modal
        container.querySelectorAll('.comp-post-card[data-shortcode]').forEach(card => {
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                const shortcode = card.dataset.shortcode;
                const username = card.dataset.username;
                comp_openTopPostModal(shortcode, username, data);
            });
        });
    }

    // --- Top-Post Detail Modal (similar to Commentator popup) ---
    function comp_openTopPostModal(shortcode, username, dashboardData) {
        const topPosts = dashboardData.topPosts || {};
        const posts = topPosts[username] || [];
        const post = posts.find(p => p.shortcode === shortcode);
        if (!post) { showToast('Post not found.', 'warning'); return; }

        const imgUrl = post.image_url || 'icons/icon128.png';
        const postLink = `https://www.instagram.com/p/${post.shortcode}/`;

        let dateStr = 'Unknown Date';
        if (post.posted_at) {
            const d = new Date(post.posted_at);
            dateStr = d.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
        } else if (post.timestamp) {
            const ts = post.timestamp > 10000000000 ? post.timestamp : post.timestamp * 1000;
            dateStr = new Date(ts).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
        }

        const roleLabel = username === compSelectedBrand ? '🏢 Brand' : '🐰 Competitor';

        // Classification badge
        let classLabel = '';
        const classification = post.classification || '';
        if (classification.includes('Paid') && classification.includes('Collab')) {
            classLabel = '<span class="modal-badge modal-badge-paid">💰 PAID</span><span class="modal-badge modal-badge-collab">🤝 COLLAB</span>';
        } else if (classification.includes('Paid')) {
            classLabel = '<span class="modal-badge modal-badge-paid">💰 PAID</span>';
        } else if (classification.includes('Collab')) {
            classLabel = '<span class="modal-badge modal-badge-collab">🤝 COLLAB</span>';
        }

        // Coauthors
        let coauthorsHtml = '';
        if (post.coauthors && post.coauthors.length > 0) {
            coauthorsHtml = `<p><strong>Co-authors:</strong> ${post.coauthors.map(c => '@' + escapeHtml(c.username || c)).join(', ')}</p>`;
        }

        // Caption
        const caption = post.caption || 'No caption';

        modalDetails.innerHTML = `
            <div class="modal-img-container">
                <img src="${imgUrl}" class="modal-img" alt="Post media">
            </div>
            <div class="modal-info-container">
                <div class="modal-info-header">
                    <div class="modal-username">@${escapeHtml(username)} <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${roleLabel}</span></div>
                    ${classLabel}
                </div>
                
                <div class="modal-stats">
                    <div class="modal-stat-box">
                        <div class="val"><span class="stat-value" data-value="${post.likes || 0}">${formatStatNumber(post.likes || 0)}</span></div>
                        <div class="lbl">Likes</div>
                    </div>
                    <div class="modal-stat-box">
                        <div class="val"><span class="stat-value" data-value="${post.comments || 0}">${formatStatNumber(post.comments || 0)}</span></div>
                        <div class="lbl">Comments</div>
                    </div>
                    <div class="modal-stat-box">
                        <div class="val"><span class="stat-value" data-value="${post.engagement || 0}">${formatStatNumber(post.engagement || 0)}</span></div>
                        <div class="lbl">Engagement</div>
                    </div>
                    ${post.video_view_count ? `
                    <div class="modal-stat-box">
                        <div class="val"><span class="stat-value" data-value="${post.video_view_count}">${formatStatNumber(post.video_view_count)}</span></div>
                        <div class="lbl">Views</div>
                    </div>` : ''}
                </div>
                
                <div class="modal-caption">${escapeHtml(caption)}</div>
                
                <div class="modal-meta">
                    <p><strong>Shortcode:</strong> <a href="${postLink}" target="_blank">${post.shortcode} ↗</a></p>
                    <p><strong>Posted:</strong> ${dateStr}</p>
                    ${post.classification ? `<p><strong>Type:</strong> ${post.classification}</p>` : ''}
                    ${coauthorsHtml}
                </div>
                <div class="modal-actions" id="comp-modal-actions-container" style="margin-top: 20px; display: flex; gap: 10px;">
                    <button class="btn btn-warning" style="flex: 1;" disabled>⏳ Checking Status...</button>
                    <a href="${postLink}" target="_blank" class="btn btn-secondary" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center;">IG ↗</a>
                </div>

                <div id="comp-modal-comments-viewer" class="modal-comments-viewer" style="display: none; margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h4 style="margin: 0;">💬 Scraped Comments</h4>
                        <button id="comp-btn-export-single-xlsx" class="btn btn-success btn-sm">Export Enriched XLSX</button>
                    </div>
                    <div id="comp-comments-list" class="comments-list" style="max-height: 300px; overflow-y: auto;">
                        <!-- Comments injected here -->
                    </div>
                </div>
            </div>
        `;

        modal.style.display = 'block';

        // Helper: show fallback action buttons (scrape + IG link)
        function comp_showFallbackActions() {
            const actionContainer = document.getElementById('comp-modal-actions-container');
            if (!actionContainer) return;
            actionContainer.innerHTML = `
                <button id="comp-btn-modal-scrape-comments" class="btn btn-warning" style="flex: 1;">📝 Scrape Comments</button>
                <a href="${postLink}" target="_blank" class="btn btn-secondary" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center;">IG ↗</a>
            `;
            const modalScrapeBtn = document.getElementById('comp-btn-modal-scrape-comments');
            if (modalScrapeBtn) modalScrapeBtn.onclick = triggerScrape;
        }

        // Check if we already have comments for this post
        try {
            chrome.runtime.sendMessage({ type: 'CHECK_SCRAPED_POSTS', shortcodes: [post.shortcode] }, (res) => {
                if (chrome.runtime.lastError) {
                    console.warn('[comp_openTopPostModal] CHECK_SCRAPED_POSTS error:', chrome.runtime.lastError.message);
                    comp_showFallbackActions();
                    return;
                }

                const hasScraped = res && res.success && res.counts && res.counts[post.shortcode] > 0;
                const scrapedCount = (res && res.counts && res.counts[post.shortcode]) || 0;
                const actionContainer = document.getElementById('comp-modal-actions-container');
                if (!actionContainer) return;

                if (hasScraped) {
                    // Found existing scraped comments
                    actionContainer.innerHTML = `
                        <button id="comp-btn-modal-view-comments" class="btn btn-success" style="flex: 1;">👁️ View ${scrapedCount} Scraped Comments</button>
                        <button id="comp-btn-modal-scrape-comments" class="btn btn-warning" style="flex: 1;">🔄 Re-Scrape</button>
                        <a href="${postLink}" target="_blank" class="btn btn-secondary" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center;">IG ↗</a>
                    `;

                    document.getElementById('comp-btn-modal-view-comments').onclick = () => {
                        const viewer = document.getElementById('comp-modal-comments-viewer');
                        const listEl = document.getElementById('comp-comments-list');
                        if (!viewer || !listEl) return;

                        if (viewer.style.display === 'block') {
                            viewer.style.display = 'none';
                            return;
                        }

                        showToast('Loading comments...', 'info');
                        try {
                            chrome.runtime.sendMessage({ type: 'GET_COMMENTS_FOR_POSTS', shortcodes: [post.shortcode] }, (response) => {
                                if (chrome.runtime.lastError) {
                                    console.warn('[comp_openTopPostModal] GET_COMMENTS error:', chrome.runtime.lastError.message);
                                    showToast('Failed to load comments.', 'error');
                                    return;
                                }
                                if (!response || !response.success || response.comments.length === 0) {
                                    showToast('No comments found.', 'warning');
                                    return;
                                }

                                viewer.style.display = 'block';
                                listEl.innerHTML = response.comments.map(c => `
                                    <div class="comment-item" style="padding: 10px 0; border-bottom: 1px solid var(--bg-hover);">
                                        <div style="display: flex; justify-content: space-between; font-size: 0.85em; margin-bottom: 4px;">
                                            <strong>@${escapeHtml(c.username)}</strong>
                                            <span style="color: var(--text-muted);">${new Date(c.created_at * (c.created_at > 10000000000 ? 1 : 1000)).toLocaleDateString()}</span>
                                        </div>
                                        <div class="comment-text" style="font-size: 0.9em;">${escapeHtml(c.text)}</div>
                                    </div>
                                 `).join('');

                                document.getElementById('comp-btn-export-single-xlsx').onclick = () => {
                                    const enriched = enrichComments(response.comments, [post]);
                                    downloadAsXLSX(enriched);
                                };
                            });
                        } catch (e) {
                            console.warn('[comp_openTopPostModal] GET_COMMENTS exception:', e);
                            showToast('Failed to load comments.', 'error');
                        }
                    };
                } else {
                    // No existing comments
                    actionContainer.innerHTML = `
                        <button id="comp-btn-modal-scrape-comments" class="btn btn-warning" style="flex: 1;">📝 Scrape Comments</button>
                        <a href="${postLink}" target="_blank" class="btn btn-secondary" style="flex: 1; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center;">IG ↗</a>
                    `;
                }

                // Attach scrape listener
                const modalScrapeBtn = document.getElementById('comp-btn-modal-scrape-comments');
                if (modalScrapeBtn) modalScrapeBtn.onclick = triggerScrape;
            });
        } catch (e) {
            console.warn('[comp_openTopPostModal] sendMessage exception:', e);
            comp_showFallbackActions();
        }

        async function triggerScrape() {
            const modalScrapeBtn = document.getElementById('comp-btn-modal-scrape-comments');
            if (!modalScrapeBtn) return;

            const originalText = modalScrapeBtn.textContent;
            modalScrapeBtn.textContent = 'Scraping...';
            modalScrapeBtn.disabled = true;

            showToast(`Starting comment scrape for ${post.shortcode}...`, 'info');

            try {
                console.log(`[Modal Scraper] Sending StartParsing for ${post.shortcode}...`);
                chrome.runtime.sendMessage({
                    type: "StartParsing",
                    shortcode: post.shortcode,
                    limit: 1000
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[comp_openTopPostModal] StartParsing error:', chrome.runtime.lastError.message);
                        modalScrapeBtn.textContent = originalText;
                        modalScrapeBtn.disabled = false;
                        showToast('Scrape failed: extension channel error. Try refreshing.', 'error');
                        return;
                    }
                    console.log(`[Modal Scraper] Response for ${post.shortcode}:`, response);
                    modalScrapeBtn.textContent = originalText;
                    modalScrapeBtn.disabled = false;

                    if (response && response.success) {
                        const comments = response.comments || [];
                        showToast(`Scraped ${comments.length} comments!`, 'success');
                    } else {
                        showToast(`Error: ${response?.error || 'Unknown error'}`, 'error');
                    }
                });
            } catch (err) {
                modalScrapeBtn.textContent = originalText;
                modalScrapeBtn.disabled = false;
                showToast(`Scrape failed: ${err.message}`, 'error');
            }
        }
    }

    function comp_renderCollaborations(data) {
        const container = document.getElementById('comp-collaborations');
        if (!container || !data.success) return;
        container.innerHTML = '';

        const collabs = data.collaborations || {};
        const allUsernames = [compSelectedBrand, ...compSelectedCompetitors];

        for (const username of allUsernames) {
            const items = collabs[username] || [];
            const roleLabel = username === compSelectedBrand ? '🏢' : '🐰';

            // Track exclusion state per collaborator item
            items.forEach(item => { if (item._excluded === undefined) item._excluded = false; });

            // Build the card via DOM so we can wire up click handlers
            const card = document.createElement('div');
            card.className = 'comp-collab-card';

            const header = document.createElement('div');
            header.className = 'comp-collab-card-header';
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'flex-start';

            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.flexDirection = 'column';
            titleContainer.style.gap = '4px';

            const titleEl = document.createElement('div');
            titleEl.className = 'comp-collab-card-title';
            titleEl.textContent = `${roleLabel} @${username}`;

            const summaryEl = document.createElement('div');
            summaryEl.className = 'comp-collab-card-summary';

            titleContainer.appendChild(titleEl);
            titleContainer.appendChild(summaryEl);
            header.appendChild(titleContainer);

            // Per-card Toggle All Button
            const toggleAllBtn = document.createElement('button');
            toggleAllBtn.className = 'btn btn-secondary btn-sm';
            toggleAllBtn.style.cssText = 'font-size: 10px; padding: 3px 8px; border-radius: 12px; margin-top: 2px;';
            toggleAllBtn.innerHTML = '☑️ Deselect All';
            let allExcluded = false;

            header.appendChild(toggleAllBtn);
            card.appendChild(header);

            const listEl = document.createElement('div');
            listEl.className = 'comp-collab-list';
            listEl.style.maxHeight = '300px';
            listEl.style.overflowY = 'auto';

            // We need an array of row elements to update them when toggleAll is clicked
            const rowElements = [];

            // Recalculate totals excluding toggled-off items
            const recalcTotals = () => {
                const activePosts = items.reduce((s, i) => s + (i._excluded ? 0 : i.post_count), 0);
                const activeReach = items.reduce((s, i) => s + (i._excluded ? 0 : (i.followers * i.post_count)), 0);
                summaryEl.textContent = `${activePosts} total posts · ${formatReach(activeReach)} reach`;
            };

            if (items.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'color: var(--text-muted); font-size: 13px; padding: 8px;';
                empty.textContent = 'No collaborations found.';
                listEl.appendChild(empty);
                toggleAllBtn.style.display = 'none'; // hide if empty
            } else {
                for (const item of items) {
                    const itemReach = (item.followers || 0) * (item.post_count || 0);
                    const row = document.createElement('div');
                    row.className = 'comp-collab-item';
                    row.style.cursor = 'pointer';
                    row.style.transition = 'opacity 0.2s, filter 0.2s';
                    row.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 16px;">
                            <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
                                <span class="comp-collab-item-name" style="font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">@${escapeHtml(item.collaborator)}</span>
                                </div>
                                <span class="comp-collab-item-meta" style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.post_count} ps · ${formatReach(item.followers)} fl · ${formatReach(itemReach)} reach</span>
                            <button class="btn btn-primary btn-sm view-collab-posts-btn" style="font-size: 11px; padding: 4px 10px; border-radius: 12px; white-space: nowrap; flex-shrink: 0;">👁️</button>
                        </div>
                    `;

                    row.addEventListener('click', (e) => {
                        // Prevent toggling if they clicked the view button
                        if (e.target.closest('.view-collab-posts-btn')) return;

                        item._excluded = !item._excluded;
                        row.style.opacity = item._excluded ? '0.4' : '1';
                        row.style.filter = item._excluded ? 'grayscale(0.6)' : 'none';
                        recalcTotals();
                        comp_recalcFromExclusions();

                        // Update toggle all button text based on whether all are selected or deselected
                        const allAreExcluded = items.every(i => i._excluded);
                        if (allAreExcluded) {
                            allExcluded = true;
                            toggleAllBtn.innerHTML = '☐ Select All';
                        } else {
                            allExcluded = false;
                            toggleAllBtn.innerHTML = '☑️ Deselect All';
                        }
                    });

                    // Add click handler for the view button
                    const viewBtn = row.querySelector('.view-collab-posts-btn');
                    viewBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        comp_openCollabPostsModal(username, item.collaborator, item.posts);
                    });

                    rowElements.push({ item, row });
                    listEl.appendChild(row);
                }
            }

            toggleAllBtn.addEventListener('click', () => {
                allExcluded = !allExcluded;
                toggleAllBtn.innerHTML = allExcluded ? '☐ Select All' : '☑️ Deselect All';

                rowElements.forEach(({ item, row }) => {
                    item._excluded = allExcluded;
                    row.style.opacity = allExcluded ? '0.4' : '1';
                    row.style.filter = allExcluded ? 'grayscale(0.6)' : 'none';
                });

                recalcTotals();
                comp_recalcFromExclusions();
            });

            card.appendChild(listEl);
            container.appendChild(card);

            // Initial total calculation
            recalcTotals();
        }
    }

    function comp_openCollabPostsModal(brandUsername, collaborator, shortcodes) {
        // Clear previous content
        modalDetails.innerHTML = '';
        
        let html = `
            <div class="modal-info-container" style="width: 100%; max-width: 600px; margin: 0 auto;">
                <div class="modal-info-header">
                    <div class="modal-username" style="font-size: 18px; margin-bottom: 5px;">🤝 Shared Posts</div>
                </div>
                <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 20px;">
                    Posts involving both <strong>@${escapeHtml(brandUsername)}</strong> and <strong>@${escapeHtml(collaborator)}</strong>.
                </p>
                <div class="comp-collab-list" style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background-color: var(--surface-color);">
        `;
        
        if (!shortcodes || shortcodes.length === 0) {
            html += `<div style="padding: 15px; text-align: center; color: var(--text-muted);">No posts found.</div>`;
        } else {
            for (const item of shortcodes) {
                // Items may be plain shortcode strings (backend response) or objects
                // { shortcode, image_url } (local-mode computation).
                const code = typeof item === 'string' ? item : (item.shortcode || item.code || '');
                const rawImg = typeof item === 'string' ? '' : (item.image_url || item.imageUrl || '');
                // Fall back to an asset that actually exists (icons/placeholder.png does not).
                const img = rawImg || 'icons/icon128.png';

                html += `
                    <div style="padding: 12px 15px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <img src="${escapeHtml(img)}" class="comp-collab-thumb" style="width: 44px; height: 44px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border-color); background: var(--bg-hover);">
                            <span style="font-family: monospace; font-size: 13px; color: var(--text-color);">${escapeHtml(code)}</span>
                        </div>
                        <a href="https://www.instagram.com/p/${escapeHtml(code)}/" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 12px; padding: 6px 12px; border-radius: 14px; text-decoration: none; flex-shrink: 0;">
                            ↗ View on IG
                        </a>
                    </div>
                `;
            }
        }

        html += `</div></div>`;
        modalDetails.innerHTML = html;

        // Swap broken thumbnails (missing/expired IG CDN URLs) to a real asset.
        // Inline onerror attributes are blocked by the extension CSP, so wire it here.
        const fallbackSrc = chrome.runtime.getURL('icons/icon128.png');
        modalDetails.querySelectorAll('img.comp-collab-thumb').forEach((imgEl) => {
            imgEl.addEventListener('error', function handleImgError() {
                this.removeEventListener('error', handleImgError);
                if (this.src !== fallbackSrc) this.src = fallbackSrc;
            });
        });

        modal.style.display = 'block';
    }

    async function comp_exportComments(scope) {
        if (!projCurrentProjectId) { showToast('No project loaded.', 'warning'); return; }
        const { token, apiUrl } = await getApiCredentials();
        if (!token) { showToast('Not logged in.', 'error'); return; }

        let usernames = [];
        if (scope === 'brand') usernames = compSelectedBrand ? [compSelectedBrand] : [];
        else if (scope === 'competitors') usernames = compSelectedCompetitors;
        else usernames = [compSelectedBrand, ...compSelectedCompetitors].filter(Boolean);

        if (usernames.length === 0) { showToast('No profiles selected.', 'warning'); return; }

        showToast('Fetching comments...', 'info');

        try {
            const res = await fetch(`${apiUrl}/api/comments?project_id=${projCurrentProjectId}&limit=10000`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) { showToast('Failed to fetch comments (Server Error).', 'error'); return; }
            const data = await res.json();
            if (!data.success) { showToast('Failed to fetch comments.', 'error'); return; }

            // Filter comments by posts belonging to selected usernames
            const relevantShortcodes = new Set();
            for (const post of projPostsData) {
                if (usernames.includes(post.owner_username)) {
                    relevantShortcodes.add(post.shortcode);
                }
            }
            const filtered = data.comments.filter(c => relevantShortcodes.has(c.post_shortcode));

            if (filtered.length === 0) {
                showToast('No comments found for selected profiles.', 'warning');
                return;
            }

            return filtered;
        } catch (err) {
            console.error('[Competitive Export] Error:', err);
            showToast('Failed to export comments.', 'error');
            return null;
        }
    }

    function comp_downloadCSV(comments, filename) {
        if (!comments || comments.length === 0) return;
        const headers = ['post_shortcode', 'username', 'text', 'likes_count', 'commented_at'];
        const rows = comments.map(c => [
            c.post_shortcode || '',
            c.username || '',
            `"${(c.text || '').replace(/"/g, '""')}"`,
            c.likes_count || 0,
            c.commented_at || '',
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${comments.length} comments.`, 'success');
    }

    function comp_downloadJSON(data, filename) {
        if (!data) return;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported data successfully.`, 'success');
    }

    async function comp_exportAllDataJson() {
        if (!projCurrentProjectId) { showToast('No project loaded.', 'warning'); return; }
        if (!compDashboardData) { showToast('Please load the dashboard first.', 'warning'); return; }

        showToast('Preparing full project dashboard JSON export...', 'info');

        const usernames = [compSelectedBrand, ...compSelectedCompetitors].filter(Boolean);

        // Fetch comments quietly without showing separate toast (or comp_exportComments handles it)
        const comments = await comp_exportComments('all');

        // Filter posts 
        const posts = projPostsData.filter(post => usernames.includes(post.owner_username));

        // Attach comments to posts
        const postsWithComments = posts.map(post => {
            return {
                ...post,
                scraped_comments: comments ? comments.filter(c => c.post_shortcode === post.shortcode) : []
            };
        });

        const exportData = {
            timestamp: new Date().toISOString(),
            version: '1.2',
            projectId: projCurrentProjectId,
            brand: compSelectedBrand,
            competitors: compSelectedCompetitors,
            summary: compDashboardData.profiles || [],
            timeseries: compTimeseriesData?.timeseries || [],
            collaborations: compCollabsData?.collaborations || {},
            posts: postsWithComments
        };

        comp_downloadJSON(exportData, `dashboard_data_export_${Date.now()}.json`);
    }

    // Wire up competitive dashboard events
    if (compBrandSelect) compBrandSelect.addEventListener('change', (e) => { compSelectedBrand = e.target.value; });
    if (compAddCompetitor) compAddCompetitor.addEventListener('change', (e) => { if (e.target.value) comp_addCompetitor(e.target.value); });

    // Username search box → live results, assign as brand/competitor.
    if (compSearchInput) {
        compSearchInput.addEventListener('input', (e) => comp_renderSearchResults(e.target.value));
        compSearchInput.addEventListener('focus', (e) => comp_renderSearchResults(e.target.value));
    }
    if (compSearchResults) {
        compSearchResults.addEventListener('click', (e) => {
            const btn = e.target.closest('.comp-search-assign');
            if (!btn) return;
            comp_assignFromSearch(btn.getAttribute('data-username'), btn.getAttribute('data-role'));
        });
    }
    // Close the results dropdown when clicking outside the search box.
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('comp-search-wrap');
        if (compSearchResults && wrap && !wrap.contains(e.target)) {
            compSearchResults.style.display = 'none';
        }
    });
    if (compBtnLoad) compBtnLoad.addEventListener('click', comp_loadDashboard);
    if (compBtnRefresh) compBtnRefresh.addEventListener('click', comp_loadDashboard);
    if (compBtnReset) compBtnReset.addEventListener('click', () => {
        compSelectedBrand = null;
        compSelectedCompetitors = [];
        compCollabsData = null;
        compStartDate = null;
        compEndDate = null;
        compActivePreset = 'all';
        if (compBrandSelect) compBrandSelect.value = '';
        comp_renderCompetitorChips();
        if (compDashboard) compDashboard.style.display = 'none';
        if (compEmptyState) compEmptyState.style.display = 'block';
        const compTimeFilter = document.getElementById('comp-time-filter');
        if (compTimeFilter) compTimeFilter.style.display = 'none';
        // Reset preset UI
        document.querySelectorAll('.comp-time-preset').forEach(b => b.classList.remove('active'));
        const allBtn = document.querySelector('.comp-time-preset[data-preset="all"]');
        if (allBtn) allBtn.classList.add('active');
        const compTimeCustom = document.getElementById('comp-time-custom');
        if (compTimeCustom) compTimeCustom.style.display = 'none';
        const compActiveRange = document.getElementById('comp-active-range');
        if (compActiveRange) compActiveRange.textContent = '';
        chrome.storage.local.remove('comp_pinned');
    });
    if (compChartMetric) compChartMetric.addEventListener('change', () => { if (compTimeseriesData) comp_renderTimeSeries(compTimeseriesData); });
    if (compChartInterval) compChartInterval.addEventListener('change', () => { if (compTimeseriesData) comp_renderTimeSeries(compTimeseriesData); });

    // Edit Colors button
    const compBtnEditColors = document.getElementById('comp-btn-edit-colors');
    if (compBtnEditColors) {
        compBtnEditColors.addEventListener('click', () => {
            compColorEditMode = !compColorEditMode;
            compBtnEditColors.classList.toggle('active', compColorEditMode);
            if (compColorEditMode) {
                showToast('Click any color dot in the legend below to change its color.', 'info');
                // Pulse the legend dots
                document.querySelectorAll('.comp-legend-dot').forEach(d => {
                    d.style.border = '2px solid rgba(255,255,255,0.5)';
                });
            } else {
                document.querySelectorAll('.comp-legend-dot').forEach(d => {
                    d.style.border = '2px solid transparent';
                });
            }
        });
    }

    // --- Time Range Filter Event Wiring ---
    document.querySelectorAll('.comp-time-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            comp_applyTimePreset(preset);
        });
    });

    const compDateApply = document.getElementById('comp-date-apply');
    if (compDateApply) {
        compDateApply.addEventListener('click', () => {
            const startInput = document.getElementById('comp-date-start');
            const endInput = document.getElementById('comp-date-end');
            if (!startInput.value && !endInput.value) {
                showToast('Please select at least one date.', 'warning');
                return;
            }
            if (startInput.value && endInput.value && startInput.value > endInput.value) {
                showToast('Start date must be before end date.', 'warning');
                return;
            }
            compStartDate = startInput.value || null;
            compEndDate = endInput.value || null;
            compActivePreset = 'custom';
            comp_updateActiveRangeLabel();
            comp_loadDashboard();
        });
    }

    function comp_applyTimePreset(preset) {
        const now = new Date();
        const compTimeCustom = document.getElementById('comp-time-custom');

        // Update active button UI
        document.querySelectorAll('.comp-time-preset').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.comp-time-preset[data-preset="${preset}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        if (preset === 'custom') {
            if (compTimeCustom) compTimeCustom.style.display = 'flex';
            return; // Don't reload — user will click Apply
        }

        if (compTimeCustom) compTimeCustom.style.display = 'none';
        compActivePreset = preset;

        if (preset === 'all') {
            compStartDate = null;
            compEndDate = null;
        } else if (preset === '7d') {
            const d = new Date(now);
            d.setDate(d.getDate() - 7);
            compStartDate = d.toISOString().split('T')[0];
            compEndDate = now.toISOString().split('T')[0];
        } else if (preset === '30d') {
            const d = new Date(now);
            d.setDate(d.getDate() - 30);
            compStartDate = d.toISOString().split('T')[0];
            compEndDate = now.toISOString().split('T')[0];
        } else if (preset === '90d') {
            const d = new Date(now);
            d.setDate(d.getDate() - 90);
            compStartDate = d.toISOString().split('T')[0];
            compEndDate = now.toISOString().split('T')[0];
        } else if (preset === 'month') {
            compStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            compEndDate = now.toISOString().split('T')[0];
        } else if (preset === 'lastyear') {
            const d = new Date(now);
            d.setFullYear(d.getFullYear() - 1);
            compStartDate = d.toISOString().split('T')[0];
            compEndDate = now.toISOString().split('T')[0];
        }

        comp_updateActiveRangeLabel();

        // Only reload if dashboard is already loaded
        if (compDashboardData) {
            comp_loadDashboard();
        }
    }

    function comp_updateActiveRangeLabel() {
        const label = document.getElementById('comp-active-range');
        if (!label) return;

        if (!compStartDate && !compEndDate) {
            label.textContent = '';
            return;
        }

        const formatDate = (iso) => {
            if (!iso) return '...';
            const d = new Date(iso + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };

        label.textContent = `📅 ${formatDate(compStartDate)} – ${formatDate(compEndDate)}`;
    }

    // Comment export buttons
    const compExportBrandCsv = document.getElementById('comp-export-brand-csv');
    const compExportCompCsv = document.getElementById('comp-export-comp-csv');
    const compExportAllCsv = document.getElementById('comp-export-all-csv');
    const compExportAllJson = document.getElementById('comp-export-all-json');
    if (compExportBrandCsv) compExportBrandCsv.addEventListener('click', async () => { const c = await comp_exportComments('brand'); if (c) comp_downloadCSV(c, `brand_comments_${Date.now()}.csv`); });
    if (compExportCompCsv) compExportCompCsv.addEventListener('click', async () => { const c = await comp_exportComments('competitors'); if (c) comp_downloadCSV(c, `competitor_comments_${Date.now()}.csv`); });
    if (compExportAllCsv) compExportAllCsv.addEventListener('click', async () => { const c = await comp_exportComments('all'); if (c) comp_downloadCSV(c, `all_comments_${Date.now()}.csv`); });
    if (compExportAllJson) compExportAllJson.addEventListener('click', comp_exportAllDataJson);


    // --- API Helpers for profile management ---
    async function projChangeRole(username, newRole, silent = false) {
        if (!projCurrentProjectId) return;
        const { token, apiUrl } = await getApiCredentials();
        try {
            const res = await fetch(`${apiUrl}/api/projects/${projCurrentProjectId}/profiles/${encodeURIComponent(username)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ role: newRole })
            });
            const data = await res.json();
            if (data.success) {
                if (!silent) showToast(`@${username} role updated to ${newRole}`, 'success');
                projLoadProjectData(projCurrentProjectId);
            } else {
                if (!silent) showToast(data.error || 'Failed to update role', 'error');
            }
        } catch (err) {
            if (!silent) showToast('Failed to update role', 'error');
        }
    }

    async function projTogglePin(username) {
        if (!projCurrentProjectId) return;
        const { token, apiUrl } = await getApiCredentials();
        try {
            const res = await fetch(`${apiUrl}/api/projects/${projCurrentProjectId}/profiles/${encodeURIComponent(username)}/pin`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                showToast(`@${username} ${data.pinned ? 'pinned' : 'unpinned'}`, 'success');
                projLoadProjectData(projCurrentProjectId);
            } else {
                showToast(data.error || 'Failed to toggle pin', 'error');
            }
        } catch (err) {
            showToast('Failed to toggle pin', 'error');
        }
    }

    async function projRemoveProfile(username) {
        if (!projCurrentProjectId) return;
        const { token, apiUrl } = await getApiCredentials();
        try {
            const res = await fetch(`${apiUrl}/api/projects/${projCurrentProjectId}/profiles/${encodeURIComponent(username)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                showToast(`@${username} removed from project`, 'success');
                projLoadProjectData(projCurrentProjectId);
            } else {
                showToast(data.error || 'Failed to remove profile', 'error');
            }
        } catch (err) {
            showToast('Failed to remove profile', 'error');
        }
    }

    // --- Delete project ---
    async function projDeleteProject() {
        if (!projCurrentProjectId) {
            showToast('No project selected.', 'warning');
            return;
        }
        const selectedOpt = projSelect.options[projSelect.selectedIndex];
        const projName = selectedOpt ? selectedOpt.textContent.split(' (')[0] : 'this project';

        if (!confirm(`Delete project "${projName}"?\n\nThis will permanently remove all project associations (profiles and posts links).\nGlobal Instagram data will NOT be deleted.`)) {
            return;
        }

        const { token, apiUrl } = await getApiCredentials();
        try {
            const res = await fetch(`${apiUrl}/api/projects/${projCurrentProjectId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Project "${projName}" deleted!`, 'success');
                projCurrentProjectId = null;
                // Clear active project from storage
                chrome.storage.local.get(['extension_settings'], (result) => {
                    const settings = result.extension_settings || {};
                    delete settings.activeProjectId;
                    chrome.storage.local.set({ extension_settings: settings });
                });
                await projLoadProjects();
            } else {
                showToast(data.error || 'Failed to delete project', 'error');
            }
        } catch (err) {
            showToast('Failed to delete project', 'error');
        }
    }

    // --- Render posts (paginated) ---
    function projRenderPosts() {
        projPostsGrid.innerHTML = '';

        const dataToRender = projActiveProfileFilter
            ? projPostsData.filter(p =>
                p.owner_username === projActiveProfileFilter ||
                (p.coauthors && p.coauthors.some(c => c.username === projActiveProfileFilter))
              )
            : projPostsData;

        if (dataToRender.length === 0) {
            if (projPostsEmpty) projPostsEmpty.style.display = 'block';
            if (projPagination) projPagination.style.display = 'none';
            return;
        }
        if (projPostsEmpty) projPostsEmpty.style.display = 'none';

        const totalPages = Math.ceil(dataToRender.length / PROJ_PER_PAGE);
        const start = (projCurrentPage - 1) * PROJ_PER_PAGE;
        const end = Math.min(start + PROJ_PER_PAGE, dataToRender.length);
        const pagePosts = dataToRender.slice(start, end);

        for (const post of pagePosts) {
            const card = document.createElement('div');
            card.className = 'post-card';
            card.style.cursor = 'pointer';

            let dateStr = 'Unknown';
            if (post.posted_at) {
                const d = new Date(post.posted_at);
                dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            }

            const imgUrl = post.image_url || 'icons/placeholder.png';
            const owner = post.owner_username || 'unknown';

            // Build collaborator label for post header
            const projCoauthors = post.coauthors || [];
            const projCoauthorLabel = projCoauthors.length > 0
                ? ', ' + projCoauthors.map(c => '@' + escapeHtml(c.username || c)).join(', ')
                : '';

            // Get latest metrics
            let likes = 0, comments = 0;
            if (post.latest_metrics && Array.isArray(post.latest_metrics) && post.latest_metrics[0]) {
                likes = post.latest_metrics[0].likes || 0;
                comments = post.latest_metrics[0].comments || 0;
            }

            let typeBadge = 'PHOTO';
            if (post.is_video) typeBadge = 'VIDEO';
            else if (post.is_carousel) typeBadge = 'CAROUSEL';

            let classBadge = '';
            if (post.classification === 'Paid Partnership Collab') {
                classBadge = '<span class="badge badge-paid">💰 PAID</span><span class="badge badge-collab">🤝 COLLAB</span>';
            } else if (post.classification === 'Paid Partnership') {
                classBadge = '<span class="badge badge-paid">💰 PAID</span>';
            } else if (post.classification === 'Collaboration') {
                classBadge = '<span class="badge badge-collab">🤝 COLLAB</span>';
            }

            card.innerHTML = `
                <div class="post-img-wrapper">
                    <img src="${imgUrl}" alt="Post" class="post-img" loading="lazy">
                    <span class="badge">${typeBadge}</span>
                    ${classBadge}
                </div>
                <div class="post-content">
                    <div class="post-header">
                        <span class="post-username">@${escapeHtml(owner)}${projCoauthorLabel}</span>
                        <span>${dateStr}</span>
                    </div>
                    <div class="post-footer">
                        <div class="metric">❤️ <span class="stat-value" data-value="${likes}">${formatStatNumber(likes)}</span></div>
                        <div class="metric">💬 <span class="stat-value" data-value="${comments}">${formatStatNumber(comments)}</span></div>
                        <div class="metric">📊 <span class="stat-value" data-value="${post.sentiment_score || 0}">${formatStatNumber(post.sentiment_score || 0)}</span></div>
                    </div>
                </div>
            `;

            card.onclick = () => {
                window.open(`https://www.instagram.com/p/${post.shortcode}/`, '_blank');
            };

            projPostsGrid.appendChild(card);
        }

        // Pagination
        if (totalPages > 1) {
            projPagination.style.display = 'flex';
            projPageIndicator.textContent = `Page ${projCurrentPage} of ${totalPages}`;
            projBtnPrev.disabled = projCurrentPage === 1;
            projBtnNext.disabled = projCurrentPage === totalPages;
        } else {
            projPagination.style.display = 'none';
        }
    }

    // --- Create project ---
    async function projCreateProject() {
        const name = projNewName.value.trim();
        if (!name) {
            projCreateError.textContent = 'Please enter a project name.';
            projCreateError.style.display = 'block';
            return;
        }

        projBtnCreateSubmit.disabled = true;
        projBtnCreateSubmit.textContent = 'Creating...';
        projCreateError.style.display = 'none';

        try {
            const { token, apiUrl } = await getApiCredentials();
            const res = await fetch(`${apiUrl}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name, description: projNewDesc.value.trim() || null })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                projCreateModal.style.display = 'none';
                const newProjectId = String(data.project.id);
                showToast(`Project "${name}" created!`, 'success');

                // Save as active project
                await new Promise(resolve => {
                    chrome.storage.local.get(['extension_settings'], (result) => {
                        const settings = result.extension_settings || {};
                        settings.activeProjectId = newProjectId;
                        chrome.storage.local.set({ extension_settings: settings }, resolve);
                    });
                });

                // 🔥 Auto-adopt: if there are unassigned posts, prompt user to assign them
                try {
                    const unassigned = await PostsStore.getUnassignedPosts();
                    if (unassigned.length > 0) {
                        const doAdopt = confirm(
                            `You have ${unassigned.length} unassigned captured post(s).\n\n` +
                            `Do you want to add them to "${name}"?`
                        );
                        if (doAdopt) {
                            const shortcodes = unassigned.map(p => p.shortcode).filter(Boolean);
                            await PostsStore.assignToProject(shortcodes, newProjectId);
                            showToast(`Auto-assigned ${shortcodes.length} posts to "${name}"!`, 'success');
                            console.log(`[Projects] Auto-adopted ${shortcodes.length} unassigned posts into new project ${newProjectId}`);
                        }
                    }
                } catch (adoptErr) {
                    console.warn('[Projects] Auto-adopt failed (posts remain unassigned):', adoptErr.message);
                }

                await projLoadProjects();
                projSelect.value = data.project.id;
                if (compProjSelect) compProjSelect.value = data.project.id;
                projLoadProjectData(data.project.id);
            } else {
                projCreateError.textContent = data.error || 'Failed to create project.';
                projCreateError.style.display = 'block';
            }
        } catch (err) {
            projCreateError.textContent = 'Could not connect to server.';
            projCreateError.style.display = 'block';
        } finally {
            projBtnCreateSubmit.disabled = false;
            projBtnCreateSubmit.textContent = 'Create';
        }
    }

    // --- Import to Local: copy server data into local Dataset Viewer ---
    async function projImportToLocal() {
        if (projPostsData.length === 0) {
            showToast('No posts to import. Select a project first.', 'warning');
            return;
        }

        // Convert server format to local format
        const localPosts = projPostsData.map(p => {
            let likes = 0, comments = 0;
            if (p.latest_metrics && Array.isArray(p.latest_metrics) && p.latest_metrics[0]) {
                likes = p.latest_metrics[0].likes || 0;
                comments = p.latest_metrics[0].comments || 0;
            }

            // Look up owner's follower_count from profiles data
            const ownerProfile = projProfilesData.find(pr => pr.username === p.owner_username);
            const ownerFollowers = ownerProfile?.follower_count || 0;

            return {
                shortcode: p.shortcode,
                postUrl: p.post_url || `https://www.instagram.com/p/${p.shortcode}/`,
                caption: p.caption || '',
                imageUrl: p.image_url || null,
                videoUrl: p.video_url || null,
                isVideo: p.is_video || false,
                isCarousel: p.is_carousel || false,
                isPaid: p.is_paid || false,
                classification: p.classification || 'Normal Post',
                type: p.type || 'normal',
                likes,
                comments,
                timestamp: p.posted_at ? Math.floor(new Date(p.posted_at).getTime() / 1000) : null,
                owner: { username: p.owner_username, follower_count: ownerFollowers },
                collectiveReach: p.collective_reach || 0,
                reachBreakdown: p.reach_breakdown || [],
                scrapedFromProfile: p.scraped_from_profile || p.owner_username,
                is_reference: p.is_reference || false,
                // Collaborator data from server
                coauthors: p.coauthors || [],
                coauthor_producers: p.coauthors || [],
                sponsors: p.sponsors || [],
                sponsor_tags: p.sponsors || [],
                tagged_users: p.tagged_users || [],
                caption_user: p.caption_user || null,
            };
        });

        // REPLACE (not merge) local dataset with project data via PostsStore
        const normalized = localPosts.map(normalizePostData);

        // Route through PostsStore — merge into byId and assign to project
        _suppressStorageReload = true;
        try {
            if (projCurrentProjectId) {
                await PostsStore.mergeProjectPosts(normalized, projCurrentProjectId);
            } else {
                await PostsStore.addPosts(normalized);
            }
        } catch (storeErr) {
            console.warn('[Projects] PostsStore import error:', storeErr);
        }
        _suppressStorageReload = false;

        // Update in-memory state directly (don't wait for storage listener)
        allPosts = normalized;

        // Persist project profiles into chrome.storage.local so that
        // reach data survives a page reload without re-opening the project.
        if (projProfilesData.length > 0) {
            chrome.storage.local.get(['profiles_dataset'], (result) => {
                const existing = result.profiles_dataset || [];
                for (const pp of projProfilesData) {
                    const idx = existing.findIndex(g => g.username === pp.username);
                    if (idx !== -1) {
                        Object.assign(existing[idx], pp);
                    } else {
                        existing.push({ ...pp });
                    }
                }
                chrome.storage.local.set({ profiles_dataset: existing });
                // Also update in-memory dataset
                globalProfilesDataset = existing;
            });
        }

        // Persist the active project so it survives page refresh
        if (projCurrentProjectId) {
            chrome.storage.local.get(['extension_settings'], (result) => {
                const settings = result.extension_settings || {};
                settings.activeProjectId = String(projCurrentProjectId);
                chrome.storage.local.set({ extension_settings: settings });
            });
        }

        // Reset filters for clean state
        activeProfileFilter = null;
        activeClassFilter = 'all';
        activeScrapeFilter = 'all';
        document.querySelectorAll('.class-filter-chip, .comm-class-filter-chip').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-filter') === 'all');
        });
        document.querySelectorAll('.comm-scrape-filter-chip').forEach(c => {
            c.classList.toggle('active', c.getAttribute('data-scrape-filter') === 'all');
        });

        processData();
        showToast(`Imported ${localPosts.length} posts from project to local viewer!`, 'success');
    }

    // --- Wire up events ---
    if (projSelect) {
        projSelect.addEventListener('change', () => {
            const id = projSelect.value;
            if (id) {
                // Save active project
                chrome.storage.local.get(['extension_settings'], (result) => {
                    const settings = result.extension_settings || {};
                    settings.activeProjectId = String(id);
                    chrome.storage.local.set({ extension_settings: settings });
                });
                // Keep Competitive Analysis selector in sync
                if (compProjSelect) compProjSelect.value = id;
                projLoadProjectData(id);
            }
        });
    }

    if (projBtnNew) {
        projBtnNew.addEventListener('click', () => {
            projCreateModal.style.display = 'block';
            projNewName.value = '';
            projNewDesc.value = '';
            projCreateError.style.display = 'none';
            projNewName.focus();
        });
    }

    if (compBtnNewProj) {
        compBtnNewProj.addEventListener('click', () => {
            projCreateModal.style.display = 'block';
            projNewName.value = '';
            projNewDesc.value = '';
            projCreateError.style.display = 'none';
            projNewName.focus();
        });
    }

    if (projBtnRefresh) {
        projBtnRefresh.addEventListener('click', async () => {
            projBtnRefresh.disabled = true;
            projBtnRefresh.textContent = '⏳ Loading...';
            await projLoadProjects();
            projBtnRefresh.disabled = false;
            projBtnRefresh.textContent = '⟳ Refresh';
        });
    }

    if (projBtnSyncDb) {
        projBtnSyncDb.addEventListener('click', async () => {
            if (!projCurrentProjectId) {
                showToast('Please select a project first.', 'warning');
                return;
            }
            projBtnSyncDb.disabled = true;
            projBtnSyncDb.textContent = '⏳ Syncing...';
            try {
                // Pre-sync integrity gate — block if data is inconsistent
                const integrity = await PostsStore.validateIntegrity();
                if (!integrity.valid) {
                    console.error('[Sync] Integrity errors:', integrity.errors);
                    showToast('Data inconsistency detected. Please refresh the page or check console for details.', 'error');
                    return;
                }

                // Get project-scoped posts from PostsStore
                const projectPosts = await PostsStore.getProjectPosts(projCurrentProjectId);
                if (projectPosts.length === 0) {
                    // Check if there are unassigned posts that could be assigned first
                    const unassignedPosts = await PostsStore.getUnassignedPosts();
                    if (unassignedPosts.length > 0) {
                        const doAssign = confirm(
                            `This project has 0 posts, but you have ${unassignedPosts.length} unassigned captured post(s).\n\n` +
                            `Would you like to assign all unassigned posts to this project and sync them?`
                        );
                        if (doAssign) {
                            const shortcodes = unassignedPosts.map(p => p.shortcode).filter(Boolean);
                            await PostsStore.assignToProject(shortcodes, projCurrentProjectId);
                            const nowProjectPosts = await PostsStore.getProjectPosts(projCurrentProjectId);
                            showToast(`Assigned ${shortcodes.length} posts to project. Syncing...`, 'success');
                            // Continue sync with newly assigned posts
                            const response = await new Promise(r => chrome.runtime.sendMessage({
                                type: 'SYNC_POSTS_TO_BACKEND',
                                posts: nowProjectPosts,
                                projectId: projCurrentProjectId
                            }, r));
                            if (response && response.success) {
                                showToast(`Synced ${nowProjectPosts.length} posts to database!`, 'success');
                                await projLoadProjects();
                                loadLocalData();
                            } else {
                                showToast('Sync failed: ' + (response?.error || 'Unknown error'), 'error');
                            }
                            return;
                        } else {
                            showToast('Sync cancelled. Assign posts to this project first.', 'info');
                            return;
                        }
                    } else {
                        showToast('No posts assigned to this project to sync. Capture posts first, then assign them.', 'info');
                        return;
                    }
                }
                const response = await new Promise(r => chrome.runtime.sendMessage({
                    type: 'SYNC_POSTS_TO_BACKEND',
                    posts: projectPosts,
                    projectId: projCurrentProjectId
                }, r));
                if (response && response.success) {
                    showToast(`Synced ${projectPosts.length} project posts to database!`, 'success');
                    // Reload project data from server to reflect the sync
                    await projLoadProjects();
                } else {
                    showToast('Sync failed: ' + (response?.error || 'Unknown error'), 'error');
                }
            } catch (err) {
                console.error('[Sync to DB] Error:', err);
                showToast('Sync failed: ' + err.message, 'error');
            } finally {
                projBtnSyncDb.disabled = false;
                projBtnSyncDb.textContent = '☁️ Sync to DB';
            }
        });
    }

    if (projBtnImportToLocal) {
        projBtnImportToLocal.addEventListener('click', projImportToLocal);
    }

    // --- Assign Unassigned Posts to Project ---
    if (projBtnAssignUnassigned) {
        projBtnAssignUnassigned.addEventListener('click', async () => {
            if (!projCurrentProjectId) {
                showToast('Please select a project first.', 'warning');
                return;
            }
            projBtnAssignUnassigned.disabled = true;
            projBtnAssignUnassigned.textContent = '⏳ Assigning...';
            try {
                const unassignedPosts = await PostsStore.getUnassignedPosts();
                if (unassignedPosts.length === 0) {
                    showToast('No unassigned posts available. Capture posts first.', 'info');
                    return;
                }

                const doAssign = confirm(
                    `Assign all ${unassignedPosts.length} unassigned post(s) to this project?\n\n` +
                    `This will move them from "Unassigned" into the active project.`
                );
                if (!doAssign) return;

                const shortcodes = unassignedPosts.map(p => p.shortcode).filter(Boolean);
                await PostsStore.assignToProject(shortcodes, projCurrentProjectId);

                showToast(`Assigned ${shortcodes.length} posts to project!`, 'success');
                console.log(`[Projects] Assigned ${shortcodes.length} unassigned posts to project ${projCurrentProjectId}`);

                // Refresh the UI to show the newly assigned posts
                loadLocalData();
            } catch (err) {
                console.error('[Assign] Error:', err);
                showToast('Failed to assign posts: ' + err.message, 'error');
            } finally {
                projBtnAssignUnassigned.disabled = false;
                projBtnAssignUnassigned.textContent = '📌 Assign to Project';
            }
        });
    }

    if (projBtnDelete) {
        projBtnDelete.addEventListener('click', projDeleteProject);
    }

    if (projBtnCreateSubmit) projBtnCreateSubmit.addEventListener('click', projCreateProject);
    if (projBtnCreateCancel) projBtnCreateCancel.addEventListener('click', () => projCreateModal.style.display = 'none');
    if (projModalClose) {
        projModalClose.addEventListener('click', () => projCreateModal.style.display = 'none');
    }
    if (projNewName) {
        projNewName.addEventListener('keyup', (e) => { if (e.key === 'Enter') projCreateProject(); });
    }

    if (projBtnPrev) projBtnPrev.addEventListener('click', () => { projCurrentPage--; projRenderPosts(); });
    if (projBtnNext) projBtnNext.addEventListener('click', () => { projCurrentPage++; projRenderPosts(); });

    if (projBtnExportCsv) {
        projBtnExportCsv.addEventListener('click', () => {
            const dataToExport = projActiveProfileFilter
                ? projPostsData.filter(p => p.owner_username === projActiveProfileFilter)
                : projPostsData;

            if (dataToExport.length === 0) return;
            const headers = ['Shortcode', 'Post URL', 'Owner', 'Classification', 'Posted At', 'Is Video', 'Is Carousel'];
            const rows = dataToExport.map(p => [
                p.shortcode,
                p.post_url || '',
                p.owner_username || '',
                p.classification || 'Normal Post',
                p.posted_at || '',
                p.is_video ? 'true' : 'false',
                p.is_carousel ? 'true' : 'false',
            ]);
            const content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const blob = new Blob([content], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `project_export_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Collapse logic for profiles
    if (projProfilesHeader) {
        projProfilesHeader.addEventListener('click', () => {
            const content = projProfilesContent;
            const icon = projProfilesToggleIcon;
            if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.style.transform = 'rotate(0deg)';
            } else {
                content.style.display = 'none';
                icon.style.transform = 'rotate(-90deg)';
            }
        });
    }

    // ======================== Competitive Analysis - Project Selector Events ========================

    // Sync comp-proj-select with projSelect on change
    if (compProjSelect) {
        compProjSelect.addEventListener('change', () => {
            const id = compProjSelect.value;
            if (id) {
                // Save active project
                chrome.storage.local.get(['extension_settings'], (result) => {
                    const settings = result.extension_settings || {};
                    settings.activeProjectId = String(id);
                    chrome.storage.local.set({ extension_settings: settings });
                });
                // Keep the Projects tab selector in sync
                if (projSelect) projSelect.value = id;
                projLoadProjectData(id);
            }
        });
    }

    if (compProjBtnNew) {
        compProjBtnNew.addEventListener('click', () => {
            projCreateModal.style.display = 'block';
            projNewName.value = '';
            projNewDesc.value = '';
            projCreateError.style.display = 'none';
            projNewName.focus();
        });
    }

    if (compProjBtnRefresh) {
        compProjBtnRefresh.addEventListener('click', async () => {
            compProjBtnRefresh.disabled = true;
            compProjBtnRefresh.textContent = '⏳ Loading...';
            await projLoadProjects();
            compProjBtnRefresh.disabled = false;
            compProjBtnRefresh.textContent = '⟳ Refresh';
        });
    }

    if (compProjBtnImportToLocal) {
        compProjBtnImportToLocal.addEventListener('click', projImportToLocal);
    }

    if (compProjBtnDelete) {
        compProjBtnDelete.addEventListener('click', projDeleteProject);
    }


    // Reset filter logic
    if (projBtnResetFilter) {
        projBtnResetFilter.addEventListener('click', () => {
            projActiveProfileFilter = null;
            projBtnResetFilter.style.display = 'none';
            projCurrentPage = 1;
            projRenderProfiles(projProfilesData);
            projRenderPosts();
        });
    }

    // Close modal on click outside
    window.addEventListener('click', (e) => {
        if (e.target === projCreateModal) projCreateModal.style.display = 'none';
    });

    // Auto-load projects when Projects tab is clicked
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            if (tabName === 'tab-projects' || tabName === 'tab-project2') {
                projLoadProjects();
            }
            // Auto-init local selectors for Competitive Analysis when no project is loaded
            if (tabName === 'tab-project2' && !projCurrentProjectId) {
                comp_initSelectorsFromLocal();
            }
        });
    });
    // --- Manual Update Check ---
    if (btnCheckUpdates) {
        btnCheckUpdates.addEventListener('click', () => {
            btnCheckUpdates.disabled = true;
            btnCheckUpdates.textContent = 'Checking...';
            if (updateCheckStatus) updateCheckStatus.textContent = '';

            chrome.runtime.sendMessage({ type: "MANUAL_UPDATE_CHECK" }, (response) => {
                btnCheckUpdates.disabled = false;
                btnCheckUpdates.textContent = 'Check for Updates';

                if (chrome.runtime.lastError) {
                    if (updateCheckStatus) updateCheckStatus.textContent = 'Error: ' + chrome.runtime.lastError.message;
                    return;
                }

                if (response && response.success) {
                    if (response.updateFound) {
                        if (updateCheckStatus) {
                            updateCheckStatus.style.color = '#10b981'; // success green
                            updateCheckStatus.textContent = 'Update found! (v' + response.version + ')';
                        }
                    } else {
                        if (updateCheckStatus) {
                            updateCheckStatus.style.color = 'var(--text-main)';
                            updateCheckStatus.textContent = 'Extension is up to date (v' + response.version + ').';
                        }
                    }
                } else {
                    if (updateCheckStatus) updateCheckStatus.textContent = 'Check failed. Check console.';
                }
            });
        });
    }

    // --- Refetch Config ---
    if (btnRefetchConfig) {
        btnRefetchConfig.addEventListener('click', () => {
            btnRefetchConfig.disabled = true;
            btnRefetchConfig.textContent = 'Refetching...';
            if (refetchConfigStatus) {
                refetchConfigStatus.textContent = '';
                refetchConfigStatus.style.color = 'var(--text-secondary)';
            }

            chrome.runtime.sendMessage({ type: "REFETCH_CONFIG" }, (response) => {
                btnRefetchConfig.disabled = false;
                btnRefetchConfig.textContent = 'Refetch Config';

                if (chrome.runtime.lastError) {
                    if (refetchConfigStatus) {
                        refetchConfigStatus.style.color = '#ef4444'; // error red
                        refetchConfigStatus.textContent = 'Error: ' + chrome.runtime.lastError.message;
                    }
                    return;
                }

                if (response && response.success) {
                    applyRemoteConfig(response.config);
                    if (refetchConfigStatus) {
                        refetchConfigStatus.style.color = '#10b981'; // success green
                        refetchConfigStatus.textContent = 'Config updated successfully!';
                        setTimeout(() => {
                           if (refetchConfigStatus.textContent === 'Config updated successfully!') {
                               refetchConfigStatus.textContent = '';
                           }
                        }, 5000);
                    }
                } else {
                    if (refetchConfigStatus) {
                        refetchConfigStatus.style.color = '#ef4444'; // error red
                        refetchConfigStatus.textContent = 'Failed: ' + (response?.error || 'unknown');
                    }
                }
            });
        });
    }

});
