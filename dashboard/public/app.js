'use strict';

const PASS_KEY = 'dashboardPassword';
let password = sessionStorage.getItem(PASS_KEY) || '';

const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const passwordInput = document.getElementById('dashboard-password');

const alertsStrip = document.getElementById('alerts-strip');
const cardTiktok = document.getElementById('card-tiktok');
const cardInstagram = document.getElementById('card-instagram');
const updatedStamp = document.getElementById('updated-stamp');
const platformFilter = document.getElementById('platform-filter');
const eventsBody = document.getElementById('events-body');
const eventsErrors = document.getElementById('events-errors');
const checksPanel = document.getElementById('checks-panel');
const checksResult = document.getElementById('checks-result');
const resultFilter = document.getElementById('result-filter');
const actionFilter = document.getElementById('action-filter');
const userFilter = document.getElementById('user-filter');
const qFilter = document.getElementById('q-filter');
const eventsStats = document.getElementById('events-stats');
const usersPlatform = document.getElementById('users-platform');
const usersSearch = document.getElementById('users-search');
const usersStatus = document.getElementById('users-status');
const usersSort = document.getElementById('users-sort');
const usersBody = document.getElementById('users-body');
const usersNote = document.getElementById('users-note');

let overviewInFlight = false;
let eventsInFlight = false;
let eventsReload = false; // a filter changed while a request was running
let refreshTimer = null;

function el(tag, opts) {
    const node = document.createElement(tag);
    if (opts) {
        if (opts.className) node.className = opts.className;
        if (opts.text !== undefined) node.textContent = opts.text;
        if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
    }
    return node;
}

function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

function fmtVal(v) {
    return (v === null || v === undefined || v === '') ? '—' : String(v);
}

function showLogin(message) {
    sessionStorage.removeItem(PASS_KEY);
    password = '';
    app.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    if (message) {
        loginError.textContent = message;
        loginError.classList.remove('hidden');
    } else {
        loginError.classList.add('hidden');
    }
    stopAutoRefresh();
    // Closing an on-demand panel also empties it, so no user rows stay in the page after logout.
    document.querySelectorAll('details.on-demand').forEach((d) => { d.open = false; });
    if (typeof uoClose === 'function') uoClose();
}

function showApp() {
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
}

async function api(path, opts) {
    const res = await fetch(path, Object.assign({}, opts, {
        headers: Object.assign({ 'x-dashboard-password': password }, (opts && opts.headers) || {})
    }));
    if (res.status === 401) {
        showLogin('Wrong password');
        throw new Error('unauthorized');
    }
    // /api/check has its own 429 (the cooldown); only the lockout carries `locked`.
    if (res.status === 429) {
        const body = await res.clone().json().catch(() => ({}));
        if (body.locked) {
            showLogin(lockedMessage(body));
            throw new Error('unauthorized');
        }
    }
    return res;
}

function lockedMessage(body) {
    const minutes = Math.max(1, Math.ceil((body.retry_after_s || 0) / 60));
    return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const candidate = passwordInput.value;
    password = candidate;
    try {
        const res = await fetch('/api/overview', { headers: { 'x-dashboard-password': password } });
        if (res.status === 401) {
            password = '';
            loginError.textContent = 'Wrong password';
            loginError.classList.remove('hidden');
            return;
        }
        if (res.status === 429) {
            password = '';
            loginError.textContent = lockedMessage(await res.json().catch(() => ({})));
            loginError.classList.remove('hidden');
            return;
        }
        sessionStorage.setItem(PASS_KEY, password);
        showApp();
        startAutoRefresh();
        refreshAll();
    } catch (err) {
        loginError.textContent = 'Could not reach server';
        loginError.classList.remove('hidden');
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    showLogin();
});

document.getElementById('refresh-btn').addEventListener('click', () => refreshAll());
document.getElementById('check-btn').addEventListener('click', () => runChecks());
platformFilter.addEventListener('change', () => loadEvents());
resultFilter.addEventListener('change', () => loadEvents());
actionFilter.addEventListener('change', () => loadEvents());
let filterTimer = null;
function loadEventsSoon() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadEvents, 400);
}
userFilter.addEventListener('input', loadEventsSoon);
qFilter.addEventListener('input', loadEventsSoon);
document.getElementById('events-clear').addEventListener('click', () => {
    platformFilter.value = 'all';
    resultFilter.value = 'any';
    actionFilter.value = 'all';
    userFilter.value = '';
    qFilter.value = '';
    loadEvents();
});

// ---- Overview ----

function severityClass(sev) {
    return sev === 'danger' ? 'danger' : 'warning';
}

function buildAlertRow(platform, alert) {
    const row = el('div', { className: `alert-row ${severityClass(alert.severity)}` });
    row.appendChild(el('span', { className: `badge platform-${platform}`, text: platform === 'tiktok' ? 'TikTok' : 'Instagram' }));
    row.appendChild(el('span', { text: alertText(alert) }));
    if (alert.ip) {
        const link = el('button', { className: 'ip-link', text: `Show events from ${alert.ip}` });
        link.type = 'button';
        link.addEventListener('click', () => filterEventsByIp(platform, alert.ip));
        row.appendChild(link);
        const block = el('button', { className: 'ip-link danger-link', text: 'Block IP' });
        block.type = 'button';
        block.addEventListener('click', () => openBlockDialog(platform, alert.ip));
        row.appendChild(block);
    }
    return row;
}

// Older backends send the numbers only inside the message, so that stays the fallback.
function alertText(alert) {
    if (alert.type !== 'failed_logins_ip' || !alert.ip || typeof alert.count !== 'number') return alert.message || '';
    const accounts = typeof alert.accounts === 'number'
        ? `, ${alert.accounts} account${alert.accounts === 1 ? '' : 's'} targeted`
        : '';
    return `${alert.ip}: ${alert.count} failed logins in 15 min${accounts}`;
}

function renderAlerts(data) {
    clear(alertsStrip);
    const rows = [];
    for (const platform of ['tiktok', 'instagram']) {
        const side = data[platform];
        if (!side) continue;
        if (side.up === false) {
            rows.push(buildAlertRow(platform, {
                severity: 'danger',
                message: `${platform === 'tiktok' ? 'TikTok' : 'Instagram'} backend unreachable: ${side.error || 'unknown error'}`
            }));
            continue;
        }
        if (Array.isArray(side.alerts)) {
            for (const a of side.alerts) {
                rows.push(buildAlertRow(platform, a));
            }
        }
        if (side.migrations_ok === false) {
            rows.push(buildAlertRow(platform, { severity: 'warning', message: 'Migrations not up to date' }));
        }
        if (Array.isArray(side.errors) && side.errors.length) {
            for (const errMsg of side.errors) {
                rows.push(buildAlertRow(platform, { severity: 'warning', message: errMsg }));
            }
        }
    }
    if (rows.length === 0) {
        const ok = el('div', { className: 'alert-row success' });
        ok.appendChild(el('span', { text: 'All clear' }));
        alertsStrip.appendChild(ok);
        return;
    }
    rows.forEach((r) => alertsStrip.appendChild(r));
}

function renderSlowTable(container, slow) {
    container.appendChild(el('h3', { text: 'Slow endpoints' }));
    if (!Array.isArray(slow) || slow.length === 0) {
        container.appendChild(el('p', { text: '—' }));
        return;
    }
    const wrap = el('div', { className: 'table-container' });
    const table = el('table');
    const thead = el('thead');
    const headRow = el('tr');
    ['Method', 'Path', 'Slow', 'Avg ms', 'Max ms'].forEach((h) => headRow.appendChild(el('th', { text: h })));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el('tbody');
    slow.slice(0, 10).forEach((s) => {
        const tr = el('tr');
        tr.appendChild(el('td', { text: fmtVal(s.method) }));
        tr.appendChild(el('td', { text: fmtVal(s.path) }));
        tr.appendChild(el('td', { text: fmtVal(s.slow) }));
        tr.appendChild(el('td', { text: fmtVal(s.avg_ms) }));
        tr.appendChild(el('td', { text: fmtVal(s.max_ms) }));
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
}

function buildTable(headers, rows) {
    const wrap = el('div', { className: 'table-container' });
    const table = el('table');
    const headRow = el('tr');
    headers.forEach((h) => headRow.appendChild(el('th', { text: h })));
    const thead = el('thead');
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach((cells) => {
        const tr = el('tr');
        cells.forEach((c) => {
            if (c instanceof Node) {
                const td = el('td');
                td.appendChild(c);
                tr.appendChild(td);
            } else {
                tr.appendChild(el('td', { text: fmtVal(c) }));
            }
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
}

function addSection(container, title, content) {
    const sec = el('div', { className: 'card-section' });
    sec.appendChild(el('h3', { text: title }));
    sec.appendChild(content);
    container.appendChild(sec);
}

function fmtUptime(s) {
    if (s == null) return null;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : (h ? `${h}h ${m}m` : `${m}m`);
}

function fmtRetention(r) {
    if (!r || typeof r !== 'object') return null;
    return Object.entries(r).map(([k, v]) => `${k}: ${v && typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
}

function renderVersions(ins) {
    const rows = (ins.versions || []).map((v) => {
        const badge = el('span', { className: v.outdated ? 'badge outdated' : 'badge up', text: v.outdated ? 'outdated' : 'latest' });
        return [v.ext_version, v.users, v.errors, badge];
    });
    return buildTable(['Version', 'Users', `Errors (${fmtVal(ins.days)}d)`, ''], rows);
}

// Bars share one scale per card so days compare; the counts stay as text beside them.
function renderTrend(trend) {
    const max = Math.max(1, ...trend.map((d) => Math.max(d.errors || 0, d.client_errors || 0)));
    const bar = (cls, n) => {
        const cell = el('span', { className: 'trend-cell' });
        const b = el('span', { className: `trend-bar ${cls}` });
        b.style.width = `${Math.round(((n || 0) / max) * 100)}px`;
        cell.appendChild(b);
        cell.appendChild(document.createTextNode(` ${n || 0}`));
        return cell;
    };
    return buildTable(['Day', '5xx', '4xx'], trend.map((d) => [
        d.day ? new Date(d.day).toLocaleDateString() : '—', bar('err', d.errors), bar('warn', d.client_errors)
    ]));
}

function renderInsights(container, ins) {
    if (!ins) return;
    if (Array.isArray(ins.versions) && ins.versions.length) {
        addSection(container, `Extension versions (latest ${fmtVal(ins.latest_version)})`, renderVersions(ins));
    }
    if (Array.isArray(ins.trend) && ins.trend.length) {
        addSection(container, `Errors per day (${fmtVal(ins.days)}d)`, renderTrend(ins.trend));
    }
    if (Array.isArray(ins.top_failing) && ins.top_failing.length) {
        addSection(container, 'Top failing endpoints', buildTable(
            ['Method', 'Path', 'Failures', '5xx'],
            ins.top_failing.map((f) => [f.method, f.path, f.failures, f.server_errors])
        ));
    }
}

function renderCard(container, platform, side) {
    clear(container);
    const label = platform === 'tiktok' ? 'TikTok' : 'Instagram';
    const h2 = el('h2');
    h2.appendChild(document.createTextNode(label + ' '));
    const badge = el('span', {
        className: `badge ${side && side.up ? 'up' : 'down'}`,
        text: side && side.up ? 'Up' : 'Down'
    });
    h2.appendChild(badge);
    container.appendChild(h2);

    if (!side || side.up === false) {
        container.appendChild(el('p', { text: (side && side.error) || 'No data' }));
        return;
    }

    const grid = el('dl', { className: 'field-grid' });
    const addField = (label, value) => {
        grid.appendChild(el('dt', { text: label }));
        grid.appendChild(el('dd', { text: fmtVal(value) }));
    };

    addField('Latency', side.latency_ms != null ? `${side.latency_ms} ms` : null);
    addField('Version', side.version);
    if (side.db) {
        addField('DB', side.db.ok ? `ok (${fmtVal(side.db.latency_ms)} ms)` : (side.db.error || 'error'));
    } else {
        addField('DB', null);
    }
    addField('Migrations', side.migrations_ok === null || side.migrations_ok === undefined ? null : (side.migrations_ok ? 'ok' : 'out of date'));
    if (side.last_15m) {
        addField('Failed logins (15m)', side.last_15m.failed_logins);
        addField('5xx (15m)', side.last_15m.server_errors);
    } else {
        addField('Failed logins (15m)', null);
        addField('5xx (15m)', null);
    }
    if (side.users) {
        addField('Users total', side.users.total);
        if (side.users.by_status) {
            for (const [status, count] of Object.entries(side.users.by_status)) {
                addField(`Users: ${status}`, count);
            }
        }
    } else {
        addField('Users total', null);
    }
    const hd = side.health_details;
    if (hd) {
        addField('Uptime', fmtUptime(hd.uptime_s));
        addField('Node', hd.node);
        addField('Retention', fmtRetention(hd.retention));
        if (hd.events) {
            addField('Event rows', hd.events.total);
            addField('Oldest event', hd.events.oldest ? new Date(hd.events.oldest).toLocaleString() : null);
        }
    }
    container.appendChild(grid);

    renderInsights(container, side.insights);
    renderSlowTable(container, side.slow);
}

function renderOverview(data) {
    renderAlerts(data);
    renderCard(cardTiktok, 'tiktok', data.tiktok);
    renderCard(cardInstagram, 'instagram', data.instagram);
    if (data.generated_at) {
        const d = new Date(data.generated_at);
        updatedStamp.textContent = `Updated ${d.toLocaleTimeString()}`;
    } else {
        updatedStamp.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    }
}

async function loadOverview() {
    if (overviewInFlight) return;
    overviewInFlight = true;
    try {
        const res = await api('/api/overview');
        if (!res.ok) return;
        const data = await res.json();
        renderOverview(data);
    } catch (err) {
        // 401 already handled by api(); other errors: leave stale data visible
    } finally {
        overviewInFlight = false;
    }
}

// ---- Events ----

function statusClass(status) {
    if (status >= 500) return 'status-err';
    if (status >= 400) return 'status-warn';
    return 'status-ok';
}

function filterEventsByIp(platform, ip) {
    platformFilter.value = platform;
    resultFilter.value = 'any';
    actionFilter.value = 'all';
    userFilter.value = '';
    qFilter.value = ip;
    loadEvents();
    eventsBody.closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderEventStats(stats) {
    if (!stats) {
        eventsStats.textContent = '';
        return;
    }
    eventsStats.textContent = `All time ${fmtVal(stats.all_time)} · today ${fmtVal(stats.today)} · matching ${fmtVal(stats.matching)} · failed ${fmtVal(stats.failed)} · distinct users ${fmtVal(stats.distinct_users)}`;
}

function renderEvents(data) {
    clear(eventsBody);
    clear(eventsErrors);
    renderEventStats(data.stats);

    if (data.errors && Object.keys(data.errors).length) {
        const lines = Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`);
        const warn = el('div', { className: 'alert-row warning' });
        warn.appendChild(el('span', { text: lines.join(' | ') }));
        eventsErrors.appendChild(warn);
    }

    const events = Array.isArray(data.events) ? data.events : [];
    for (const ev of events) {
        const tr = el('tr');
        tr.dataset.key = `${ev.platform}:${ev.id}`;

        const time = ev.created_at ? new Date(ev.created_at).toLocaleString() : '—';
        tr.appendChild(el('td', { text: time }));

        const platTd = el('td');
        platTd.appendChild(el('span', {
            className: `badge platform-${ev.platform}`,
            text: ev.platform === 'tiktok' ? 'TikTok' : (ev.platform === 'instagram' ? 'Instagram' : fmtVal(ev.platform))
        }));
        tr.appendChild(platTd);

        const statusTd = el('td');
        statusTd.appendChild(el('span', {
            className: `badge ${statusClass(ev.status)}`,
            text: fmtVal(ev.status)
        }));
        tr.appendChild(statusTd);

        tr.appendChild(el('td', { text: `${fmtVal(ev.method)} ${fmtVal(ev.path)}` }));
        tr.appendChild(el('td', { text: fmtVal(ev.email) }));
        const reason = [ev.reason || ev.error, ev.server_error].filter(Boolean).join(' · ');
        tr.appendChild(el('td', { text: fmtVal(reason) }));
        tr.appendChild(el('td', { text: fmtVal(ev.ip) }));
        const agentTd = el('td', { className: 'cell-clip', text: fmtVal(ev.user_agent) });
        if (ev.user_agent) agentTd.title = ev.user_agent;
        tr.appendChild(agentTd);
        tr.appendChild(el('td', { text: fmtVal(ev.ext_version) }));
        tr.appendChild(el('td', { text: fmtVal(ev.duration_ms) }));

        eventsBody.appendChild(tr);
    }
}

async function loadEvents() {
    if (eventsInFlight) {
        eventsReload = true;
        return;
    }
    eventsInFlight = true;
    try {
        const platform = platformFilter.value;
        const params = new URLSearchParams({ platform, limit: '100' });
        if (resultFilter.value !== 'any') params.set('result', resultFilter.value);
        if (actionFilter.value !== 'all') params.set('action', actionFilter.value);
        if (userFilter.value.trim()) params.set('user', userFilter.value.trim());
        if (qFilter.value.trim()) params.set('q', qFilter.value.trim());
        const res = await api(`/api/events?${params}`);
        if (!res.ok) {
            clear(eventsErrors);
            const warn = el('div', { className: 'alert-row warning' });
            warn.appendChild(el('span', { text: 'Events not loaded' + (res.status === 400 ? ': check the filters' : '') }));
            eventsErrors.appendChild(warn);
            return;
        }
        const data = await res.json();
        renderEvents(data);
    } catch (err) {
        // handled above
    } finally {
        eventsInFlight = false;
        if (eventsReload) {
            eventsReload = false;
            loadEvents();
        }
    }
}

// ---- Users ----

let usersData = [];
let usersLoadedPlatform = 'tiktok';

function when(v) {
    return v ? new Date(v).toLocaleString() : null;
}

function renderUsers() {
    clear(usersBody);
    const needle = usersSearch.value.trim().toLowerCase();
    const status = usersStatus.value;
    const key = usersSort.value;
    const rows = usersData
        .filter((u) => (!needle || String(u.email || '').toLowerCase().includes(needle)) && (!status || u.status === status))
        .sort((a, b) => {
            if (key === 'email') return String(a.email).localeCompare(String(b.email));
            if (key === 'ghost_sessions') return (b.ghost_sessions || 0) - (a.ghost_sessions || 0);
            return Date.parse(b[key] || 0) - Date.parse(a[key] || 0);
        });
    for (const u of rows) {
        const tr = el('tr');
        const emailTd = el('td');
        const openBtn = el('button', { className: 'ip-link uo-open', text: fmtVal(u.email), attrs: { type: 'button', title: 'Open user overview' } });
        openBtn.style.marginLeft = '0';
        openBtn.addEventListener('click', () => { uo.metric = null; loadUserOverview(usersLoadedPlatform, u.id, u.email, null); });
        emailTd.appendChild(openBtn);
        tr.appendChild(emailTd);
        const st = el('td');
        st.appendChild(el('span', { className: `badge ${u.status === 'active' ? 'up' : 'down'}`, text: fmtVal(u.status) }));
        tr.appendChild(st);
        tr.appendChild(el('td', { text: fmtVal(u.plan) }));
        tr.appendChild(el('td', { text: `${fmtVal(u.active_sessions)} / ${fmtVal(u.max_devices)}` }));
        tr.appendChild(el('td', { text: fmtVal(u.ghost_sessions) }));
        tr.appendChild(el('td', { text: fmtVal(when(u.last_seen)) }));
        tr.appendChild(el('td', { text: fmtVal(when(u.last_login)) }));
        tr.appendChild(el('td', { text: fmtVal(u.ext_version) }));
        const issue = u.last_issue ? `${fmtVal(u.last_issue.status)} ${fmtVal(u.last_issue.path)} ${u.last_issue.reason || u.last_issue.error || ''}`.trim() : null;
        const issueTd = el('td', { className: 'cell-clip', text: fmtVal(issue) });
        if (issue) issueTd.title = `${issue} (${when(u.last_issue.created_at) || ''})`;
        tr.appendChild(issueTd);
        tr.appendChild(el('td', { text: u.reset_link ? `${u.reset_link.status}${u.reset_link.expires_at ? ' until ' + when(u.reset_link.expires_at) : ''}` : '—' }));
        usersBody.appendChild(tr);
    }
    usersNote.textContent = `${rows.length} of ${usersData.length} users`;
}

async function loadUsers() {
    usersNote.textContent = 'Loading...';
    try {
        const res = await api(`/api/users?platform=${encodeURIComponent(usersPlatform.value)}`);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            usersData = [];
            clear(usersBody);
            usersNote.textContent = `Could not load users: ${data.error || 'HTTP ' + res.status}`;
            return;
        }
        usersData = (await res.json()).users || [];
        usersLoadedPlatform = usersPlatform.value;
        uoUserLists[usersLoadedPlatform] = usersData;
        const statuses = [...new Set(usersData.map((u) => u.status).filter(Boolean))].sort();
        clear(usersStatus);
        const any = el('option', { text: 'Any status' });
        any.value = '';
        usersStatus.appendChild(any);
        statuses.forEach((s) => {
            const o = el('option', { text: s });
            o.value = s;
            usersStatus.appendChild(o);
        });
        renderUsers();
    } catch (err) {
        usersNote.textContent = 'Could not reach server';
    }
}

document.getElementById('users-load').addEventListener('click', loadUsers);
usersPlatform.addEventListener('change', loadUsers);
usersSearch.addEventListener('input', renderUsers);
usersStatus.addEventListener('change', renderUsers);
usersSort.addEventListener('change', renderUsers);

// ---- User overview ----

const uoPanel = document.getElementById('uo-panel');
const uoNote = document.getElementById('uo-note');
const uoHead = document.getElementById('uo-head');
const uoWarnings = document.getElementById('uo-warnings');
const uoTiles = document.getElementById('uo-tiles');
const uoDetail = document.getElementById('uo-detail');
const uoTabs = document.getElementById('uo-tabs');
const uoTabPanel = document.getElementById('uo-tabpanel');
const uoProject = document.getElementById('uo-project');
const UO_ROW_CAP = 500;
const UO_TABS = [['posts', 'Posts'], ['creators', 'Creators'], ['save_history', 'Save history'], ['sessions', 'Sessions / devices']];
const UO_POST_COLUMNS = [['shortcode', 'Post'], ['owner', 'Owner'], ['likes', 'Likes', true], ['comments', 'Comments', true]];
const UO_CREATOR_COLUMNS = [
    ['username', 'Creator'], ['role', 'Role'], ['follower_count', 'Followers', true], ['scraped_at', 'Scraped at'],
    ['observed_at', 'Observed at'], ['posts', 'Posts', true], ['adds', 'Adds', true],
];
let uo = { platform: null, id: null, email: '', data: null, metric: null, tab: 'posts', latest: 0 };
const uoUserLists = {}; // platform -> users, to find the same email on the other backend

function uoCell(key, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return v.toLocaleString();
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'object') return JSON.stringify(v);
    if (/(^at|_at)$/.test(key) && !isNaN(Date.parse(v))) return new Date(v).toLocaleString();
    return String(v);
}

// columns: [{key,label,numeric}]; rows: objects; total: object or null.
function uoTable(columns, rows, total) {
    const wrap = el('div', { className: 'table-container' });
    const table = el('table');
    const head = el('tr');
    columns.forEach((c) => head.appendChild(el('th', { text: c.label || c.key, className: c.numeric ? 'num' : '' })));
    table.appendChild(el('thead')).appendChild(head);
    const body = el('tbody');
    rows.slice(0, UO_ROW_CAP).forEach((r) => {
        const tr = el('tr');
        columns.forEach((c) => {
            const v = r ? r[c.key] : undefined;
            const td = el('td', { text: uoCell(c.key, v), className: c.numeric ? 'num' : '' });
            if (v === null || v === undefined) td.title = 'No value';
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
    if (!rows.length) {
        const tr = el('tr');
        tr.appendChild(el('td', { text: 'No rows', attrs: { colspan: String(columns.length || 1) } }));
        body.appendChild(tr);
    }
    table.appendChild(body);
    if (total && typeof total === 'object') {
        const tr = el('tr', { className: 'uo-total' });
        columns.forEach((c, i) => {
            const v = total[c.key];
            tr.appendChild(el('td', { text: v === undefined && i === 0 ? 'Total' : uoCell(c.key, v), className: c.numeric ? 'num' : '' }));
        });
        table.appendChild(el('tfoot')).appendChild(tr);
    }
    wrap.appendChild(table);
    if (rows.length > UO_ROW_CAP) {
        const f = el('div');
        f.appendChild(wrap);
        f.appendChild(el('p', { className: 'checks-note', text: `Showing the first ${UO_ROW_CAP} of ${rows.length} rows.` }));
        return f;
    }
    return wrap;
}

// Known columns first (only if any row has them), then other fields, so extra platform fields still show.
function uoAutoColumns(rows, known) {
    const sample = rows.slice(0, 50);
    const cols = known.filter(([k]) => sample.some((r) => r && r[k] !== undefined)).map(([key, label, numeric]) => ({ key, label, numeric: !!numeric }));
    const seen = new Set(cols.map((c) => c.key));
    sample.forEach((r) => Object.keys(r || {}).forEach((k) => {
        if (!seen.has(k) && cols.length < 14) {
            seen.add(k);
            cols.push({ key: k, label: k.replace(/_/g, ' '), numeric: typeof r[k] === 'number' });
        }
    }));
    return cols;
}

function uoSummary(d) {
    clear(uoHead);
    const u = d.user || {};
    const items = [
        ['Email', u.email], ['Status', u.status], ['Plan', u.plan],
        ['Plan expires', when(u.plan_expires_at)], ['Trial ends', when(u.trial_ends_at)],
        ['Devices', `${fmtVal(u.active_sessions)} / ${fmtVal(u.max_devices)}`],
        ['Last login', when(u.last_login)], ['Created', when(u.created_at)],
    ];
    items.forEach(([label, value]) => {
        const box = el('div', { className: 'uo-fact' });
        box.appendChild(el('span', { className: 'uo-fact-label', text: label }));
        if (label === 'Status') {
            box.appendChild(el('span', { className: `badge ${value === 'active' ? 'up' : 'down'}`, text: fmtVal(value) }));
        } else {
            box.appendChild(el('span', { text: fmtVal(value) }));
        }
        uoHead.appendChild(box);
    });
}

function uoWarningsRender(list) {
    clear(uoWarnings);
    (Array.isArray(list) ? list : []).forEach((w) => {
        const sev = ['bad', 'warn', 'info'].includes(w && w.severity) ? w.severity : 'info';
        const row = el('div', { className: `uo-warning ${sev}` });
        row.appendChild(el('span', { className: 'uo-pill', text: sev }));
        row.appendChild(el('span', { text: fmtVal(w && w.message) }));
        if (w && w.code) row.appendChild(el('code', { text: String(w.code) }));
        uoWarnings.appendChild(row);
    });
}

function uoTilesRender(d) {
    clear(uoTiles);
    const add = (key, label, value, extra) => {
        const b = el('button', { className: 'uo-tile' + (uo.metric === key ? ' active' : ''), attrs: { type: 'button' } });
        b.appendChild(el('span', { className: 'uo-tile-label', text: label }));
        b.appendChild(el('span', { className: 'uo-tile-value', text: typeof value === 'number' ? value.toLocaleString() : fmtVal(value) }));
        if (extra) b.classList.add(extra);
        b.addEventListener('click', () => { uo.metric = key; uoTilesRender(d); uoDetailRender(d); });
        uoTiles.appendChild(b);
    };
    (d.metrics || []).forEach((m) => add(`m:${m.key}`, m.label || m.key, m.value));
    add('browser', "On the user's screen: ?", (d.browser_only || []).length, 'browser');
}

function uoDetailRender(d) {
    clear(uoDetail);
    if (uo.metric === 'browser') {
        uoDetail.appendChild(el('h3', { text: "On the user's screen" }));
        uoDetail.appendChild(el('p', { className: 'uo-explain', text: "The user's browser computes these numbers itself, so the server cannot see or check them." }));
        const items = d.browser_only || [];
        if (!items.length) uoDetail.appendChild(el('p', { className: 'checks-note', text: 'Nothing listed.' }));
        const ul = el('ul', { className: 'uo-list' });
        items.forEach((s) => ul.appendChild(el('li', { text: String(s) })));
        uoDetail.appendChild(ul);
        return;
    }
    const m = (d.metrics || []).find((x) => `m:${x.key}` === uo.metric);
    if (!m) {
        uoDetail.appendChild(el('p', { className: 'checks-note', text: 'Click a number on the left to see how it was built.' }));
        return;
    }
    const bd = m.breakdown && d.breakdowns ? d.breakdowns[m.breakdown] : null;
    uoDetail.appendChild(el('h3', { text: m.label || m.key }));
    uoDetail.appendChild(el('div', { className: 'uo-big', text: typeof m.value === 'number' ? m.value.toLocaleString() : fmtVal(m.value) }));
    const section = (title, node) => {
        uoDetail.appendChild(el('h4', { text: title }));
        uoDetail.appendChild(node);
    };
    if (bd && bd.explain) section('How it was built', el('p', { className: 'uo-explain', text: String(bd.explain) }));
    if (m.formula) section('Formula', el('code', { className: 'uo-formula', text: String(m.formula) }));
    if (Array.isArray(m.inputs) && m.inputs.length) {
        const ul = el('ul', { className: 'uo-list' });
        m.inputs.forEach((s) => ul.appendChild(el('li', { text: String(s) })));
        section('Inputs', ul);
    }
    if (bd) {
        const cols = Array.isArray(bd.columns) && bd.columns.length ? bd.columns : uoAutoColumns(bd.rows || [], []);
        section(bd.title || 'Rows behind this number', uoTable(cols, bd.rows || [], bd.total));
    } else if (m.breakdown) {
        uoDetail.appendChild(el('p', { className: 'checks-note', text: 'The backend did not send the rows for this number.' }));
    }
}

function uoTabsRender(d) {
    clear(uoTabs);
    UO_TABS.forEach(([key, label]) => {
        const count = Array.isArray(d[key]) ? d[key].length : 0;
        const b = el('button', { className: 'uo-tab' + (uo.tab === key ? ' active' : ''), text: `${label} (${count})`, attrs: { type: 'button', role: 'tab' } });
        b.addEventListener('click', () => { uo.tab = key; uoTabsRender(d); });
        uoTabs.appendChild(b);
    });
    clear(uoTabPanel);
    const rows = Array.isArray(d[uo.tab]) ? d[uo.tab] : [];
    let cols;
    if (uo.tab === 'creators') {
        cols = UO_CREATOR_COLUMNS.map(([key, label, numeric]) => ({ key, label, numeric: !!numeric }));
    } else if (uo.tab === 'save_history') {
        cols = [{ key: 'at', label: 'When' }, { key: 'action', label: 'Action' }, { key: 'detail', label: 'Detail' }];
    } else {
        cols = uoAutoColumns(rows, uo.tab === 'posts' ? UO_POST_COLUMNS : []);
    }
    uoTabPanel.appendChild(uoTable(cols, rows, null));
}

function uoRender(d) {
    uoSummary(d);
    uoWarningsRender(d.warnings);
    clear(uoProject);
    const projects = Array.isArray(d.projects) ? d.projects : [];
    if (!projects.length) uoProject.appendChild(el('option', { text: 'No projects' }));
    projects.forEach((p) => {
        const o = el('option', { text: `${fmtVal(p.name)} (${fmtVal(p.posts)} posts, ${fmtVal(p.profiles)} profiles)` });
        o.value = p.id;
        if (p.id === d.selected_project_id) o.selected = true;
        uoProject.appendChild(o);
    });
    uoProject.disabled = !projects.length;
    if (!uo.metric || (uo.metric !== 'browser' && !(d.metrics || []).some((m) => `m:${m.key}` === uo.metric))) {
        uo.metric = d.metrics && d.metrics.length ? `m:${d.metrics[0].key}` : (d.browser_only && d.browser_only.length ? 'browser' : null);
    }
    uoTilesRender(d);
    uoDetailRender(d);
    uoTabsRender(d);
}

function uoClearBody() {
    [uoHead, uoWarnings, uoTiles, uoDetail, uoTabs, uoTabPanel, uoProject].forEach(clear);
}

function uoMarkPlatform(platform) {
    document.querySelectorAll('.uo-seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.platform === platform));
}

async function loadUserOverview(platform, id, email, projectId) {
    const mine = ++uo.latest;
    uo.platform = platform;
    uo.id = id;
    uo.email = email;
    uoPanel.classList.remove('hidden');
    uoMarkPlatform(platform);
    uoClearBody();
    uoNote.textContent = `Loading ${email || id} on ${platformName(platform)}...`;
    uoPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
        const params = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
        const res = await api(`/api/users/${encodeURIComponent(platform)}/${encodeURIComponent(id)}/overview${params}`);
        const data = await res.json().catch(() => ({}));
        if (mine !== uo.latest) return;
        if (!res.ok) {
            uoNote.textContent = `Could not load the overview: ${data.error || 'HTTP ' + res.status}`;
            return;
        }
        uo.data = data;
        uoNote.textContent = `${fmtVal((data.user || {}).email || email)} on ${platformName(platform)}`;
        uoRender(data);
    } catch (err) {
        if (mine === uo.latest && err.message !== 'unauthorized') uoNote.textContent = 'Could not reach server';
    }
}

// The same person has a separate id (and account) on each backend, so the switch looks the email up there.
async function switchOverviewPlatform(platform) {
    if (platform === uo.platform) return;
    const mine = ++uo.latest;
    uoClearBody();
    uoNote.textContent = `Looking for ${uo.email} on ${platformName(platform)}...`;
    try {
        if (!uoUserLists[platform]) {
            const res = await api(`/api/users?platform=${encodeURIComponent(platform)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            uoUserLists[platform] = data.users || [];
        }
        if (mine !== uo.latest) return;
        const u = uoUserLists[platform].find((x) => String(x.email || '').toLowerCase() === String(uo.email).toLowerCase());
        if (!u) {
            uoNote.textContent = `${uo.email} has no account on ${platformName(platform)}.`;
            uo.platform = platform;
            uoMarkPlatform(platform);
            return;
        }
        uo.metric = null;
        loadUserOverview(platform, u.id, uo.email, null);
    } catch (err) {
        if (mine === uo.latest && err.message !== 'unauthorized') uoNote.textContent = `Could not look up the user: ${err.message}`;
    }
}

document.querySelectorAll('.uo-seg-btn').forEach((b) => b.addEventListener('click', () => switchOverviewPlatform(b.dataset.platform)));
uoProject.addEventListener('change', () => { if (uoProject.value) loadUserOverview(uo.platform, uo.id, uo.email, uoProject.value); });
function uoClose() {
    uo.latest++;
    uoPanel.classList.add('hidden');
    uoClearBody();
    uoNote.textContent = '';
    for (const k of Object.keys(uoUserLists)) delete uoUserLists[k];
}
document.getElementById('uo-close').addEventListener('click', uoClose);

// ---- Panels that load when opened ----

const platformName = (p) => (p === 'tiktok' ? 'TikTok' : (p === 'instagram' ? 'Instagram' : fmtVal(p)));

function platformBadge(p) {
    return el('span', { className: `badge platform-${p}`, text: platformName(p) });
}

function warnLines(box, lines) {
    lines.forEach((line) => box.appendChild(el('p', { className: 'note-warning', text: line })));
}

function errorLines(errors) {
    return Object.entries(errors || {}).map(([p, msg]) => `${platformName(p)}: ${msg}`);
}

// A later request wins, so a slow answer to an old filter can't overwrite a newer one.
function panelLoader(note, box, url, render) {
    let latest = 0;
    return async () => {
        const mine = ++latest;
        note.textContent = 'Loading...';
        try {
            const res = await api(url());
            const data = await res.json().catch(() => ({}));
            if (mine !== latest) return;
            clear(box);
            if (!res.ok) {
                note.textContent = `Could not load: ${data.error || 'HTTP ' + res.status}`;
                return;
            }
            render(data);
        } catch (err) {
            if (mine === latest && err.message !== 'unauthorized') note.textContent = 'Could not reach server';
        }
    };
}

function wirePanel(id, box, load) {
    const panel = document.getElementById(id);
    panel.addEventListener('toggle', () => {
        if (panel.open) load();
        else clear(box);
    });
}

// Usage

const usagePlatform = document.getElementById('usage-platform');
const usageDays = document.getElementById('usage-days');
const usageSearch = document.getElementById('usage-search');
const usageSort = document.getElementById('usage-sort');
const usageNote = document.getElementById('usage-note');
const usageBox = document.getElementById('usage-box');
let usageData = null;

function renderUsage() {
    clear(usageBox);
    if (!usageData) return;
    const d = usageData;
    const needle = usageSearch.value.trim().toLowerCase();
    const key = usageSort.value;
    const rows = (d.users || [])
        .filter((u) => !needle || String(u.email || '').toLowerCase().includes(needle))
        .sort((a, b) => (key === 'email' ? String(a.email).localeCompare(String(b.email)) : (b[key] || 0) - (a[key] || 0)));
    usageNote.textContent = `${rows.length} of ${(d.users || []).length} users. Sessions, jobs, API calls and comments cover the last ${fmtVal(d.days)} days; saved posts and projects are all-time. Sizes are row counts, not bytes. A job is stuck after ${fmtVal(d.stuck_after_minutes)} minutes running.`;

    if ((d.top_users || []).length) {
        addSection(usageBox, 'Top users', buildTable(
            ['Email', 'Score (jobs + API calls)', 'Jobs', 'API calls'],
            d.top_users.map((u) => [u.email, u.usage_score, u.jobs_total, u.api_calls])
        ));
    }
    const stuck = (d.users || []).filter((u) => u.jobs_stuck > 0);
    if (stuck.length) {
        addSection(usageBox, 'Users with stuck jobs', buildTable(['Email', 'Stuck jobs'], stuck.map((u) => [u.email, u.jobs_stuck])));
    }
    if ((d.failed_jobs || []).length) {
        addSection(usageBox, `Failed jobs (newest ${d.failed_jobs.length})`, buildTable(
            ['Time', 'Email', 'Post', 'Retries', 'Error'],
            d.failed_jobs.map((j) => {
                const err = el('span', { className: 'cell-clip clip-inline', text: fmtVal(j.error_message) });
                if (j.error_message) err.title = j.error_message;
                return [when(j.created_at), j.email, j.post_shortcode, `${fmtVal(j.retry_count)} / ${fmtVal(j.max_retries)}`, err];
            })
        ));
    }
    const isTiktok = d.platform === 'tiktok';
    addSection(usageBox, 'Per user', buildTable(
        ['Email', 'Plan', 'Status', 'Sessions', 'Jobs', 'Failed', 'Stuck', 'API calls', 'Comments', 'Saved posts', 'Projects'].concat(isTiktok ? ['Videos', 'Keywords', 'Video comments'] : []),
        rows.map((u) => [
            u.email, u.plan, u.status, u.sessions, u.jobs_total, u.jobs_failed, u.jobs_stuck, u.api_calls, u.comments_scraped, u.saved_posts, u.projects,
        ].concat(isTiktok ? [u.videos, u.keywords, u.tiktok_comments] : []))
    ));
}

const loadUsage = panelLoader(usageNote, usageBox,
    () => `/api/usage?${new URLSearchParams({ platform: usagePlatform.value, days: usageDays.value })}`,
    (data) => {
        usageData = data;
        renderUsage();
    });
// Forgets the old rows first, so typing in the search box after a failed load can't bring them back.
function reloadUsage() {
    usageData = null;
    loadUsage();
}
wirePanel('usage-panel', usageBox, reloadUsage);
usagePlatform.addEventListener('change', reloadUsage);
usageDays.addEventListener('change', reloadUsage);
usageSearch.addEventListener('input', renderUsage);
usageSort.addEventListener('change', renderUsage);

// Expiring plans

const expiringDays = document.getElementById('expiring-days');
const expiringNote = document.getElementById('expiring-note');
const expiringBox = document.getElementById('expiring-box');

const loadExpiring = panelLoader(expiringNote, expiringBox,
    () => `/api/expiring?${new URLSearchParams({ days: expiringDays.value })}`,
    (d) => {
        const users = d.users || [];
        expiringNote.textContent = `${users.length} lapsed or lapsing within ${fmtVal(d.days)} days. This is information only: an expired plan does not block login.`;
        warnLines(expiringBox, errorLines(d.errors));
        (d.columns_missing || []).forEach((p) => warnLines(expiringBox, [`${platformName(p)}: expiry dates are not available until migration v8_plan_expiry.sql is applied.`]));
        if (!users.length) return;
        expiringBox.appendChild(buildTable(
            ['Platform', 'Email', 'Plan', 'Status', 'State', 'Lapses', 'Plan expires', 'Trial ends'],
            users.map((u) => [
                platformBadge(u.platform), u.email, u.plan, u.status,
                el('span', { className: u.lapsed ? 'badge down' : 'badge outdated', text: u.lapsed ? 'lapsed' : 'lapsing' }),
                when(u.lapses_at), when(u.plan_expires_at), when(u.trial_ends_at),
            ])
        ));
    });
wirePanel('expiring-panel', expiringBox, loadExpiring);
expiringDays.addEventListener('change', loadExpiring);

// Audit log

const auditPlatform = document.getElementById('audit-platform');
const auditAction = document.getElementById('audit-action');
const auditSince = document.getElementById('audit-since');
const auditQ = document.getElementById('audit-q');
const auditNote = document.getElementById('audit-note');
const auditBox = document.getElementById('audit-box');

function fillAuditActions(actions) {
    const current = auditAction.value;
    clear(auditAction);
    const any = el('option', { text: 'Any action' });
    any.value = '';
    auditAction.appendChild(any);
    [...new Set(actions.concat(current ? [current] : []))].sort().forEach((a) => {
        const o = el('option', { text: a });
        o.value = a;
        auditAction.appendChild(o);
    });
    auditAction.value = current;
}

function auditUrl() {
    const params = new URLSearchParams({ platform: auditPlatform.value, limit: '200' });
    if (auditAction.value) params.set('action', auditAction.value);
    if (auditSince.value) params.set('since', new Date(Date.now() - Number(auditSince.value) * 86400000).toISOString());
    if (auditQ.value.trim()) params.set('q', auditQ.value.trim());
    return `/api/audit?${params}`;
}

const loadAudit = panelLoader(auditNote, auditBox, auditUrl, (d) => {
    const rows = d.rows || [];
    auditNote.textContent = `${rows.length} entries. The actor is the admin's email for account sign-ins, or shared-password when the shared password was used.`;
    fillAuditActions(d.actions || []);
    warnLines(auditBox, errorLines(d.errors));
    (d.table_missing || []).forEach((p) => warnLines(auditBox, [`${platformName(p)}: nothing is being recorded until migration v7_admin_audit.sql is applied.`]));
    if (!rows.length) return;
    auditBox.appendChild(buildTable(
        ['Time', 'Platform', 'Action', 'Actor', 'Target', 'IP', 'Detail'],
        rows.map((r) => {
            const text = r.detail && Object.keys(r.detail).length ? JSON.stringify(r.detail) : '';
            const detail = el('span', { className: 'cell-clip clip-inline', text: fmtVal(text) });
            if (text) detail.title = text;
            return [when(r.created_at), platformBadge(r.platform), r.action, r.actor, r.target_email, r.ip, detail];
        })
    ));
});
wirePanel('audit-panel', auditBox, loadAudit);
let auditTimer = null;
auditPlatform.addEventListener('change', loadAudit);
auditAction.addEventListener('change', loadAudit);
auditSince.addEventListener('change', loadAudit);
auditQ.addEventListener('input', () => {
    clearTimeout(auditTimer);
    auditTimer = setTimeout(loadAudit, 400);
});

// Blocked IPs

const blocksPanel = document.getElementById('blocks-panel');
const blocksNote = document.getElementById('blocks-note');
const blocksBox = document.getElementById('blocks-box');

async function unblockIp(platform, ip) {
    if (!confirm(`Unblock ${ip} on ${platformName(platform)}? Logins from it will be allowed again.`)) return;
    try {
        const res = await api(`/api/blocked-ips/${encodeURIComponent(platform)}/${encodeURIComponent(ip)}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            blocksNote.textContent = `Could not unblock ${ip}: ${data.error || 'HTTP ' + res.status}`;
            return;
        }
        loadBlocks();
    } catch (err) {
        if (err.message !== 'unauthorized') blocksNote.textContent = 'Could not reach server';
    }
}

const loadBlocks = panelLoader(blocksNote, blocksBox, () => '/api/blocked-ips', (d) => {
    const blocks = d.blocks || [];
    blocksNote.textContent = `${blocks.length} blocked. Blocks stop login only.`;
    warnLines(blocksBox, errorLines(d.errors));
    (d.table_missing || []).forEach((p) => warnLines(blocksBox, [`${platformName(p)}: IP blocking is not available until its migration is applied.`]));
    if (!blocks.length) return;
    blocksBox.appendChild(buildTable(
        ['Platform', 'IP', 'Reason', 'Blocked by', 'Since', 'Until', ''],
        blocks.map((b) => {
            const btn = el('button', { className: 'btn', text: 'Unblock' });
            btn.type = 'button';
            btn.addEventListener('click', () => unblockIp(b.platform, b.ip));
            return [platformBadge(b.platform), b.ip, b.reason, b.blocked_by, when(b.created_at), when(b.expires_at), btn];
        })
    ));
});
wirePanel('blocks-panel', blocksBox, loadBlocks);

// Block dialog. It sits outside the alerts strip, so the 30 s refresh can't replace it mid-decision.

const blockDialog = document.getElementById('block-dialog');
const blockHours = document.getElementById('block-hours');
const blockReason = document.getElementById('block-reason');
const blockSummary = document.getElementById('block-summary');
const blockError = document.getElementById('block-error');
const blockConfirm = document.getElementById('block-confirm');
let blockTarget = null;

function updateBlockSummary() {
    if (!blockTarget) return;
    const duration = blockHours.options[blockHours.selectedIndex].textContent;
    blockSummary.textContent = `Block ${blockTarget.ip} from logging in to ${platformName(blockTarget.platform)} for ${duration}?`;
}

function openBlockDialog(platform, ip) {
    blockTarget = { platform, ip };
    blockHours.value = '24';
    blockReason.value = '';
    blockError.classList.add('hidden');
    blockConfirm.disabled = false;
    updateBlockSummary();
    blockDialog.showModal();
}

blockHours.addEventListener('change', updateBlockSummary);
document.getElementById('block-cancel').addEventListener('click', () => blockDialog.close());

document.getElementById('block-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    blockError.classList.add('hidden');
    blockConfirm.disabled = true;
    try {
        const res = await api('/api/blocked-ips', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...blockTarget, hours: Number(blockHours.value), reason: blockReason.value.trim() || undefined }),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            blockError.textContent = data.error || `HTTP ${res.status}`;
            blockError.classList.remove('hidden');
            return;
        }
        blockDialog.close();
        if (blocksPanel.open) loadBlocks();
        else blocksPanel.open = true;
        blocksPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        if (err.message === 'unauthorized') {
            blockDialog.close();
            return;
        }
        blockError.textContent = 'Could not reach server';
        blockError.classList.remove('hidden');
    } finally {
        blockConfirm.disabled = false;
    }
});

// ---- Checks ----

async function runChecks() {
    checksPanel.classList.remove('hidden');
    clear(checksResult);
    checksResult.appendChild(el('p', { text: 'Running...' }));
    try {
        const res = await api('/api/check', { method: 'POST' });
        if (res.status === 429) {
            const data = await res.json();
            clear(checksResult);
            checksResult.appendChild(el('p', { text: `Checks ran recently — try again in ${fmtVal(data.retry_after_s)}s` }));
            return;
        }
        if (!res.ok) {
            clear(checksResult);
            checksResult.appendChild(el('p', { text: 'Check failed to run' }));
            return;
        }
        const data = await res.json();
        clear(checksResult);
        const wrap = el('div', { className: 'table-container' });
        const table = el('table');
        const thead = el('thead');
        const headRow = el('tr');
        ['Platform', 'Check', 'Status', 'ms', 'Detail'].forEach((h) => headRow.appendChild(el('th', { text: h })));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el('tbody');
        (data.checks || []).forEach((c) => {
            const tr = el('tr', { className: `check-row ${c.ok ? 'pass' : 'fail'}` });
            tr.appendChild(el('td', { text: fmtVal(c.platform) }));
            tr.appendChild(el('td', { text: fmtVal(c.name) }));
            tr.appendChild(el('td', { text: `${c.ok ? 'pass' : 'fail'} (${fmtVal(c.status)})` }));
            tr.appendChild(el('td', { text: fmtVal(c.ms) }));
            tr.appendChild(el('td', { text: fmtVal(c.detail) }));
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        checksResult.appendChild(wrap);
        checksResult.appendChild(el('p', { text: `Overall: ${data.ok ? 'pass' : 'fail'}`, className: data.ok ? 'check-row pass' : 'check-row fail' }));
    } catch (err) {
        // handled above (401) or network error; leave "Running..." replaced on next attempt
        clear(checksResult);
        checksResult.appendChild(el('p', { text: 'Could not reach server' }));
    }
}

// ---- Refresh orchestration ----

function refreshAll() {
    loadOverview();
    loadEvents();
    loadAdminLinks();
}

function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
        if (document.hidden) return;
        refreshAll();
    }, 30000);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

// Studio runs on the machine that serves this page, so link to this page's own host.
function wireStudioLinks() {
    document.getElementById('studio-tiktok').href = `http://${location.hostname}:5555`;
    document.getElementById('studio-insta').href = `http://${location.hostname}:5556`;
}

// Links to each backend's own admin page. Until /api/links answers (or when no address is configured)
// they point at this page's own host on the backend's port, like the Studio links.
function wireAdminLinks(links) {
    const l = links || {};
    document.getElementById('admin-tiktok').href = l.tiktok || `http://${location.hostname}:8443/admin.html`;
    document.getElementById('admin-insta').href = l.instagram || `http://${location.hostname}:8442/admin.html`;
}

async function loadAdminLinks() {
    try {
        const res = await api('/api/links');
        if (res.ok) wireAdminLinks(await res.json());
    } catch (e) { /* keep the fallback links */ }
}

// ---- Boot ----

wireStudioLinks();
wireAdminLinks();

if (password) {
    showApp();
    startAutoRefresh();
    refreshAll();
} else {
    showLogin();
}
