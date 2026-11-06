document.addEventListener('DOMContentLoaded', () => {
    const usersTbody = document.getElementById('users-tbody');
    const loadingSpinner = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const searchInput = document.getElementById('search-users');

    // Modals
    const addUserBtn = document.getElementById('add-user-btn');
    const addUserModal = document.getElementById('add-user-modal');
    const addUserForm = document.getElementById('add-user-form');
    const closeBtns = document.querySelectorAll('.close-modal-btn');
    const formError = document.getElementById('form-error');

    const deleteModal = document.getElementById('delete-modal');
    const deleteUserEmail = document.getElementById('delete-user-email');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

    const logoutModal = document.getElementById('logout-modal');
    const logoutUserEmail = document.getElementById('logout-user-email');
    const confirmLogoutBtn = document.getElementById('confirm-logout-btn');

    const historyModal = document.getElementById('history-modal');
    const historyModalTitle = document.getElementById('history-modal-title');
    const historyLoading = document.getElementById('history-loading');
    const historyError = document.getElementById('history-error');

    const activityFeedEl = document.getElementById('activity-feed');
    const activityLoading = document.getElementById('activity-loading');
    const activityError = document.getElementById('activity-error');

    const statAllTimeEl = document.getElementById('stat-all-time');
    const statTodayEl = document.getElementById('stat-today');
    const statFailedEl = document.getElementById('stat-failed');
    const statDistinctEl = document.getElementById('stat-distinct');
    const statCardAll = document.getElementById('stat-card-all');
    const statCardToday = document.getElementById('stat-card-today');
    const statCardFailed = document.getElementById('stat-card-failed');

    const activitySearchInput = document.getElementById('activity-search');
    const activityUserFilter = document.getElementById('activity-user-filter');
    const activityActionFilter = document.getElementById('activity-action-filter');
    const activityResultFilter = document.getElementById('activity-result-filter');
    const activityWhenFilter = document.getElementById('activity-when-filter');
    const activityApplyBtn = document.getElementById('activity-apply-btn');
    const activityExportBtn = document.getElementById('activity-export-btn');
    const activityAutoRefreshToggle = document.getElementById('activity-autorefresh-toggle');

    const historyFeedEl = document.getElementById('history-feed');

    const toast = document.getElementById('toast');

    let allUsers = [];
    let usersLoaded = false;
    let userToDelete = null;
    let userToEdit = null;
    let userToLogout = null;

    // Activity feed state
    let activityEvents = [];
    let activityStats = { all_time: 0, today: 0, matching: 0, failed: 0, distinct_users: 0 };
    let activitySlowMs = 2000; // overwritten by the server's SLOW_REQUEST_MS on each fetch
    const appliedFilters = { q: '', user: '', action: 'all', result: 'any', when: 'any' };
    const expandedEventIds = new Set();
    let autoRefreshTimer = null;
    let insightsTimer = null; // declared here: checkAuth() runs once before the insights block below is evaluated
    let fetchSeq = 0;

    // Authentication Elements
    const loginOverlay = document.getElementById('login-overlay');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const adminContainer = document.querySelector('.admin-container');

    // Initial Auth Check
    checkAuth();

    async function checkAuth() {
        if (hasAdminSession()) {
            loginOverlay.classList.add('hidden');
            adminContainer.classList.remove('blurred');
            // Activity rows need allUsers loaded first (plan / "no account" sub-line).
            await fetchUsers();
            if (!hasAdminSession()) return; // fetchUsers hit a 401 and logged us out
            fetchActivity();
            startInsightsRefresh();
            activityAutoRefreshToggle.checked = getAutoRefreshPref();
            if (activityAutoRefreshToggle.checked) startAutoRefresh(); else stopAutoRefresh();
        } else {
            loginOverlay.classList.remove('hidden');
            adminContainer.classList.add('blurred');
            stopAutoRefresh();
            if (insightsTimer) { clearInterval(insightsTimer); insightsTimer = null; }
        }
    }

    function getHeaders() {
        const token = sessionStorage.getItem('adminToken');
        return token
            ? { 'Content-Type': 'application/json', 'x-admin-token': token }
            : { 'Content-Type': 'application/json', 'x-admin-password': sessionStorage.getItem('adminPassword') };
    }

    // Signed in with either the shared password or an account's token.
    function hasAdminSession() {
        return !!(sessionStorage.getItem('adminPassword') || sessionStorage.getItem('adminToken'));
    }

    function clearAdminSession() {
        sessionStorage.removeItem('adminPassword');
        sessionStorage.removeItem('adminToken');
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('admin-password').value;
        const email = document.getElementById('admin-email').value.trim();
        const submitBtn = loginForm.querySelector('.submit-btn');

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Verifying...';
            loginError.classList.add('hidden');

            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(email ? { email, password: pwd } : { password: pwd })
            });

            if (!res.ok) {
                const failure = await res.json().catch(() => ({}));
                throw new Error(failure.error || 'Incorrect password');
            }

            clearAdminSession();
            if (email) {
                const data = await res.json();
                sessionStorage.setItem('adminToken', data.token);
            } else {
                sessionStorage.setItem('adminPassword', pwd);
            }
            checkAuth();
        } catch (err) {
            loginError.textContent = err.message;
            loginError.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
        }
    });

    // Event Listeners
    addUserBtn.addEventListener('click', () => {
        userToEdit = null;
        addUserModal.querySelector('h3').textContent = 'Add New User';
        addUserForm.querySelector('.submit-btn').textContent = 'Create User';
        document.getElementById('password').required = true;
        addUserForm.reset();
        openModal(addUserModal);
    });
    closeBtns.forEach(btn => btn.addEventListener('click', closeAllModals));
    
    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeAllModals();
        }
    });

    const filterStatus = document.getElementById('filter-user-status');
    const filterPlan = document.getElementById('filter-user-plan');
    const sortUsers = document.getElementById('sort-users');

    // Search + status/plan filters + sort, applied together to the cached user list.
    function applyUserFilters() {
        const term = searchInput.value.trim().toLowerCase();
        const time = (v) => (v ? new Date(v).getTime() : 0);
        const sorters = {
            created_desc: (a, b) => time(b.created_at) - time(a.created_at),
            created_asc: (a, b) => time(a.created_at) - time(b.created_at),
            email_asc: (a, b) => (a.email || '').localeCompare(b.email || ''),
            login_desc: (a, b) => time(b.last_login) - time(a.last_login),
            login_asc: (a, b) => time(a.last_login) - time(b.last_login),
        };
        const rows = allUsers
            .filter(u => (u.email || '').toLowerCase().includes(term))
            .filter(u => !filterStatus.value || u.status === filterStatus.value)
            .filter(u => !filterPlan.value || u.plan === filterPlan.value)
            .sort(sorters[sortUsers.value] || sorters.created_desc);
        renderUsers(rows);
    }

    // Fill a filter dropdown with the distinct values present in the data, keeping the current choice.
    function fillFilterOptions(select, values, allLabel) {
        const current = select.value;
        select.innerHTML = '';
        select.add(new Option(allLabel, ''));
        [...new Set(values.filter(Boolean))].sort().forEach(v => select.add(new Option(v, v)));
        select.value = [...select.options].some(o => o.value === current) ? current : '';
    }

    searchInput.addEventListener('input', applyUserFilters);
    [filterStatus, filterPlan, sortUsers].forEach(el => el.addEventListener('change', applyUserFilters));

    addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const plan = document.getElementById('plan').value;
        const status = document.getElementById('status').value;
        const maxDevices = parseInt(document.getElementById('max-devices').value, 10);

        try {
            const submitBtn = addUserForm.querySelector('.submit-btn');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
            formError.classList.add('hidden');

            const isEdit = !!userToEdit;
            const url = isEdit ? `/api/admin/users/${userToEdit.id}` : '/api/admin/users';
            const method = isEdit ? 'PUT' : 'POST';

            const payload = { email, plan, status, max_devices: maxDevices };
            if (password) payload.password = password;
            // Dates are only sent when set, or when clearing one that was set, so nothing changes before migration v8.
            [['plan-expires', 'plan_expires_at'], ['trial-ends', 'trial_ends_at']].forEach(([id, key]) => {
                const v = document.getElementById(id).value;
                if (v) payload[key] = v;
                else if (isEdit && userToEdit[key]) payload[key] = null;
            });

            const res = await fetch(url, {
                method,
                headers: getHeaders(),
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.status === 401) {
                clearAdminSession();
                checkAuth();
                throw new Error('Session expired. Please login again.');
            }
            if (!res.ok) throw new Error(data.error || `Could not save the user (HTTP ${res.status})`);

            // Success
            showToast(`User ${email} ${isEdit ? 'saved' : 'created'} successfully`, 'success');
            closeAllModals();
            addUserForm.reset();
            fetchUsers(); // Refresh list

        } catch (err) {
            formError.textContent = err.message;
            formError.classList.remove('hidden');
        } finally {
            const submitBtn = addUserForm.querySelector('.submit-btn');
            submitBtn.disabled = false;
            submitBtn.textContent = userToEdit ? 'Save Changes' : 'Create User';
        }
    });

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!userToDelete) return;

        try {
            confirmDeleteBtn.disabled = true;
            confirmDeleteBtn.textContent = 'Deleting...';

            const res = await fetch(`/api/admin/users/${userToDelete.id}`, {
                method: 'DELETE',
                headers: getHeaders()
            });

            const data = await res.json();

            if (res.status === 401) {
                clearAdminSession();
                checkAuth();
                throw new Error('Session expired');
            }

            if (!res.ok) {
                throw new Error(data.error || 'Failed to delete user');
            }

            showToast('User deleted successfully', 'success');
            closeAllModals();
            fetchUsers();

        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            confirmDeleteBtn.disabled = false;
            confirmDeleteBtn.textContent = 'Delete User';
        }
    });

    confirmLogoutBtn.addEventListener('click', async () => {
        if (!userToLogout) return;

        try {
            confirmLogoutBtn.disabled = true;
            confirmLogoutBtn.textContent = 'Logging out...';

            const res = await fetch(`/api/admin/users/${userToLogout.id}/logout`, {
                method: 'POST',
                headers: getHeaders()
            });

            const data = await res.json();

            if (res.status === 401) {
                clearAdminSession();
                checkAuth();
                throw new Error('Session expired');
            }

            if (!res.ok) {
                throw new Error(data.error || 'Failed to logout user');
            }

            showToast('User logged out from all devices', 'success');
            closeAllModals();
            fetchUsers();

        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            confirmLogoutBtn.disabled = false;
            confirmLogoutBtn.textContent = 'Force Logout';
        }
    });

    // --- Activity feed ---

    function esc(v) {
        return escapeHTML(v === null || v === undefined ? '' : String(v));
    }

    function getAutoRefreshPref() {
        try { return localStorage.getItem('activityAutoRefresh') === '1'; } catch (e) { return false; }
    }
    function setAutoRefreshPref(v) {
        try { localStorage.setItem('activityAutoRefresh', v ? '1' : '0'); } catch (e) { /* ignore */ }
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        autoRefreshTimer = setInterval(() => {
            if (!hasAdminSession()) return;
            fetchActivity(true);
        }, 30000);
    }
    function stopAutoRefresh() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }

    activityAutoRefreshToggle.addEventListener('change', () => {
        setAutoRefreshPref(activityAutoRefreshToggle.checked);
        if (activityAutoRefreshToggle.checked) startAutoRefresh(); else stopAutoRefresh();
    });

    function localMidnightISO() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
    }

    function computeSince(when) {
        const now = Date.now();
        switch (when) {
            case 'today': return localMidnightISO();
            case '24h': return new Date(now - 24 * 60 * 60 * 1000).toISOString();
            case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
            case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
            default: return null;
        }
    }

    function buildActivityParams(limit) {
        const params = new URLSearchParams();
        if (appliedFilters.q) params.set('q', appliedFilters.q);
        if (appliedFilters.user) params.set('user', appliedFilters.user);
        if (appliedFilters.action !== 'all') params.set('action', appliedFilters.action);
        if (appliedFilters.result !== 'any') params.set('result', appliedFilters.result);
        const since = computeSince(appliedFilters.when);
        if (since) params.set('since', since);
        params.set('today_start', localMidnightISO());
        params.set('limit', String(limit || 200));
        return params;
    }

    function readFiltersFromUI() {
        appliedFilters.q = activitySearchInput.value.trim();
        appliedFilters.user = activityUserFilter.value;
        appliedFilters.action = activityActionFilter.value;
        appliedFilters.result = activityResultFilter.value;
        appliedFilters.when = activityWhenFilter.value;
    }

    function applyActivityFilters() {
        readFiltersFromUI();
        fetchActivity();
    }

    activityApplyBtn.addEventListener('click', applyActivityFilters);
    activitySearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyActivityFilters();
    });

    statCardAll.addEventListener('click', () => {
        activityWhenFilter.value = 'any';
        applyActivityFilters();
    });
    statCardToday.addEventListener('click', () => {
        activityWhenFilter.value = 'today';
        applyActivityFilters();
    });
    statCardFailed.addEventListener('click', () => {
        activityResultFilter.value = 'failed';
        applyActivityFilters();
    });

    function populateUserFilterOptions() {
        const current = activityUserFilter.value;
        activityUserFilter.innerHTML = '';
        const optAll = document.createElement('option');
        optAll.value = '';
        optAll.textContent = 'All users';
        activityUserFilter.appendChild(optAll);

        const emails = allUsers.map(u => u.email).filter(Boolean).sort((a, b) => a.localeCompare(b));
        emails.forEach(email => {
            const opt = document.createElement('option');
            opt.value = email;
            opt.textContent = email;
            activityUserFilter.appendChild(opt);
        });

        if (emails.includes(current) || current === '') activityUserFilter.value = current;
    }

    function renderActivityStats() {
        statAllTimeEl.textContent = (Number(activityStats.all_time) || 0).toLocaleString();
        statTodayEl.textContent = (Number(activityStats.today) || 0).toLocaleString();
        statFailedEl.textContent = (Number(activityStats.failed) || 0).toLocaleString();
        statDistinctEl.textContent = (Number(activityStats.distinct_users) || 0).toLocaleString();

        statCardAll.classList.toggle('active', appliedFilters.when === 'any' && appliedFilters.result === 'any');
        statCardToday.classList.toggle('active', appliedFilters.when === 'today');
        statCardFailed.classList.toggle('active', appliedFilters.result === 'failed');
    }

    async function fetchActivity(background) {
        const seq = ++fetchSeq;
        try {
            if (!background) {
                activityLoading.classList.remove('hidden');
                activityError.classList.add('hidden');
            }

            const params = buildActivityParams(200);
            const res = await fetch(`/api/admin/events?${params.toString()}`, {
                headers: getHeaders()
            });
            const data = await res.json();

            if (res.status === 401) {
                clearAdminSession();
                checkAuth();
                return;
            }

            if (!res.ok) throw new Error(data.error || 'Failed to fetch activity');
            if (seq !== fetchSeq) return; // a newer request already landed

            activityEvents = data.events || [];
            activityStats = data.stats || activityStats;
            activitySlowMs = data.slow_ms || activitySlowMs;
            activityError.classList.add('hidden'); // clear a stale error left by an earlier failed tick
            renderActivityStats();
            renderFeed(activityFeedEl, activityEvents, activityStats.matching);
        } catch (err) {
            if (seq !== fetchSeq) return;
            activityError.textContent = err.message;
            activityError.classList.remove('hidden');
        } finally {
            if (!background) activityLoading.classList.add('hidden');
        }
    }

    async function openHistoryModal(email) {
        historyModalTitle.textContent = `History — ${email}`;
        historyFeedEl.innerHTML = '';
        historyError.classList.add('hidden');
        openModal(historyModal);

        try {
            historyLoading.classList.remove('hidden');

            // Legacy `email` param — still supported by the events endpoint.
            const res = await fetch(`/api/admin/events?user=${encodeURIComponent(email)}&limit=100`, {
                headers: getHeaders()
            });
            const data = await res.json();

            if (res.status === 401) {
                clearAdminSession();
                checkAuth();
                return;
            }

            if (!res.ok) throw new Error(data.error || 'Failed to fetch history');

            renderFeed(historyFeedEl, data.events || [], data.stats && data.stats.matching);
        } catch (err) {
            historyError.textContent = err.message;
            historyError.classList.remove('hidden');
        } finally {
            historyLoading.classList.add('hidden');
        }
    }

    // --- Event feed rendering (shared by the Activity panel and History modal) ---

    const AVATAR_PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];

    function avatarColorFor(email) {
        if (!email) return 'var(--glass-border)';
        let hash = 0;
        for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0;
        return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
    }

    function initialsFor(email) {
        if (!email) return '?';
        const local = email.split('@')[0] || email;
        return local.slice(0, 2).toUpperCase();
    }

    function findUserByEmail(email) {
        if (!email) return null;
        const lower = email.toLowerCase();
        return allUsers.find(u => u.email && u.email.toLowerCase() === lower) || null;
    }

    function subLineFor(ev, user) {
        if (!ev.email) return 'anonymous';
        if (!usersLoaded) return '';
        return user ? `<span class="activity-plan">${esc(user.plan)}</span>` : 'no account';
    }

    // reason -> badge/sentence for login rows (path === /api/auth/login)
    function loginBadge(reason, error) {
        const blocked = error ? `Login blocked — ${error}` : 'Login blocked';
        switch (reason) {
            case 'success': return { label: 'Signed in', cls: 'badge-success', sentence: 'Signed in' };
            case 'wrong_password': return { label: 'Wrong password', cls: 'badge-danger', sentence: 'Login failed — wrong password' };
            case 'no_such_user': return { label: 'Unknown email', cls: 'badge-danger', sentence: 'Login failed — no account for this email' };
            case 'disabled': return { label: 'Disabled', cls: 'badge-danger', sentence: blocked };
            case 'device_limit': return { label: 'Device limit', cls: 'badge-warning', sentence: blocked };
            case 'missing_fields': return { label: 'Bad request', cls: 'badge-warning', sentence: 'Login failed — email or password missing' };
            case 'server_error': return { label: 'Server error', cls: 'badge-danger', sentence: 'Login crashed on the server' };
            default: return null; // unknown/null reason — fall through to the status-based mapping
        }
    }

    // status -> badge label/class for everything else (and for a reason-less 400 login row)
    function statusBadge(status, error) {
        const errLower = (error || '').toLowerCase();
        if (status === 401) return { label: 'No token', cls: 'badge-warning' };
        if (status === 403) return errLower.includes('expired')
            ? { label: 'Token expired', cls: 'badge-warning' }
            : { label: 'Denied', cls: 'badge-danger' };
        if (status === 404) return { label: 'Not found', cls: 'badge-grey' };
        if (status === 413) return { label: 'Too large', cls: 'badge-warning' };
        if (status === 400 || status === 422) return { label: 'Bad request', cls: 'badge-warning' };
        if (status >= 500) return { label: 'Server error', cls: 'badge-danger' };
        if (status < 400) return { label: 'OK', cls: 'badge-success' };
        return { label: `HTTP ${status}`, cls: 'badge-danger' }; // other 4xx (405/409/429/…)
    }

    // reasons set outside the login route (admin auth failures, password reset)
    const OTHER_REASONS = {
        bad_admin_password: { label: 'Bad admin password', cls: 'badge-danger', sentence: 'Admin API call rejected — wrong admin password' },
        missing_admin_password: { label: 'No admin password', cls: 'badge-warning', sentence: 'Admin API call rejected — no admin password sent' },
        reset_success: { label: 'Password reset', cls: 'badge-success', sentence: 'Password reset via link' },
        reset_invalid_token: { label: 'Bad reset link', cls: 'badge-warning', sentence: 'Password reset failed — link invalid, used or expired' },
        reset_invalid_input: { label: 'Bad request', cls: 'badge-warning', sentence: 'Password reset failed — token or password missing/too short' },
    };

    function badgeFor(ev) {
        if (OTHER_REASONS[ev.reason]) return OTHER_REASONS[ev.reason];
        if (ev.status < 400 && ev.duration_ms >= activitySlowMs && ev.path !== '/api/auth/login') {
            return { label: 'Slow', cls: 'badge-warning', sentence: `${ev.method || ''} ${ev.path || ''} took ${ev.duration_ms} ms` };
        }
        if (ev.path === '/api/auth/login') {
            const b = loginBadge(ev.reason, ev.error);
            if (b) return b;
        }
        const s = statusBadge(ev.status, ev.error);
        const sentence = ev.status >= 400
            ? `${ev.method || ''} ${ev.path || ''} failed — ${ev.error || ('HTTP ' + ev.status)}`
            : `${ev.method || ''} ${ev.path || ''}`;
        return { label: s.label, cls: s.cls, sentence };
    }

    function actionLinksFor(ev, user) {
        const links = [];
        if (ev.email) {
            links.push(`<button type="button" class="activity-link" data-action="history" data-email="${esc(ev.email)}">View history →</button>`);
        }
        if (ev.reason === 'device_limit' && user) {
            links.push(`<button type="button" class="activity-link" data-action="logout" data-user-id="${esc(user.id)}">Force logout →</button>`);
        }
        if ((ev.reason === 'disabled' || ev.reason === 'wrong_password') && user) {
            links.push(`<button type="button" class="activity-link" data-action="edit" data-user-id="${esc(user.id)}">Edit user →</button>`);
        }
        return links.join('');
    }

    function dayLabel(date) {
        const now = new Date();
        const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diffDays = Math.round((today0 - d0) / 86400000);
        if (diffDays === 0) return 'TODAY';
        if (diffDays === 1) return 'YESTERDAY';
        return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
    }

    function renderEventRow(ev) {
        const id = String(ev.id);
        const expanded = expandedEventIds.has(id);
        const user = findUserByEmail(ev.email);
        const created = ev.created_at ? new Date(ev.created_at) : null;
        const time = created ? created.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
        const rel = ev.created_at ? relativeTime(ev.created_at, true) : '';
        const badge = badgeFor(ev);
        const emailLine = ev.email ? `<strong>${esc(ev.email)}</strong>` : '<span class="activity-unknown">Unknown</span>';
        const links = actionLinksFor(ev, user);

        return `
            <div class="activity-row" data-id="${esc(id)}">
                <div class="activity-row-header" data-action="toggle">
                    <div class="activity-time-col">
                        <div class="activity-time">${esc(time)}</div>
                        <div class="activity-rel">${esc(rel)}</div>
                    </div>
                    <div class="activity-avatar" style="background:${avatarColorFor(ev.email)}">${esc(initialsFor(ev.email))}</div>
                    <div class="activity-name-col">
                        <div class="activity-email">${emailLine}</div>
                        <div class="activity-subline">${subLineFor(ev, user)}</div>
                    </div>
                    <div class="activity-main-col">
                        <div class="activity-badge-row">
                            <span class="badge ${badge.cls}">${esc(badge.label)}</span>
                            <span class="activity-sentence">${esc(badge.sentence)}</span>
                        </div>
                        ${links ? `<div class="activity-links">${links}</div>` : ''}
                    </div>
                    <button type="button" class="activity-caret" aria-expanded="${expanded}" aria-label="Toggle details">▾</button>
                </div>
                <div class="activity-details${expanded ? '' : ' hidden'}">
                    <div class="activity-detail-grid">
                        <div class="activity-detail"><span class="detail-label">Time</span><span class="detail-value">${esc(created ? created.toLocaleString() : '—')}</span></div>
                        <div class="activity-detail"><span class="detail-label">Method + Path</span><span class="detail-value">${esc(ev.method || '')} ${esc(ev.path || '')}</span></div>
                        <div class="activity-detail"><span class="detail-label">Status</span><span class="detail-value">${esc(ev.status)}</span></div>
                        <div class="activity-detail"><span class="detail-label">Reason</span><span class="detail-value">${esc(ev.reason || '—')}</span></div>
                        <div class="activity-detail"><span class="detail-label">Duration</span><span class="detail-value">${esc(ev.duration_ms !== null && ev.duration_ms !== undefined ? ev.duration_ms + ' ms' : '—')}</span></div>
                        <div class="activity-detail activity-detail-full"><span class="detail-label">Server error</span><span class="detail-value">${esc(ev.server_error || '—')}</span></div>
                        <div class="activity-detail activity-detail-full"><span class="detail-label">Error</span><span class="detail-value">${esc(ev.error || '—')}</span></div>
                        <div class="activity-detail"><span class="detail-label">IP</span><span class="detail-value">${esc(ev.ip || '—')}</span></div>
                        <div class="activity-detail activity-detail-full"><span class="detail-label">Browser</span><span class="detail-value">${esc(ev.user_agent || '—')}</span></div>
                        <div class="activity-detail"><span class="detail-label">Extension</span><span class="detail-value">${esc(ev.ext_version || '—')}</span></div>
                        <div class="activity-detail"><span class="detail-label">User ID</span><span class="detail-value">${esc(ev.user_id !== null && ev.user_id !== undefined ? ev.user_id : '—')}</span></div>
                        <div class="activity-detail"><span class="detail-label">Event ID</span><span class="detail-value">${esc(ev.id)}</span></div>
                    </div>
                </div>
            </div>`;
    }

    function groupEventsByDay(events) {
        const groups = [];
        let currentKey = null;
        let currentGroup = null;
        events.forEach(ev => {
            const d = ev.created_at ? new Date(ev.created_at) : new Date(0);
            const key = d.toDateString();
            if (key !== currentKey) {
                currentGroup = { label: dayLabel(d), events: [] };
                groups.push(currentGroup);
                currentKey = key;
            }
            currentGroup.events.push(ev);
        });
        return groups;
    }

    function renderFeed(container, events, matchingCount) {
        if (!events || events.length === 0) {
            container.innerHTML = '<div class="activity-empty">No activity matches these filters.</div>';
            return;
        }

        const groups = groupEventsByDay(events);
        let html = '';
        groups.forEach(g => {
            html += `<div class="activity-day-header">${esc(g.label)}</div>`;
            g.events.forEach(ev => { html += renderEventRow(ev); });
        });

        const matchingNum = Number(matchingCount);
        if (!isNaN(matchingNum) && matchingNum > events.length) {
            html += `<div class="activity-more">Showing ${events.length.toLocaleString()} of ${matchingNum.toLocaleString()} — narrow the filters or export CSV.</div>`;
        }

        container.innerHTML = html;
    }

    // Single delegated handler, attached once, reused by both the Activity feed and History modal.
    function handleFeedClick(e) {
        const actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.getAttribute('data-action');

        if (action === 'toggle') {
            const row = actionEl.closest('.activity-row');
            if (!row) return;
            const id = row.getAttribute('data-id'); // string, matches renderEventRow's String(ev.id)
            const details = row.querySelector('.activity-details');
            const caret = row.querySelector('.activity-caret');
            details.classList.toggle('hidden');
            const nowExpanded = !details.classList.contains('hidden');
            if (nowExpanded) expandedEventIds.add(id); else expandedEventIds.delete(id);
            if (caret) caret.setAttribute('aria-expanded', String(nowExpanded));
            return;
        }

        if (action === 'history') {
            const email = actionEl.getAttribute('data-email');
            if (email) openHistoryModal(email);
            return;
        }

        if (action === 'logout' || action === 'edit') {
            const userId = actionEl.getAttribute('data-user-id');
            const user = allUsers.find(u => String(u.id) === String(userId));
            if (!user) return;
            closeAllModals(); // so the edit/logout modal isn't stacked behind the History modal
            if (action === 'logout') promptLogoutUser(user.id, user.email);
            else promptEditUser(user);
        }
    }

    activityFeedEl.addEventListener('click', handleFeedClick);
    historyFeedEl.addEventListener('click', handleFeedClick);

    // --- Export CSV ---

    function csvCell(value) {
        let s = value === null || value === undefined ? '' : String(value);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // formula-injection guard
        s = s.replace(/"/g, '""');
        return `"${s}"`;
    }

    function downloadCSV(events) {
        const header = ['created_at', 'email', 'method', 'path', 'status', 'reason', 'error', 'ip', 'user_agent', 'ext_version', 'duration_ms', 'server_error', 'user_id', 'id'];
        const rows = [header.join(',')];
        events.forEach(ev => rows.push(header.map(k => csvCell(ev[k])).join(',')));
        const csv = rows.join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const pad = n => String(n).padStart(2, '0');
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

        const a = document.createElement('a');
        a.href = url;
        a.download = `activity-${dateStr}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    activityExportBtn.addEventListener('click', async () => {
        try {
            // ponytail: server caps limit at 1000 rows; a larger export would need since/before cursor paging.
            const params = buildActivityParams(1000);
            const res = await fetch(`/api/admin/events?${params.toString()}`, { headers: getHeaders() });
            const data = await res.json();

            if (res.status === 401) {
                clearAdminSession();
                checkAuth();
                return;
            }
            if (!res.ok) throw new Error(data.error || 'Failed to export activity');

            downloadCSV(data.events || []);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    // ---- Insights, health, alerts ----
    const insightsDays = document.getElementById('insights-days');
    const alertsBanner = document.getElementById('alerts-banner');

    const miniTable = (head, rows) => rows.length
        ? `<table class="mini-table"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : '<div class="last-good">Nothing in this window.</div>';

    function renderHealth(h) {
        const dbOk = h.db && h.db.ok;
        const mig = h.migrations || {};
        const missing = Object.keys(mig).filter(k => !mig[k]);
        const r = h.retention || {};
        const up = h.uptime_s >= 86400 ? `${Math.floor(h.uptime_s / 86400)}d ${Math.floor(h.uptime_s % 86400 / 3600)}h` : `${Math.floor(h.uptime_s / 3600)}h ${Math.floor(h.uptime_s % 3600 / 60)}m`;
        const cell = (label, value, cls) => `<div class="health-cell"><div class="last-good">${label}</div><div class="${cls || ''}">${value}</div></div>`;
        document.getElementById('health-card').innerHTML = [
            cell('Database', dbOk ? `OK · ${h.db.latency_ms} ms` : `DOWN — ${escapeHTML((h.db && h.db.error) || '')}`, dbOk ? 'health-ok' : 'health-bad'),
            cell('Backend', `v${escapeHTML(h.version)} · node ${escapeHTML(h.node)} · up ${up}`),
            cell('Migrations', missing.length ? `missing: ${escapeHTML(missing.join(', '))}` : 'all applied', missing.length ? 'health-bad' : 'health-ok'),
            cell('Activity log', h.events ? `${h.events.total} rows · oldest ${h.events.oldest ? escapeHTML(new Date(h.events.oldest).toLocaleDateString()) : '—'}` : '—'),
            cell('Retention', r.lastError ? `failed: ${escapeHTML(r.lastError)}` : r.lastRunAt ? `ran ${escapeHTML(relativeTime(r.lastRunAt))}, removed ${r.lastDeleted}` : 'not run yet since boot', r.lastError ? 'health-bad' : ''),
        ].join('');
    }

    function renderInsights(d) {
        document.getElementById('versions-table').innerHTML = miniTable(
            ['Version', 'Users', 'Errors', 'Who'],
            d.versions.map(v => [
                `${escapeHTML(v.ext_version)}${v.outdated ? ' <span class="badge badge-warning">outdated</span>' : ' <span class="badge badge-success">latest</span>'}`,
                v.users, v.errors,
                `<span class="last-good" title="${escapeHTML((v.emails || []).join(', '))}">${escapeHTML((v.emails || []).slice(0, 2).join(', '))}${(v.emails || []).length > 2 ? '…' : ''}</span>`,
            ]));
        document.getElementById('failing-table').innerHTML = miniTable(
            ['Endpoint', 'Failures', '5xx', 'Last'],
            d.top_failing.map(f => [`${escapeHTML(f.method)} ${escapeHTML(f.path)}`, f.failures, f.server_errors, escapeHTML(relativeTime(f.last_seen))]));
        document.getElementById('slow-table').innerHTML = miniTable(
            [`Endpoint (≥ ${d.slow_ms} ms)`, 'Slow hits', 'Avg ms', 'Max ms'],
            d.slow.map(s => [`${escapeHTML(s.method)} ${escapeHTML(s.path)}`, s.slow, s.avg_ms, s.max_ms]));
        const peak = Math.max(1, ...d.trend.map(t => t.errors + t.client_errors));
        document.getElementById('trend-bars').innerHTML = d.trend.length
            ? d.trend.map(t => `<div class="trend-row" title="${t.errors} server / ${t.client_errors} client errors">
                    <span class="last-good">${escapeHTML(new Date(t.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>
                    <span class="trend-bar"><i class="trend-5xx" style="width:${t.errors / peak * 100}%"></i><i class="trend-4xx" style="width:${t.client_errors / peak * 100}%"></i></span>
                    <span class="last-good">${t.errors} / ${t.client_errors}</span></div>`).join('')
            : '<div class="last-good">No errors in this window.</div>';
    }

    function renderAlerts(alerts) {
        alertsBanner.classList.toggle('hidden', alerts.length === 0);
        alertsBanner.innerHTML = alerts.map(a => `<div>⚠ ${escapeHTML(a.message)}</div>`).join('');
    }

    async function adminGet(url) {
        const res = await fetch(url, { headers: getHeaders() });
        if (res.status === 401) { clearAdminSession(); checkAuth(); throw new Error('Signed out'); }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    async function fetchAlerts() {
        try { renderAlerts((await adminGet('/api/admin/alerts')).alerts); } catch (e) { /* banner is best-effort */ }
    }

    async function fetchInsights() {
        const err = document.getElementById('insights-error');
        try {
            err.classList.add('hidden');
            const [h, d] = await Promise.all([
                adminGet('/api/admin/health'),
                adminGet(`/api/admin/insights?days=${encodeURIComponent(insightsDays.value)}`),
            ]);
            renderHealth(h);
            renderInsights(d);
        } catch (e) {
            err.textContent = e.message;
            err.classList.remove('hidden');
        }
    }

    // ---- Usage ----
    const usageDays = document.getElementById('usage-days');
    const usageSearch = document.getElementById('usage-search');
    let usageData = null;

    function renderUsage() {
        if (!usageData) return;
        const d = usageData;
        const EXTRA_LABELS = { videos: 'Videos', keywords: 'Keywords', tiktok_comments: 'TikTok comments' };
        const extras = ['videos', 'keywords', 'tiktok_comments'].filter(k => d.users.length && k in d.users[0]);
        document.getElementById('usage-note').textContent =
            `Last ${d.days} days for activity; totals for saved posts and the rows below (storage is counted in rows, not bytes). ` +
            `A job still running after ${d.stuck_after_minutes} min counts as stuck. Score = jobs + API calls.`;
        document.getElementById('usage-top').innerHTML = miniTable(
            ['User', 'Jobs', 'API calls', 'Comments'],
            d.top_users.map(u => [esc(u.email), u.jobs_total, u.api_calls, u.comments_scraped]));
        document.getElementById('usage-failed').innerHTML = miniTable(
            ['User', 'Post', 'Retries', 'Error'],
            d.failed_jobs.map(j => [esc(j.email), esc(j.post_shortcode), `${j.retry_count}/${j.max_retries}`,
                `<span class="last-good" title="${esc(j.error_message)}">${esc((j.error_message || '').slice(0, 60))}</span>`]));
        const term = usageSearch.value.trim().toLowerCase();
        const rows = d.users.filter(u => (u.email || '').toLowerCase().includes(term));
        document.getElementById('usage-users').innerHTML = miniTable(
            ['User', 'Plan', 'Sessions', 'Jobs', 'Failed', 'Stuck', 'API calls', 'Comments', 'Saved posts', 'Projects', ...extras.map(k => EXTRA_LABELS[k])],
            rows.map(u => [esc(u.email), esc(u.plan), u.sessions, u.jobs_total, u.jobs_failed,
                u.jobs_stuck ? `<span class="badge badge-warning">${u.jobs_stuck}</span>` : 0,
                u.api_calls, u.comments_scraped, u.saved_posts, u.projects, ...extras.map(k => u[k])]));
    }

    async function fetchUsage() {
        const err = document.getElementById('usage-error');
        try {
            err.classList.add('hidden');
            usageData = await adminGet(`/api/admin/usage?days=${encodeURIComponent(usageDays.value)}`);
            renderUsage();
        } catch (e) {
            err.textContent = e.message;
            err.classList.remove('hidden');
        }
    }
    usageDays.addEventListener('change', fetchUsage);
    usageSearch.addEventListener('input', renderUsage);

    // ---- Audit log ----
    const auditSearch = document.getElementById('audit-search');
    const auditAction = document.getElementById('audit-action');

    async function fetchAudit() {
        const err = document.getElementById('audit-error');
        try {
            err.classList.add('hidden');
            const params = new URLSearchParams({ limit: '100' });
            if (auditAction.value) params.set('action', auditAction.value);
            if (auditSearch.value.trim()) params.set('q', auditSearch.value.trim());
            const d = await adminGet(`/api/admin/audit?${params}`);
            if (auditAction.options.length === 1) d.actions.forEach(a => auditAction.add(new Option(a, a)));
            if (d.table_missing) {
                document.getElementById('audit-table').innerHTML = '<div class="last-good">Audit log is not set up yet: apply migrations/v7_admin_audit.sql. Actions are not being recorded until then.</div>';
                return;
            }
            document.getElementById('audit-table').innerHTML = miniTable(
                ['When', 'Who', 'Action', 'Target', 'IP', 'Detail'],
                d.rows.map(r => [
                    `<span title="${esc(new Date(r.created_at).toLocaleString())}">${esc(relativeTime(r.created_at))}</span>`,
                    esc(r.actor), esc(r.action), esc(r.target_email), esc(r.ip),
                    `<span class="last-good">${esc(JSON.stringify(r.detail || {}))}</span>`,
                ]));
        } catch (e) {
            err.textContent = e.message;
            err.classList.remove('hidden');
        }
    }
    let auditTimer = null;
    auditAction.addEventListener('change', fetchAudit);
    auditSearch.addEventListener('input', () => { clearTimeout(auditTimer); auditTimer = setTimeout(fetchAudit, 300); });
    document.getElementById('audit-refresh-btn').addEventListener('click', fetchAudit);

    // ---- Elements built with textContent only ----
    function node(tag, text, className) {
        const n = document.createElement(tag);
        if (text !== undefined && text !== null) n.textContent = String(text);
        if (className) n.className = className;
        return n;
    }

    function actionBtn(label, onClick, danger) {
        const b = node('button', label, `btn ${danger ? 'danger-btn' : 'secondary-btn'}`);
        b.type = 'button';
        b.addEventListener('click', onClick);
        return b;
    }

    // Each cell is text or a DOM node.
    function fillTable(container, head, rows, emptyText) {
        container.replaceChildren();
        if (!rows.length) { container.appendChild(node('div', emptyText, 'last-good')); return; }
        const table = node('table', undefined, 'mini-table');
        const headRow = table.createTHead().insertRow();
        head.forEach(h => headRow.appendChild(node('th', h)));
        const body = table.createTBody();
        rows.forEach(cells => {
            const tr = body.insertRow();
            cells.forEach(c => {
                const td = tr.insertCell();
                if (c instanceof Node) td.appendChild(c); else td.textContent = c === null || c === undefined ? '' : String(c);
            });
        });
        container.appendChild(table);
    }

    function when(value) {
        return value ? new Date(value).toLocaleString() : '';
    }

    // Sends a change; returns the parsed body, or null after showing the error.
    async function adminSend(url, method, body) {
        try {
            const res = await fetch(url, { method, headers: getHeaders(), body: body ? JSON.stringify(body) : undefined });
            if (res.status === 401) { clearAdminSession(); checkAuth(); return null; }
            const data = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(data.error || 'Request failed', 'error'); return null; }
            return data;
        } catch (e) {
            showToast('Could not reach the server', 'error');
            return null;
        }
    }

    // ---- Blocked IPs ----
    const blockNote = document.getElementById('blocks-note');

    async function fetchBlocks() {
        const err = document.getElementById('blocks-error');
        try {
            err.classList.add('hidden');
            const d = await adminGet('/api/admin/blocked-ips');
            blockNote.classList.toggle('hidden', !d.table_missing);
            blockNote.textContent = d.table_missing ? 'IP blocking is not set up yet: apply migrations/v10_blocked_ips.sql.' : '';
            fillTable(document.getElementById('blocks-table'), ['IP', 'Reason', 'Blocked by', 'Since', 'Expires', ''],
                d.blocks.map(b => [b.ip, b.reason, b.blocked_by, when(b.created_at), when(b.expires_at),
                    actionBtn('Unblock', async () => {
                        if (await adminSend(`/api/admin/blocked-ips/${encodeURIComponent(b.ip)}`, 'DELETE')) { showToast(`Unblocked ${b.ip}`); fetchBlocks(); fetchAudit(); }
                    })]),
                'No addresses are blocked.');
        } catch (e) {
            err.textContent = e.message;
            err.classList.remove('hidden');
        }
    }

    document.getElementById('block-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ip = document.getElementById('block-ip');
        const reason = document.getElementById('block-reason');
        const hours = Number(document.getElementById('block-hours').value);
        if (await adminSend('/api/admin/blocked-ips', 'POST', { ip: ip.value.trim(), reason: reason.value, hours })) {
            showToast(`Blocked ${ip.value.trim()}`);
            ip.value = '';
            reason.value = '';
            fetchBlocks();
            fetchAudit();
        }
    });

    // ---- Admin accounts ----
    const adminsNote = document.getElementById('admins-note');
    const adminPasswordEditor = document.getElementById('admin-password-editor');
    let adminPasswordTarget = null;

    function closePasswordEditor() {
        adminPasswordTarget = null;
        adminPasswordEditor.classList.add('hidden');
        document.getElementById('admin-new-password').value = '';
    }

    async function fetchAdmins() {
        const err = document.getElementById('admins-error');
        try {
            err.classList.add('hidden');
            const d = await adminGet('/api/admin/accounts');
            adminsNote.classList.toggle('hidden', !d.table_missing);
            adminsNote.textContent = d.table_missing ? 'Admin accounts are not set up yet: apply migrations/v9_admin_accounts.sql. The shared password keeps working.' : '';
            fillTable(document.getElementById('admins-table'), ['Email', 'Name', 'Status', 'Last login', 'Created by', ''],
                d.accounts.map(a => {
                    const isMe = a.id === d.me;
                    const actions = node('div');
                    actions.appendChild(actionBtn('New password', () => {
                        adminPasswordTarget = a;
                        document.getElementById('admin-password-for').textContent = `New password for ${a.email}${isMe ? ' (you will need to sign in again)' : ''}`;
                        adminPasswordEditor.classList.remove('hidden');
                        document.getElementById('admin-new-password').focus();
                    }));
                    if (!isMe) {
                        actions.appendChild(actionBtn(a.disabled_at ? 'Enable' : 'Disable', async () => {
                            if (await adminSend(`/api/admin/accounts/${a.id}`, 'PATCH', { disabled: !a.disabled_at })) { fetchAdmins(); fetchAudit(); }
                        }));
                        actions.appendChild(actionBtn('Delete', async () => {
                            if (!window.confirm(`Delete the admin account ${a.email}?`)) return;
                            if (await adminSend(`/api/admin/accounts/${a.id}`, 'DELETE')) { showToast(`Deleted ${a.email}`); fetchAdmins(); fetchAudit(); }
                        }, true));
                    }
                    return [a.email + (isMe ? ' (you)' : ''), a.name, a.disabled_at ? 'Disabled' : 'Active', when(a.last_login), a.created_by, actions];
                }),
                'No admin accounts yet. Everyone is using the shared password.');
        } catch (e) {
            err.textContent = e.message;
            err.classList.remove('hidden');
        }
    }

    document.getElementById('admin-create-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('admin-new-email');
        const name = document.getElementById('admin-new-name');
        const password = document.getElementById('admin-new-account-password');
        if (await adminSend('/api/admin/accounts', 'POST', { email: email.value, name: name.value, password: password.value })) {
            showToast(`Created ${email.value.trim()}`);
            email.value = '';
            name.value = '';
            password.value = '';
            fetchAdmins();
            fetchAudit();
        }
    });

    document.getElementById('admin-password-cancel').addEventListener('click', closePasswordEditor);
    adminPasswordEditor.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!adminPasswordTarget) return;
        const target = adminPasswordTarget;
        const password = document.getElementById('admin-new-password').value;
        if (await adminSend(`/api/admin/accounts/${target.id}`, 'PATCH', { password })) {
            showToast(`Password changed for ${target.email}`);
            closePasswordEditor();
            fetchAdmins();
            fetchAudit();
        }
    });

    function startInsightsRefresh() {
        if (insightsTimer) clearInterval(insightsTimer);
        fetchInsights();
        fetchAlerts();
        fetchUsage();
        fetchAudit();
        fetchBlocks();
        fetchAdmins();
        insightsTimer = setInterval(() => {
            if (!hasAdminSession()) return;
            fetchAlerts();
            fetchInsights();
            fetchUsage();
            fetchAudit();
            fetchBlocks();
        }, 60000);
    }
    insightsDays.addEventListener('change', fetchInsights);

    function renderLastIssue(issue, lastSeen) {
        const good = lastSeen
            ? `<div class="last-good" title="${escapeHTML(new Date(lastSeen).toLocaleString())}">last good call · ${escapeHTML(relativeTime(lastSeen))}</div>`
            : '<div class="last-good">no good call recorded</div>';
        if (!issue) return `<span style="color:var(--text-secondary)">—</span>${good}`;

        const label = escapeHTML(issue.reason || String(issue.status));
        const rel = relativeTime(issue.created_at);
        const isRecent = issue.created_at && (Date.now() - new Date(issue.created_at).getTime()) < 24 * 60 * 60 * 1000;
        // Newer than the last good call (or no good call at all) = the problem is still happening.
        const ongoing = issue.created_at && (!lastSeen || new Date(issue.created_at) > new Date(lastSeen));
        const titleParts = [];
        if (issue.path) titleParts.push(issue.path);
        if (issue.error) titleParts.push(issue.error);
        const titleAttr = escapeHTML(titleParts.join(' — '));

        return `<span class="last-issue${isRecent ? ' last-issue-recent' : ''}" title="${titleAttr}">${label} · ${escapeHTML(rel)}</span>`
            + `${ongoing ? ' <span class="badge badge-danger">ongoing</span>' : ''}${good}`;
    }

    // `long` gives the activity feed's "20 min ago" phrasing; the default short form
    // ("20m ago") stays unchanged for the Users table's Last Issue column.
    function relativeTime(dateStr, long) {
        if (!dateStr) return '';
        let diffMs = Date.now() - new Date(dateStr).getTime();
        if (diffMs < 0) diffMs = 0; // clock skew guard
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 60) return long ? 'just now' : `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return long ? `${diffMin} min ago` : `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return long ? `${diffHr} hr ago` : `${diffHr}h ago`;
        const diffDay = Math.floor(diffHr / 24);
        return long ? `${diffDay} day${diffDay === 1 ? '' : 's'} ago` : `${diffDay}d ago`;
    }

    // --- Core Functions ---

    async function fetchUsers() {
        try {
            loadingSpinner.classList.remove('hidden');
            usersTbody.innerHTML = '';
            errorMessage.classList.add('hidden');

            const res = await fetch('/api/admin/users', {
                headers: getHeaders()
            });
            const data = await res.json();

            if (res.status === 401) {
                clearAdminSession();
                checkAuth();
                return;
            }

            if (!res.ok) throw new Error(data.error || 'Failed to fetch users');

            allUsers = data.users;
            usersLoaded = true;
            fillFilterOptions(filterStatus, allUsers.map(u => u.status), 'All statuses');
            fillFilterOptions(filterPlan, allUsers.map(u => u.plan), 'All plans');
            applyUserFilters();
            populateUserFilterOptions();
            // Re-render the cached feed so plan / "no account" sub-lines pick up the fresh user list.
            // Skip when activity hasn't loaded yet, so this doesn't flash the empty state before fetchActivity() runs.
            if (activityEvents.length) renderFeed(activityFeedEl, activityEvents, activityStats.matching);
        } catch (err) {
            errorMessage.textContent = err.message;
            errorMessage.classList.remove('hidden');
        } finally {
            loadingSpinner.classList.add('hidden');
        }
    }

    // Flags sessions the counter still holds that no recent login can explain (see GET /users).
    function ghostFlag(user) {
        if (!user.ghost_sessions) return '';
        return ` <button type="button" class="ghost-flag" data-id="${user.id}" data-email="${escapeHTML(user.email)}" `
            + `title="${user.ghost_sessions} session(s) with no login in the last 7 days — click to reset to 0">⚠ ${user.ghost_sessions} ghost · reset</button>`;
    }

    // One click: reuse the existing force-logout endpoint, no confirmation.
    async function resetGhostSessions(id, email) {
        try {
            const res = await fetch(`/api/admin/users/${id}/logout`, { method: 'POST', headers: getHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Reset failed');
            showToast(`Sessions reset for ${email}`);
            fetchUsers();
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    function resetChip(link) {
        if (!link) return '';
        const cls = link.status === 'pending' ? 'badge-warning' : link.status === 'used' ? 'badge-success' : 'badge-grey';
        return `<div class="reset-chip"><span class="badge ${cls}">reset link ${escapeHTML(link.status)}</span> ${escapeHTML(relativeTime(link.created_at))}</div>`;
    }

    // "plan ends" / "trial ends" under the plan name: red once lapsed, amber inside 14 days. Informational only.
    function expiryChips(user) {
        return [['plan ends', user.plan_expires_at], ['trial ends', user.trial_ends_at]].map(([label, value]) => {
            if (!value) return '';
            const t = new Date(value).getTime();
            const days = Math.ceil((t - Date.now()) / 86400000);
            const cls = days < 0 ? 'badge-danger' : days <= 14 ? 'badge-warning' : 'badge-grey';
            const text = days < 0 ? `${label}: lapsed ${-days}d ago` : `${label}: ${new Date(value).toLocaleDateString()} (${days}d)`;
            return `<div><span class="badge ${cls}">${escapeHTML(text)}</span></div>`;
        }).join('');
    }

    function renderUsers(users) {
        usersTbody.innerHTML = '';

        if (users.length === 0) {
            usersTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">No users found.</td></tr>`;
            return;
        }

        users.forEach(user => {
            const tr = document.createElement('tr');

            const createdAtLocale = new Date(user.created_at).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            });
            const lastLoginLocale = user.last_login
                ? new Date(user.last_login).toLocaleDateString()
                : '<span style="color:var(--text-secondary)">Never</span>';

            const extVersionHtml = user.ext_version
                ? `<div class="ext-version">v${escapeHTML(user.ext_version)}</div>`
                : '';

            tr.innerHTML = `
                <td>
                    <strong>${escapeHTML(user.email)}</strong>
                    ${extVersionHtml}
                    ${resetChip(user.reset_link)}
                </td>
                <td><span class="plan-text">${escapeHTML(user.plan)}</span>${expiryChips(user)}</td>
                <td><span class="badge status-${escapeHTML(user.status)}">${escapeHTML(user.status)}</span></td>
                <td>${user.active_sessions || 0} / ${user.max_devices}${ghostFlag(user)}</td>
                <td>${lastLoginLocale}</td>
                <td>${renderLastIssue(user.last_issue, user.last_seen)}</td>
                <td>${createdAtLocale}</td>
                <td>
                    <button class="action-btn projects" data-id="${user.id}" data-email="${escapeHTML(user.email)}" title="Projects (delete)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    </button>
                    <button class="action-btn overview" data-id="${user.id}" data-email="${escapeHTML(user.email)}" title="Overview (what this user sees, with formulas)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                    </button>
                    <button class="action-btn history" data-email="${escapeHTML(user.email)}" title="View history">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    </button>
                    <button class="action-btn reset" data-id="${user.id}" data-email="${escapeHTML(user.email)}" title="Generate password reset link">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
                    </button>
                    <button class="action-btn edit" data-id="${user.id}" title="Edit user">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="action-btn delete" data-id="${user.id}" data-email="${escapeHTML(user.email)}" title="Delete user">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                    <button class="action-btn logout" data-id="${user.id}" data-email="${escapeHTML(user.email)}" title="Force Logout Devices">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    </button>
                </td>
            `;
            usersTbody.appendChild(tr);
        });

        document.querySelectorAll('.action-btn.projects').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const t = e.currentTarget;
                openProjectsModal(t.getAttribute('data-id'), t.getAttribute('data-email'));
            });
        });

        document.querySelectorAll('.action-btn.overview').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const t = e.currentTarget;
                openOverviewModal(t.getAttribute('data-id'), t.getAttribute('data-email'));
            });
        });

        document.querySelectorAll('.action-btn.history').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const email = e.currentTarget.getAttribute('data-email');
                openHistoryModal(email);
            });
        });

        document.querySelectorAll('.action-btn.reset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const t = e.currentTarget;
                generateResetLink(t.getAttribute('data-id'), t.getAttribute('data-email'));
            });
        });

        // Attach event listeners
        document.querySelectorAll('.action-btn.edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const user = allUsers.find(u => u.id == id);
                if (user) promptEditUser(user);
            });
        });

        document.querySelectorAll('.action-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const id = target.getAttribute('data-id');
                const email = target.getAttribute('data-email');
                promptDeleteUser(id, email);
            });
        });

        document.querySelectorAll('.action-btn.logout').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const id = target.getAttribute('data-id');
                const email = target.getAttribute('data-email');
                promptLogoutUser(id, email);
            });
        });

        document.querySelectorAll('.ghost-flag').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const t = e.currentTarget;
                resetGhostSessions(t.getAttribute('data-id'), t.getAttribute('data-email'));
            });
        });
    }

    function promptEditUser(user) {
        userToEdit = user;
        
        // Populate form
        document.getElementById('email').value = user.email;
        document.getElementById('password').value = ''; // Don't show old hash
        document.getElementById('password').required = false; // Optional password
        document.getElementById('plan').value = user.plan;
        document.getElementById('status').value = user.status;
        document.getElementById('max-devices').value = user.max_devices;
        document.getElementById('plan-expires').value = user.plan_expires_at ? String(user.plan_expires_at).slice(0, 10) : '';
        document.getElementById('trial-ends').value = user.trial_ends_at ? String(user.trial_ends_at).slice(0, 10) : '';

        addUserModal.querySelector('h3').textContent = 'Edit User';
        addUserForm.querySelector('.submit-btn').textContent = 'Save Changes';
        
        openModal(addUserModal);
    }

    // Opens the modal and lets the admin pick the connection first; the link is only
    // issued (voiding older ones) when they press Generate.
    async function generateResetLink(id, email) {
        try {
            const res = await fetch('/api/admin/reset-bases', { headers: getHeaders() });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load connections');
            document.getElementById('reset-user-email').textContent = email;
            const select = document.getElementById('reset-base');
            select.innerHTML = '';
            data.bases.forEach(base => {
                const opt = document.createElement('option');
                opt.value = base;
                opt.textContent = base;
                select.appendChild(opt);
            });
            // Besides the configured connections, the admin can type any base URL.
            const customOpt = document.createElement('option');
            customOpt.value = '__custom__';
            customOpt.textContent = 'Type a URL…';
            select.appendChild(customOpt);
            const custom = document.getElementById('reset-base-custom');
            custom.value = '';
            const syncCustom = () => custom.classList.toggle('hidden', select.value !== '__custom__');
            select.onchange = syncCustom;
            if (data.bases.length === 0) select.value = '__custom__';
            syncCustom();
            document.getElementById('reset-result').classList.add('hidden');
            const genBtn = document.getElementById('reset-generate-btn');
            genBtn.onclick = () => {
                const base = select.value === '__custom__' ? custom.value.trim() : select.value;
                if (!base) { showToast('Type the base URL first', 'error'); return; }
                issueResetLink(id, base);
            };
            openModal(document.getElementById('reset-modal'));
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function issueResetLink(id, base) {
        try {
            const res = await fetch(`/api/admin/users/${id}/reset-link`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ base })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to generate link');
            document.getElementById('reset-expires').textContent = new Date(data.expires_at).toLocaleString();
            const box = document.getElementById('reset-links');
            box.innerHTML = '';
            data.links.forEach(link => {
                const input = document.createElement('input');
                input.type = 'text';
                input.readOnly = true;
                input.value = link;
                input.style.cssText = 'width:100%;margin:6px 0';
                input.addEventListener('focus', () => input.select());
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn primary-btn';
                btn.textContent = 'Copy';
                btn.addEventListener('click', () => navigator.clipboard.writeText(link).then(() => showToast('Link copied')));
                box.append(input, btn);
            });
            document.getElementById('reset-result').classList.remove('hidden');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    // ---- Projects modal: choose a user's project and delete it ----
    const projectsModal = document.getElementById('projects-modal');
    const projectsList = document.getElementById('projects-list');
    const projectsTitle = document.getElementById('projects-modal-title');
    const projectsLoading = document.getElementById('projects-loading');
    const projectsError = document.getElementById('projects-error');
    let projectsUser = null;
    let projectsData = [];
    const projectsSearch = document.getElementById('projects-search');
    const projectsFilter = document.getElementById('projects-filter');
    const projectsSort = document.getElementById('projects-sort');
    const projectsCount = document.getElementById('projects-count');

    // Search + filter + sort over the projects already loaded for this user.
    function applyProjectFilters() {
        const term = projectsSearch.value.trim().toLowerCase();
        const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
        const time = (v) => new Date(v).getTime();
        const filters = {
            all: () => true,
            with_posts: p => p.post_count > 0,
            empty: p => p.post_count === 0,
            recent: p => time(p.created_at) >= cutoff,
        };
        const sorters = {
            created_desc: (a, b) => time(b.created_at) - time(a.created_at),
            created_asc: (a, b) => time(a.created_at) - time(b.created_at),
            name_asc: (a, b) => a.name.localeCompare(b.name),
            posts_desc: (a, b) => b.post_count - a.post_count,
            posts_asc: (a, b) => a.post_count - b.post_count,
        };
        const rows = projectsData
            .filter(p => p.name.toLowerCase().includes(term))
            .filter(filters[projectsFilter.value] || filters.all)
            .sort(sorters[projectsSort.value] || sorters.created_desc);
        projectsCount.textContent = projectsData.length ? `Showing ${rows.length} of ${projectsData.length} projects` : '';
        renderProjects(rows, projectsData.length ? 'No projects match your search or filter.' : 'This user has no projects.');
    }
    projectsSearch.addEventListener('input', applyProjectFilters);
    [projectsFilter, projectsSort].forEach(el => el.addEventListener('change', applyProjectFilters));

    async function openProjectsModal(userId, email) {
        projectsUser = { id: userId, email };
        projectsTitle.textContent = `Projects of ${email}`;
        projectsSearch.value = '';
        projectsFilter.value = 'all';
        projectsSort.value = 'created_desc';
        openModal(projectsModal);
        await loadProjects();
    }

    async function loadProjects() {
        projectsList.innerHTML = '';
        projectsError.classList.add('hidden');
        projectsLoading.classList.remove('hidden');
        try {
            const data = await adminGet(`/api/admin/users/${projectsUser.id}/projects`);
            projectsData = data.projects;
            applyProjectFilters();
        } catch (err) {
            projectsError.textContent = err.message;
            projectsError.classList.remove('hidden');
        } finally {
            projectsLoading.classList.add('hidden');
        }
    }

    function renderProjects(projects, emptyMsg = 'This user has no projects.') {
        projectsList.innerHTML = '';
        if (projects.length === 0) {
            const empty = document.createElement('p');
            empty.style.color = 'var(--text-secondary)';
            empty.textContent = emptyMsg;
            projectsList.appendChild(empty);
            return;
        }
        projects.forEach(p => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.08)';
            const info = document.createElement('div');
            info.style.cssText = 'flex:1;min-width:200px';
            const name = document.createElement('strong');
            name.textContent = p.name;
            const meta = document.createElement('div');
            meta.style.cssText = 'font-size:0.85em;color:var(--text-secondary)';
            meta.textContent = `${p.post_count} posts · ${p.profile_count} profiles · created ${new Date(p.created_at).toLocaleDateString()}`;
            info.append(name, meta);
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'btn danger-btn';
            del.textContent = 'Delete…';
            del.addEventListener('click', () => showProjectConfirm(row, del, p));
            row.append(info, del);
            projectsList.appendChild(row);
        });
    }

    // Inline confirmation: the admin must type the exact project name.
    function showProjectConfirm(row, delBtn, project) {
        delBtn.classList.add('hidden');
        const box = document.createElement('div');
        box.style.cssText = 'flex-basis:100%;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
        const label = document.createElement('span');
        label.textContent = 'Type the project name to confirm:';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = project.name;
        input.autocomplete = 'off';
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn danger-btn';
        ok.textContent = 'Delete project';
        ok.disabled = true;
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn secondary-btn';
        cancel.textContent = 'Cancel';
        input.addEventListener('input', () => { ok.disabled = input.value !== project.name; });
        cancel.addEventListener('click', () => { box.remove(); delBtn.classList.remove('hidden'); });
        ok.addEventListener('click', () => deleteProject(project, input.value, ok));
        box.append(label, input, ok, cancel);
        row.appendChild(box);
        input.focus();
    }

    async function deleteProject(project, confirmName, okBtn) {
        try {
            okBtn.disabled = true;
            okBtn.textContent = 'Deleting...';
            const res = await fetch(`/api/admin/users/${projectsUser.id}/projects/${project.id}`, {
                method: 'DELETE',
                headers: getHeaders(),
                body: JSON.stringify({ confirm_name: confirmName })
            });
            if (res.status === 401) { clearAdminSession(); checkAuth(); throw new Error('Session expired'); }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to delete project');
            showToast(`Deleted "${data.project.name}": ${data.links_removed} post links removed, ${data.posts_deleted} posts deleted, ${data.posts_kept} kept (still used elsewhere)`, 'success');
            await loadProjects();
        } catch (err) {
            showToast(err.message, 'error');
            okBtn.disabled = false;
            okBtn.textContent = 'Delete project';
        }
    }

    function promptDeleteUser(id, email) {
        userToDelete = { id, email };
        deleteUserEmail.textContent = email;
        openModal(deleteModal);
    }

    function promptLogoutUser(id, email) {
        userToLogout = { id, email };
        logoutUserEmail.textContent = email;
        openModal(logoutModal);
    }

    // ---- User overview modal: read-only view of what a user sees in a project, with formulas ----
    const ovModal = document.getElementById('overview-modal');
    const ovEls = {
        title: document.getElementById('overview-modal-title'), top: document.getElementById('overview-top'),
        warnings: document.getElementById('overview-warnings'), metrics: document.getElementById('overview-metrics'),
        detail: document.getElementById('overview-detail'), tabs: document.getElementById('overview-tabs'),
        tabBody: document.getElementById('overview-tab-body'), browserOnly: document.getElementById('overview-browser-only'),
        loading: document.getElementById('overview-loading'), error: document.getElementById('overview-error'),
    };
    let ovUser = null;
    let ovData = null;
    let ovTab = 'posts';
    let ovRequest = 0;

    const ovFmt = (v) => {
        if (v === null || v === undefined || v === '') return '-';
        if (typeof v === 'number') return v.toLocaleString();
        if (typeof v === 'boolean') return v ? 'yes' : 'no';
        if (/^\d{4}-\d{2}-\d{2}T/.test(String(v))) { const d = new Date(v); if (!isNaN(d)) return d.toLocaleString(); }
        return String(v);
    };

    // Every cell goes through esc(), so nothing from the data is interpreted as HTML.
    function ovTable(columns, rows, total) {
        if (!rows.length && !total) return '<p class="ov-muted">No rows.</p>';
        const cls = (c) => (c.numeric ? ' class="ov-num"' : '');
        const head = columns.map(c => `<th${cls(c)}>${esc(c.label)}</th>`).join('');
        const line = (r, strong) => `<tr>${columns.map(c => `<td${cls(c)}>${strong ? '<strong>' : ''}${esc(ovFmt(r[c.key]))}${strong ? '</strong>' : ''}</td>`).join('')}</tr>`;
        return `<table><thead><tr>${head}</tr></thead><tbody>${rows.map(r => line(r, false)).join('')}${total ? line(total, true) : ''}</tbody></table>`;
    }

    async function openOverviewModal(userId, email) {
        ovUser = { id: userId, email };
        ovData = null;
        ovEls.title.textContent = `Overview of ${email}`;
        ovTab = 'posts';
        openModal(ovModal);
        await loadOverview(null);
    }

    async function loadOverview(projectId) {
        const mine = ++ovRequest;
        ovEls.error.classList.add('hidden');
        ovEls.loading.classList.remove('hidden');
        try {
            const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
            const data = await adminGet(`/api/admin/users/${encodeURIComponent(ovUser.id)}/overview${q}`);
            if (mine !== ovRequest) return;
            ovData = data;
            ovCreators = null;
            ovSelected.clear();
            ovHideConfirm();
            renderOverview();
            if (data.selected_project_id) ovLoadCreators(data.selected_project_id, mine);
        } catch (err) {
            if (mine !== ovRequest) return;
            ovEls.error.textContent = err.message;
            ovEls.error.classList.remove('hidden');
        } finally {
            if (mine === ovRequest) ovEls.loading.classList.add('hidden');
        }
    }

    function renderOverview() {
        const d = ovData;
        const u = d.user;
        const opts = d.projects.map(p => `<option value="${esc(p.id)}"${p.id === d.selected_project_id ? ' selected' : ''}>${esc(p.name)} (${esc(p.posts)} posts)</option>`).join('');
        ovEls.top.innerHTML =
            `<span>Project:</span><select id="overview-project" aria-label="Project">${opts || '<option>No projects</option>'}</select>` +
            `<span class="badge status-${esc(u.status)}">${esc(u.status)}</span>` +
            `<span>Platform: ${esc(d.platform)}</span><span>Plan: ${esc(u.plan)}${u.plan_expires_at ? ' (expires ' + esc(ovFmt(u.plan_expires_at)) + ')' : ''}${u.trial_ends_at ? ', trial ends ' + esc(ovFmt(u.trial_ends_at)) : ''}</span>` +
            `<span>Devices: ${esc(u.active_sessions)} / ${esc(u.max_devices)}</span><span>Last login: ${esc(ovFmt(u.last_login))}</span>`;
        const sel = document.getElementById('overview-project');
        if (sel && d.projects.length) sel.addEventListener('change', () => loadOverview(sel.value));

        ovEls.warnings.innerHTML = d.warnings.map(w => `<div class="ov-warn ${esc(w.severity)}"><strong>${esc(String(w.severity).toUpperCase())}</strong> ${esc(w.message)}</div>`).join('');
        ovEls.metrics.innerHTML = d.metrics.length
            ? d.metrics.map((m, i) => `<button type="button" class="ov-metric" data-i="${i}"><span>${esc(m.label)}</span><b>${esc(ovFmt(m.value))}</b></button>`).join('')
            : '<p class="ov-muted">This user has no project yet.</p>';
        ovEls.metrics.querySelectorAll('.ov-metric').forEach(b => b.addEventListener('click', () => {
            ovEls.metrics.querySelectorAll('.ov-metric').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            renderOverviewDetail(d.metrics[Number(b.getAttribute('data-i'))]);
        }));
        ovEls.detail.innerHTML = '<p class="ov-muted">Click a number to see how it was built.</p>';
        ovEls.browserOnly.innerHTML = '<strong>Computed in the browser (the server cannot see):</strong><ul>' + d.browser_only.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>';
        renderOverviewTab();
    }

    function renderOverviewDetail(m) {
        const b = m.breakdown ? ovData.breakdowns[m.breakdown] : null;
        let h = `<h4>${esc(m.label)} = ${esc(ovFmt(m.value))}</h4><div class="ov-formula">${esc(m.formula)}</div>` +
            `<div class="ov-muted">Inputs: ${m.inputs.map(esc).join(', ') || '-'}</div>`;
        if (b) h += `<h4>${esc(b.title)}</h4><p class="ov-muted">${esc(b.explain)}</p>${ovTable(b.columns, b.rows, b.total)}`;
        ovEls.detail.innerHTML = h;
    }

    function renderOverviewTab() {
        const d = ovData;
        ovEls.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === ovTab));
        const c = (key, label, numeric = false) => ({ key, label, numeric });
        let html = '';
        if (ovTab === 'posts') {
            html = ovPostsHtml(d);
        } else if (ovTab === 'creators') {
            html = ovCreatorsHtml(d);
        } else if (ovTab === 'history') {
            html = ovTable([c('at', 'When'), c('source', 'Source'), c('action', 'Action'), c('detail', 'Detail')], d.save_history, null);
        } else {
            html = `<p class="ov-muted">No per-device table exists; these are successful logins from the activity log (last 7 days). Counter: ${esc(d.user.active_sessions)} active of ${esc(d.user.max_devices)} allowed.</p>` +
                ovTable([c('at', 'When'), c('kind', 'Kind'), c('ip', 'IP'), c('user_agent', 'User agent'), c('ext_version', 'Extension')], d.sessions, null);
        }
        ovEls.tabBody.innerHTML = html;
        ovWireTab();
        ovSetBusy(ovBusy);
    }

    // ---- Admin actions on one project's posts: hide / unhide / delete / restore / remove creator ----
    // Every action is previewed (dry_run) first, confirmed, then sent with expect_count.
    const ovActionBox = document.getElementById('overview-action');
    const ovSelected = new Set();
    let ovBusy = false;
    let ovCreators = null; // null = loading, { rows } or { error }
    const OV_VERBS = {
        hide: { verb: 'Hide', past: 'Hid' }, unhide: { verb: 'Unhide', past: 'Unhid' },
        delete: { verb: 'Delete', past: 'Deleted' }, restore: { verb: 'Restore', past: 'Restored' },
    };

    function ovProjectName() {
        const p = ovData && ovData.projects.find(x => x.id === ovData.selected_project_id);
        return p ? p.name : '';
    }

    // Disables every action button while a request runs; buttons with nothing to act on stay disabled.
    function ovSetBusy(on) {
        ovBusy = on;
        ovModal.querySelectorAll('.ov-act').forEach(b => { b.disabled = on || b.getAttribute('data-zero') === '1'; });
    }

    function ovUpdateBulk() {
        const n = ovSelected.size;
        const label = document.getElementById('ov-sel-count');
        if (label) label.textContent = `${n} selected`;
        ovEls.tabBody.querySelectorAll('.ov-bulk-btn').forEach(b => b.setAttribute('data-zero', n === 0 ? '1' : '0'));
        ovSetBusy(ovBusy);
    }

    function ovPostsHtml(d) {
        const c = (key, label, numeric = false) => ({ key, label, numeric });
        const s = d.hidden_summary || { hidden: 0, deleted: 0 };
        const cols = [c('shortcode', 'Post'), c('owner', 'Owner'), c('likes', 'Likes', true), c('comments', 'Comments', true), c('posted_at', 'Posted'), c('is_paid', 'Paid'), c('type', 'Type'), c('collective_reach', 'Collective reach', true), c('has_metrics', 'Has metrics')];
        if (!d.posts.length) return '<p class="ov-muted">No rows.</p>';
        const bulk = Object.keys(OV_VERBS).map(a => `<button type="button" class="btn btn-secondary ov-small ov-act ov-bulk-btn" data-bulk="${esc(a)}" data-zero="${ovSelected.size ? '0' : '1'}">${esc(OV_VERBS[a].verb)} selected</button>`).join('');
        const head = '<th></th><th>State</th>' + cols.map(x => `<th${x.numeric ? ' class="ov-num"' : ''}>${esc(x.label)}</th>`).join('');
        const rows = d.posts.map(p => {
            const state = p.state || 'visible';
            const checked = ovSelected.has(p.shortcode) ? ' checked' : '';
            return `<tr><td><input type="checkbox" class="ov-pick" data-sc="${esc(p.shortcode)}"${checked} aria-label="Select post ${esc(p.shortcode)}"></td>` +
                `<td><span class="ov-state ov-state-${esc(state)}">${esc(state)}</span></td>` +
                cols.map(x => `<td${x.numeric ? ' class="ov-num"' : ''}>${esc(ovFmt(p[x.key]))}</td>`).join('') + '</tr>';
        }).join('');
        return `<p class="ov-muted">${esc(s.hidden)} hidden and ${esc(s.deleted)} deleted post(s) in this project are not counted in any number above or in the user's app.</p>` +
            `<div class="ov-bulk"><label><input type="checkbox" id="ov-select-all"> Select all on this page</label><span id="ov-sel-count">${ovSelected.size} selected</span>${bulk}</div>` +
            `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    function ovCreatorsHtml(d) {
        const c = (key, label, numeric = false) => ({ key, label, numeric });
        let html;
        if (ovCreators === null) {
            html = '<p class="ov-muted">Loading creators...</p>';
        } else if (ovCreators.error) {
            html = `<p class="ov-muted">Could not load creators: ${esc(ovCreators.error)}</p>`;
        } else if (!ovCreators.rows.length) {
            html = '<p class="ov-muted">No creators in this project.</p>';
        } else {
            const btn = (act, label, user, zero) => `<button type="button" class="btn ${act === 'remove' || act === 'delete' ? 'danger-btn' : 'btn-secondary'} ov-small ov-act" data-creator-act="${esc(act)}" data-user="${esc(user)}" data-zero="${zero ? '1' : '0'}">${esc(label)}</button>`;
            const rows = ovCreators.rows.map(r => {
                const v = Number(r.visible) || 0, h = Number(r.hidden) || 0, x = Number(r.deleted) || 0;
                return `<tr><td>@${esc(r.username)}</td><td>${esc(r.role)}</td><td class="ov-num">${esc(v)}</td><td class="ov-num">${esc(h)}</td><td class="ov-num">${esc(x)}</td>` +
                    `<td>${btn('hide', 'Hide', r.username, v === 0)}${btn('unhide', 'Unhide', r.username, h === 0)}${btn('delete', 'Delete', r.username, v + h === 0)}${btn('remove', 'Remove creator', r.username, false)}</td></tr>`;
            }).join('');
            html = '<table><thead><tr><th>Creator</th><th>Role</th><th class="ov-num">Visible</th><th class="ov-num">Hidden</th><th class="ov-num">Deleted</th><th>Actions</th></tr></thead>' +
                `<tbody>${rows}</tbody></table>`;
        }
        return html + '<h4>Reach per creator (visible posts only)</h4>' +
            ovTable([c('username', 'Creator'), c('role', 'Role'), c('follower_count', 'Followers', true), c('posts', 'Posts', true), c('adds', 'Adds', true), c('scraped_at', 'scraped_at'), c('observed_at', 'observed_at')], d.creators, null);
    }

    function ovWireTab() {
        ovEls.tabBody.querySelectorAll('[data-creator-act]').forEach(b => b.addEventListener('click', () => {
            ovCreatorAction(b.getAttribute('data-creator-act'), b.getAttribute('data-user'));
        }));
        ovEls.tabBody.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => ovBulkAction(b.getAttribute('data-bulk'))));
        const picks = ovEls.tabBody.querySelectorAll('.ov-pick');
        picks.forEach(p => p.addEventListener('change', () => {
            const sc = p.getAttribute('data-sc');
            if (p.checked) ovSelected.add(sc); else ovSelected.delete(sc);
            ovUpdateBulk();
        }));
        const all = document.getElementById('ov-select-all');
        if (all) all.addEventListener('change', () => {
            picks.forEach(p => {
                p.checked = all.checked;
                const sc = p.getAttribute('data-sc');
                if (all.checked) ovSelected.add(sc); else ovSelected.delete(sc);
            });
            ovUpdateBulk();
        });
    }

    async function ovPost(path, body) {
        const url = `/api/admin/users/${encodeURIComponent(ovUser.id)}/projects/${encodeURIComponent(ovData.selected_project_id)}/${path}`;
        const res = await fetch(url, { method: 'POST', headers: getHeaders(), body: JSON.stringify(body) });
        if (res.status === 401) { clearAdminSession(); checkAuth(); throw new Error('Signed out'); }
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) throw new Error(`The number of posts changed (now ${data.affected}). Nothing was changed; start the action again.`);
        if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
        return data;
    }

    function ovHideConfirm() {
        ovActionBox.classList.add('hidden');
        ovActionBox.textContent = '';
    }

    // Step 1: preview with dry_run=true, then show the confirm box.
    async function ovRunAction(spec) {
        if (ovBusy || !ovData || !ovData.selected_project_id) return;
        ovHideConfirm();
        ovSetBusy(true);
        try {
            const preview = await ovPost(spec.path, { ...spec.body, dry_run: true });
            ovShowConfirm(spec, preview);
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            ovSetBusy(false);
        }
    }

    function ovShowConfirm(spec, preview) {
        const n = Number(preview.affected) || 0;
        const box = ovActionBox;
        box.textContent = '';
        const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
        const msg = mk('div', 'ov-action-msg', n === 0 && !spec.allowZero ? spec.empty : spec.question(n, preview));
        box.appendChild(msg);
        if (spec.hint) box.appendChild(mk('div', 'ov-muted', spec.hint));
        if (preview.sample && preview.sample.length && n > 0) box.appendChild(mk('div', 'ov-muted', `First posts: ${preview.sample.join(', ')}`));
        const row = mk('div', 'ov-action-row');
        const cancel = mk('button', 'btn btn-secondary', n === 0 && !spec.allowZero ? 'Close' : 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', ovHideConfirm);
        if (n === 0 && !spec.allowZero) {
            row.appendChild(cancel);
            box.appendChild(row);
            box.classList.remove('hidden'); box.scrollIntoView({ block: 'nearest' });
            return;
        }
        let input = null;
        if (spec.typeDelete) {
            input = mk('input');
            input.type = 'text';
            input.placeholder = 'Type DELETE';
            input.autocomplete = 'off';
            input.setAttribute('aria-label', 'Type DELETE to confirm');
            row.appendChild(input);
        }
        const ok = mk('button', `btn ${spec.typeDelete ? 'danger-btn' : 'btn-secondary'}`, spec.confirmLabel);
        ok.type = 'button';
        const typedOk = () => !input || input.value === 'DELETE';
        ok.disabled = !typedOk();
        if (input) input.addEventListener('input', () => { ok.disabled = !typedOk(); });
        ok.addEventListener('click', async () => {
            if (ovBusy || !typedOk()) return;
            ovSetBusy(true);
            ok.disabled = true;
            cancel.disabled = true;
            const old = ok.textContent;
            ok.textContent = 'Working...';
            const prev = box.querySelector('.ov-action-error');
            if (prev) prev.remove();
            try {
                const done = await ovPost(spec.path, { ...spec.body, dry_run: false, expect_count: n });
                showToast(spec.done(done), 'success');
                ovHideConfirm();
                ovSelected.clear();
                await loadOverview(ovData.selected_project_id);
            } catch (err) {
                showToast(err.message, 'error');
                box.appendChild(mk('div', 'ov-action-error', err.message));
                ok.textContent = old;
                ok.disabled = !typedOk();
                cancel.disabled = false;
            } finally {
                ovSetBusy(false);
            }
        });
        row.append(ok, cancel);
        box.appendChild(row);
        box.classList.remove('hidden'); box.scrollIntoView({ block: 'nearest' });
        if (input) input.focus();
    }

    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    function ovCreatorAction(action, user) {
        const pn = ovProjectName();
        if (action === 'remove') {
            ovRunAction({
                path: 'profiles/remove', body: { username: user, with_posts: true }, typeDelete: true, allowZero: true,
                confirmLabel: 'Remove creator',
                question: (n, p) => `Remove @${user} from '${pn}' and delete ${plural(n, 'post')} by them in it? (${plural(Number(p.profile_rows) || 0, 'profile row')} removed)`,
                hint: 'Only this project is changed. The posts stay in the shared database and in other projects; deleted links can be restored later.',
                done: (r) => `Removed @${user} from '${pn}': ${plural(r.affected, 'post')} deleted, ${plural(r.profile_rows, 'profile row')} removed`,
            });
            return;
        }
        const v = OV_VERBS[action];
        if (!v) return;
        ovRunAction({
            path: 'posts/action', body: { action, creator: user }, typeDelete: action === 'delete', confirmLabel: v.verb,
            question: (n) => `${v.verb} ${plural(n, 'post')} by @${user} in '${pn}'?`,
            empty: `No posts by @${user} in '${pn}' can be ${v.verb.toLowerCase()}d.`,
            hint: action === 'delete' ? 'Soft delete: the post links of this project are marked deleted and can be restored; other projects are not affected.' : '',
            done: (r) => `${v.past} ${plural(r.affected, 'post')} by @${user} in '${pn}'`,
        });
    }

    function ovBulkAction(action) {
        const v = OV_VERBS[action];
        const codes = [...ovSelected];
        if (!v || !codes.length) return;
        if (codes.length > 5000) { showToast('Select at most 5000 posts at once', 'error'); return; }
        const pn = ovProjectName();
        ovRunAction({
            path: 'posts/action', body: { action, shortcodes: codes }, typeDelete: action === 'delete', confirmLabel: v.verb,
            question: (n) => `${v.verb} ${plural(n, 'post')} in '${pn}'?` + (n !== codes.length ? ` (${n} of the ${codes.length} selected posts apply)` : ''),
            empty: `None of the ${codes.length} selected posts can be ${v.verb.toLowerCase()}d (wrong state).`,
            hint: action === 'delete' ? 'Soft delete: the post links of this project are marked deleted and can be restored; other projects are not affected.' : '',
            done: (r) => `${v.past} ${plural(r.affected, 'post')} in '${pn}'`,
        });
    }

    async function ovLoadCreators(projectId, mine) {
        try {
            const data = await adminGet(`/api/admin/users/${encodeURIComponent(ovUser.id)}/projects/${encodeURIComponent(projectId)}/creators`);
            if (mine !== ovRequest) return;
            ovCreators = { rows: data.creators };
        } catch (err) {
            if (mine !== ovRequest) return;
            ovCreators = { error: err.message };
        }
        if (ovTab === 'creators') renderOverviewTab();
    }

    ovEls.tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        ovTab = b.getAttribute('data-tab');
        if (ovData) renderOverviewTab();
    }));

    function openModal(modal) {
        modal.classList.remove('hidden');
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.classList.add('hidden');
        });
        document.body.style.overflow = '';
        formError.classList.add('hidden');
        userToDelete = null;
        userToEdit = null;
        userToLogout = null;
    }

    function showToast(message, type = 'success') {
        toast.textContent = message;
        toast.className = `toast show ${type}`;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }
});
