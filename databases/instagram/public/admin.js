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
    const appliedFilters = { q: '', user: '', action: 'all', result: 'any', when: 'any' };
    const expandedEventIds = new Set();
    let autoRefreshTimer = null;
    let fetchSeq = 0;

    // Authentication Elements
    const loginOverlay = document.getElementById('login-overlay');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const adminContainer = document.querySelector('.admin-container');

    // Initial Auth Check
    checkAuth();

    async function checkAuth() {
        const password = sessionStorage.getItem('adminPassword');
        if (password) {
            loginOverlay.classList.add('hidden');
            adminContainer.classList.remove('blurred');
            // Activity rows need allUsers loaded first (plan / "no account" sub-line).
            await fetchUsers();
            if (!sessionStorage.getItem('adminPassword')) return; // fetchUsers hit a 401 and logged us out
            fetchActivity();
            activityAutoRefreshToggle.checked = getAutoRefreshPref();
            if (activityAutoRefreshToggle.checked) startAutoRefresh(); else stopAutoRefresh();
        } else {
            loginOverlay.classList.remove('hidden');
            adminContainer.classList.add('blurred');
            stopAutoRefresh();
        }
    }

    function getHeaders() {
        return {
            'Content-Type': 'application/json',
            'x-admin-password': sessionStorage.getItem('adminPassword')
        };
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('admin-password').value;
        const submitBtn = loginForm.querySelector('.submit-btn');

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Verifying...';
            loginError.classList.add('hidden');

            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });

            if (!res.ok) throw new Error('Incorrect password');

            sessionStorage.setItem('adminPassword', pwd);
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

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allUsers.filter(u => u.email.toLowerCase().includes(term));
        renderUsers(filtered);
    });

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

            const res = await fetch(url, {
                method,
                headers: getHeaders(),
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.status === 401) {
                sessionStorage.removeItem('adminPassword');
                checkAuth();
                throw new Error('Session expired. Please login again.');
            }

            // Success
            showToast(`User ${email} created successfully`, 'success');
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
                sessionStorage.removeItem('adminPassword');
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
                sessionStorage.removeItem('adminPassword');
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
            if (!sessionStorage.getItem('adminPassword')) return;
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
                sessionStorage.removeItem('adminPassword');
                checkAuth();
                return;
            }

            if (!res.ok) throw new Error(data.error || 'Failed to fetch activity');
            if (seq !== fetchSeq) return; // a newer request already landed

            activityEvents = data.events || [];
            activityStats = data.stats || activityStats;
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
            const res = await fetch(`/api/admin/events?email=${encodeURIComponent(email)}&limit=100`, {
                headers: getHeaders()
            });
            const data = await res.json();

            if (res.status === 401) {
                sessionStorage.removeItem('adminPassword');
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

    function badgeFor(ev) {
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
        const header = ['created_at', 'email', 'method', 'path', 'status', 'reason', 'error', 'ip', 'user_agent', 'ext_version', 'user_id', 'id'];
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
                sessionStorage.removeItem('adminPassword');
                checkAuth();
                return;
            }
            if (!res.ok) throw new Error(data.error || 'Failed to export activity');

            downloadCSV(data.events || []);
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    function renderLastIssue(issue) {
        if (!issue) return '<span style="color:var(--text-secondary)">—</span>';

        const label = escapeHTML(issue.reason || String(issue.status));
        const rel = relativeTime(issue.created_at);
        const isRecent = issue.created_at && (Date.now() - new Date(issue.created_at).getTime()) < 24 * 60 * 60 * 1000;
        const titleParts = [];
        if (issue.path) titleParts.push(issue.path);
        if (issue.error) titleParts.push(issue.error);
        const titleAttr = escapeHTML(titleParts.join(' — '));

        return `<span class="last-issue${isRecent ? ' last-issue-recent' : ''}" title="${titleAttr}">${label} · ${escapeHTML(rel)}</span>`;
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
                sessionStorage.removeItem('adminPassword');
                checkAuth();
                return;
            }

            if (!res.ok) throw new Error(data.error || 'Failed to fetch users');

            allUsers = data.users;
            usersLoaded = true;
            renderUsers(allUsers);
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
                </td>
                <td><span class="plan-text">${escapeHTML(user.plan)}</span></td>
                <td><span class="badge status-${user.status}">${escapeHTML(user.status)}</span></td>
                <td>${user.active_sessions || 0} / ${user.max_devices}</td>
                <td>${lastLoginLocale}</td>
                <td>${renderLastIssue(user.last_issue)}</td>
                <td>${createdAtLocale}</td>
                <td>
                    <button class="action-btn history" data-email="${escapeHTML(user.email)}" title="View history">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
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

        document.querySelectorAll('.action-btn.history').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const email = e.currentTarget.getAttribute('data-email');
                openHistoryModal(email);
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

        addUserModal.querySelector('h3').textContent = 'Edit User';
        addUserForm.querySelector('.submit-btn').textContent = 'Save Changes';
        
        openModal(addUserModal);
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
