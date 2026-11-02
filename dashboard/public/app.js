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

let overviewInFlight = false;
let eventsInFlight = false;
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
    return res;
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

// ---- Overview ----

function severityClass(sev) {
    return sev === 'danger' ? 'danger' : 'warning';
}

function buildAlertRow(platform, alert) {
    const row = el('div', { className: `alert-row ${severityClass(alert.severity)}` });
    row.appendChild(el('span', { className: `badge platform-${platform}`, text: platform === 'tiktok' ? 'TikTok' : 'Instagram' }));
    row.appendChild(el('span', { text: alert.message || '' }));
    return row;
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
    slow.slice(0, 5).forEach((s) => {
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
    container.appendChild(grid);

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

function renderEvents(data) {
    clear(eventsBody);
    clear(eventsErrors);

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
        tr.appendChild(el('td', { text: fmtVal(ev.reason || ev.error) }));
        tr.appendChild(el('td', { text: fmtVal(ev.duration_ms) }));

        eventsBody.appendChild(tr);
    }
}

async function loadEvents() {
    if (eventsInFlight) return;
    eventsInFlight = true;
    try {
        const platform = platformFilter.value;
        const res = await api(`/api/events?platform=${encodeURIComponent(platform)}&limit=100`);
        if (!res.ok) return;
        const data = await res.json();
        renderEvents(data);
    } catch (err) {
        // handled above
    } finally {
        eventsInFlight = false;
    }
}

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

// ---- Boot ----

if (password) {
    showApp();
    startAutoRefresh();
    refreshAll();
} else {
    showLogin();
}
