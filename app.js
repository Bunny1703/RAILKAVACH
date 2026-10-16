/* ==========================================================================
   RAILKAVACH — app.js
   Authentication is handled by an HttpOnly cookie issued by the Netlify backend.
   ========================================================================== */

async function checkAuth() {
    try {
        const response = await fetch('/api/me', { credentials: 'include' });
        if (!response.ok) {
            window.location.href = 'login.html';
            return null;
        }
        const data = await response.json();
        return data.user;
    } catch (error) {
        console.error('Authentication check failed:', error);
        window.location.href = 'login.html';
        return null;
    }
}

/* ==========================================================================
   Toasts
   ========================================================================== */
const toastIcons = {
    success: 'fa-circle-check',
    error: 'fa-circle-exclamation',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
};

function showToast(message, type = 'info', duration = 3800) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas ${toastIcons[type] || toastIcons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

/* ==========================================================================
   Confirm dialog (replaces window.confirm)
   ========================================================================== */
function showConfirm(message, { title = 'Are you sure?', okLabel = 'Confirm' } = {}) {
    return new Promise(resolve => {
        const overlay = document.getElementById('confirm-overlay');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');

        titleEl.textContent = title;
        msgEl.textContent = message;
        okBtn.textContent = okLabel;
        overlay.classList.add('open');

        function cleanup(result) {
            overlay.classList.remove('open');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlay);
            resolve(result);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onOverlay(e) { if (e.target === overlay) cleanup(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlay);
    });
}

/* ==========================================================================
   App bootstrap
   ========================================================================== */
window.rkControllers = window.rkControllers || {};

async function loadLiveDashboard({ showSuccess = false } = {}) {
    const btn = document.getElementById('refresh-data-btn');
    btn?.classList.add('is-loading');
    try {
        const data = await api('/api/dashboard');
        window.rkData = data;

        const assets = data.assets || [];
        const inventory = data.inventory || [];
        const inspections = data.inspections || [];
        const notifications = data.notifications || [];
        const portals = data.portals || [];
        const auditLogs = data.auditLogs || [];

        // Each refresh step runs independently so one failing widget (e.g. a
        // chart re-render) can never roll back an already-successful
        // Inspections replaceData() or hide a save that just happened.
        const tryStep = (label, fn) => { try { fn(); } catch (error) { console.error(`[RAILKAVACH] Refresh step "${label}" failed:`, error); } };

        tryStep('Notifications', () => initNotifications(notifications));
        tryStep('Overview', () => initOverview(assets, notifications));
        tryStep('Charts', () => initCharts(inventory, inspections));
        tryStep('Portal status', () => initPortalStatus(portals));
        tryStep('Risk Center refresh', () => loadRiskCenter());
        tryStep('Activity Log', () => initAuditLog(auditLogs));

        tryStep('Asset table refresh', () => { if (window.rkControllers.asset?.replaceData) window.rkControllers.asset.replaceData(assets); });
        tryStep('Inventory table refresh', () => { if (window.rkControllers.inventory?.replaceData) window.rkControllers.inventory.replaceData(inventory); });
        tryStep('Inspection table refresh', () => { if (window.rkControllers.inspection?.replaceData) window.rkControllers.inspection.replaceData(inspections, assets); });

        const stamp = document.getElementById('live-updated-at');
        if (stamp) stamp.textContent = `Updated ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;

        if (showSuccess) showToast('Live data refreshed from Supabase', 'success', 2200);
        return data;
    } catch (error) {
        console.error('Live data refresh failed:', error);
        showToast(error.message || 'Could not load live dashboard data.', 'error', 5000);
        throw error;
    } finally {
        btn?.classList.remove('is-loading');
    }
}

document.addEventListener('DOMContentLoaded', async function () {
    const user = await checkAuth();
    if (!user) return;

    initUserMenu(user);
    initTheme();
    initSidebar();
    initDropdowns();
    initNavigation();
    initQuickActions();
    initGlobalSearch();

    // Each widget is initialized independently. Previously, a single throwing
    // widget (asset table, charts, portal status, etc.) inside one shared
    // try/catch would abort the whole bootstrap sequence BEFORE the
    // Inspections controller ever got created — so "New Inspection" silently
    // did nothing, even though the dashboard fetch itself had succeeded.
    // safeInit() guarantees every section gets its best-effort chance to
    // mount, and one broken widget can never take another one down with it.
    function safeInit(label, fn) {
        try {
            return fn();
        } catch (error) {
            console.error(`[RAILKAVACH] "${label}" failed to initialize:`, error);
            showToast(`${label} could not be loaded. Other sections still work.`, 'warning', 4500);
            return null;
        }
    }

    let data = {};
    try {
        data = await api('/api/dashboard');
        window.rkData = data;
    } catch (error) {
        console.error('Dashboard data load failed:', error);
        showToast(error.message || 'Could not load live dashboard data. Check your Supabase setup.', 'error', 6500);
        window.rkData = data = { assets: [], inventory: [], inspections: [], notifications: [], portals: [] };
    }

    safeInit('Notifications', () => initNotifications(data.notifications || []));
    safeInit('Overview', () => initOverview(data.assets || [], data.notifications || []));
    window.rkControllers.asset = safeInit('Asset table', () => initAssetTable(data.assets || []));
    window.rkControllers.inventory = safeInit('Inventory table', () => initInventoryTable(data.inventory || []));
    // Inspections is initialized independently of every other widget above —
    // if assets/inventory/charts/portals fail, Inspections still mounts and
    // (per openForm) will fetch /api/assets on its own if needed.
    window.rkControllers.inspection = safeInit('Inspection table', () => initInspectionTable(data.inspections || [], data.assets || []));
    safeInit('Charts', () => initCharts(data.inventory || [], data.inspections || []));
    safeInit('Portal status', () => initPortalStatus(data.portals || []));
    safeInit('Risk Center', () => loadRiskCenter());
    safeInit('QR generator', () => initQrGenerator());
    safeInit('Scanner', () => initScanner());
    safeInit('AI visual inspection', () => initAiInspection());
    safeInit('AI report', () => initAiReport());

    // Guarantee an Inspections controller always exists, even if the block
    // above somehow produced none, so the "New Inspection" button is never dead.
    if (!window.rkControllers.inspection) {
        window.rkControllers.inspection = safeInit('Inspection table (fallback)', () => initInspectionTable([], []));
    }

    document.getElementById('refresh-data-btn')?.addEventListener('click', () => loadLiveDashboard({showSuccess:true}));
    window.rkRefreshTimer = setInterval(() => loadLiveDashboard(), 30000);

    // Global fallback: the New Inspection button is delegated at document level,
    // so navigation/rendering issues can never leave the button without a handler.
    document.addEventListener('click', (event) => {
        const btn = event.target.closest('#inspection-add');
        if (!btn) return;
        event.preventDefault();
        if (window.rkControllers.inspection?.openForm) {
            window.rkControllers.inspection.openForm();
        } else {
            showToast('Inspection module is still loading. Please try again.', 'warning', 3500);
        }
    });
});

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    let data = {};
    let rawText = '';
    try { rawText = await response.text(); data = rawText ? JSON.parse(rawText) : {}; } catch (_) { data = {}; }
    if (!response.ok) throw new Error(data.message || rawText || `Request failed (${response.status})`);
    return data;
}

function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

function timeAgo(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

/* ==========================================================================
   Risk Center
   ========================================================================== */
async function loadRiskCenter({showSuccess=false}={}) {
    const refreshBtn=document.getElementById('risk-center-refresh');
    refreshBtn?.classList.add('is-loading');
    try {
        const res=await api('/api/analytics');
        const a=res.analytics||{};
        const counts=a.risk_counts||{};
        ['low','medium','high','critical'].forEach(k=>{const el=document.getElementById(`risk-${k}-count`);if(el)el.textContent=Number(counts[k.toUpperCase()]||0).toLocaleString();});
        const ml=document.getElementById('risk-ml-count'); if(ml) ml.textContent=Number(a.ml_assessed||0).toLocaleString();
        const list=document.getElementById('high-risk-list');
        if(list){
            const rows=Array.isArray(a.high_risk_assets)?a.high_risk_assets:[];
            list.innerHTML=rows.length?rows.slice(0,8).map(r=>{const cls=r.level==='CRITICAL'?'danger':'warning';return `<button class="risk-list-row" data-risk-asset="${escapeHtml(r.asset_id)}"><span><strong>${escapeHtml(r.asset_id)}</strong><small>${escapeHtml(r.type||'Asset')} · ${escapeHtml(r.location||'—')}</small></span><span class="status-badge ${cls}">${escapeHtml(r.level)} ${r.score==null?'':escapeHtml(String(r.score))+'%'}</span></button>`}).join(''):'<div class="empty-state"><i class="fas fa-circle-check"></i><p>No high-risk assets right now.</p></div>';
            list.querySelectorAll('[data-risk-asset]').forEach(btn=>btn.addEventListener('click',()=>openRiskAssetDetails(btn.dataset.riskAsset,a)));
        }
        const ctx=document.getElementById('riskCenterChart')?.getContext('2d');
        if(ctx&&window.Chart){
            if(window.rkRiskCenterChart)window.rkRiskCenterChart.destroy();
            window.rkRiskCenterChart=new Chart(ctx,{type:'doughnut',data:{labels:['LOW','MEDIUM','HIGH','CRITICAL'],datasets:[{data:[counts.LOW||0,counts.MEDIUM||0,counts.HIGH||0,counts.CRITICAL||0],backgroundColor:['#17974f','#d98c00','#e56b2f','#d9363e'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});
        }
        if(showSuccess)showToast('Risk Center updated from live data','success',2200);
        return a;
    }catch(error){console.error('Risk Center load failed:',error);showToast(error.message||'Could not load risk analytics','error',4500);throw error;}
    finally{refreshBtn?.classList.remove('is-loading');}
}
function openRiskAssetDetails(assetId, analytics){
    const row=(analytics?.risks||[]).find(r=>r.asset_id===assetId);
    if(!row)return;
    const isMl = Boolean(row.ml_available || row.method === 'tree-ensemble-ml-with-safety-guardrail' || row.method === 'random-forest-ml');
    const isFallback = Boolean(row.fallback_used || row.ml_unavailable_reason);
    const methodText = isMl ? 'Tree Ensemble ML' : isFallback ? `Baseline Fallback (ML unavailable)` : 'Baseline Rule Engine';
    const modal=document.createElement('div'); modal.className='modal is-visible';
    modal.innerHTML=`<div class="modal-content risk-detail-modal"><button class="close-modal" aria-label="Close">&times;</button><span class="eyebrow">LIVE RISK ASSESSMENT</span><h3>${escapeHtml(row.asset_id)}</h3><p>${escapeHtml(row.type||'Asset')} · ${escapeHtml(row.location||'—')}</p><div class="details-grid"><div><span>Risk level</span><strong>${escapeHtml(row.level)}</strong></div><div><span>Score</span><strong>${row.score==null?'—':escapeHtml(String(row.score))+'%'}</strong></div><div><span>Method</span><strong title="${escapeHtml(row.ml_unavailable_reason || '')}">${escapeHtml(methodText)}</strong></div><div><span>Inspections</span><strong>${Number(row.inspection_count||0)}</strong></div><div><span>Status</span><strong>${escapeHtml(row.status||'—')}</strong></div><div><span>Last inspection</span><strong>${escapeHtml(formatDate(row.latest_inspection))}</strong></div></div>${isFallback && row.ml_unavailable_reason ? `<div style="margin-top:10px;padding:8px 12px;background:rgba(245,158,11,0.08);border-left:3px solid var(--signal-amber,#f59e0b);border-radius:4px;font-size:11px;color:var(--text-muted,#64748b);"><strong>ML Fallback Reason:</strong> ${escapeHtml(row.ml_unavailable_reason)}</div>` : ''}<div class="details-actions"><button class="btn btn-secondary" id="risk-detail-inspections">View Inspections</button><button class="btn btn-primary" id="risk-detail-close">Close</button></div></div>`;
    document.body.appendChild(modal); const close=()=>modal.remove(); modal.querySelector('.close-modal').onclick=close; modal.querySelector('#risk-detail-close').onclick=close; modal.addEventListener('click',e=>{if(e.target===modal)close();});
    modal.querySelector('#risk-detail-inspections').onclick=()=>{close();document.querySelector('a[href="#inspections"]')?.click();document.getElementById('inspection-search')?.focus();};
}

/* ==========================================================================
   User menu / logout
   ========================================================================== */
function initUserMenu(user) {
    const displayName = user.name || (user.email ? user.email.split('@')[0] : 'User');
    document.getElementById('ud-name').textContent = displayName;
    document.getElementById('ud-email').textContent = `${user.email || ''} · ${user.role || 'member'}`;
    document.querySelector('.user-btn-label').textContent = displayName;

    if (user.role === 'admin') {
        const adminLink = document.getElementById('admin-users-link');
        adminLink.style.display = 'flex';
        adminLink.href = 'admin-users.html';
    }

    document.getElementById('logout-btn').addEventListener('click', async function () {
        const ok = await showConfirm('You will be signed out of RAILKAVACH on this device.', { title: 'Log out?', okLabel: 'Log out' });
        if (!ok) return;
        try { await fetch('/auth/logout', { method: 'POST', credentials: 'include' }); }
        catch (error) { console.error('Logout error:', error); }
        window.location.href = 'login.html';
    });
}

/* ==========================================================================
   Theme (light/dark, persisted)
   ========================================================================== */
function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    const stored = localStorage.getItem('rk-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial = stored || (prefersDark ? 'dark' : 'light');
    applyTheme(initial);

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem('rk-theme', next);
    });
}

function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.querySelector('#theme-toggle i').className = 'fas fa-sun';
    } else {
        document.documentElement.removeAttribute('data-theme');
        document.querySelector('#theme-toggle i').className = 'fas fa-moon';
    }
}

/* ==========================================================================
   Sidebar (collapse on desktop, drawer on mobile)
   ========================================================================== */
function initSidebar() {
    const appContainer = document.querySelector('.app-container');
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const overlay = document.getElementById('sidebar-overlay');

    const storedCollapsed = localStorage.getItem('rk-sidebar-collapsed') === 'true';
    appContainer.setAttribute('data-collapsed', storedCollapsed ? 'true' : 'false');

    collapseBtn.addEventListener('click', () => {
        const isCollapsed = appContainer.getAttribute('data-collapsed') === 'true';
        appContainer.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
        localStorage.setItem('rk-sidebar-collapsed', String(!isCollapsed));
    });

    mobileBtn.addEventListener('click', () => {
        appContainer.setAttribute('data-sidebar-open', 'true');
    });
    overlay.addEventListener('click', () => {
        appContainer.removeAttribute('data-sidebar-open');
    });
}

/* ==========================================================================
   Dropdowns (notifications, user menu) — generic open/close handling
   ========================================================================== */
function initDropdowns() {
    const pairs = [
        { btn: document.getElementById('notif-btn'), menu: document.getElementById('notif-dropdown') },
        { btn: document.getElementById('user-btn'), menu: document.getElementById('user-dropdown') }
    ];

    pairs.forEach(({ btn, menu }) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.classList.contains('open');
            pairs.forEach(p => p.menu.classList.remove('open'));
            if (!isOpen) menu.classList.add('open');
        });
    });

    document.addEventListener('click', () => {
        pairs.forEach(p => p.menu.classList.remove('open'));
    });
}

function initAuditLog(logs = []) {
    const tbody = document.querySelector('#audit-table tbody');
    const search = document.getElementById('audit-search');
    const summary = document.getElementById('audit-summary');
    const refresh = document.getElementById('audit-refresh');
    const exportBtn = document.getElementById('audit-export');
    if (!tbody) return;
    let rows = Array.isArray(logs) ? logs.slice() : [];
    const render = () => {
        const q = String(search?.value || '').trim().toLowerCase();
        const filtered = rows.filter(r => !q || [r.action,r.entity_type,r.entity_id,r.actor_email,JSON.stringify(r.details||{})].join(' ').toLowerCase().includes(q));
        const counts = filtered.reduce((m,r)=>{m[r.action]=(m[r.action]||0)+1;return m;},{});
        if (summary) summary.innerHTML = ['CREATE','UPDATE','DELETE','PREDICT'].filter(k=>counts[k]).map(k=>`<span class="audit-pill">${k}: ${counts[k]}</span>`).join('') || '<span class="audit-pill">No activity</span>';
        if (!filtered.length) { tbody.innerHTML='<tr><td colspan="6"><div class="audit-empty"><i class="fas fa-clock-rotate-left"></i><p>No activity found.</p></div></td></tr>'; return; }
        tbody.innerHTML = filtered.slice(0,100).map(r=>`<tr><td>${escapeHtml(formatDate(r.created_at))}<small class="table-subtext">${escapeHtml(timeAgo(r.created_at))}</small></td><td><span class="audit-action ${escapeHtml(r.action)}">${escapeHtml(r.action)}</span></td><td>${escapeHtml(r.entity_type || '—')}</td><td><span class="id-chip">${escapeHtml(r.entity_id || '—')}</span></td><td>${escapeHtml(r.actor_email || r.actor_id || 'System')}</td><td class="audit-details" title="${escapeHtml(JSON.stringify(r.details || {}))}">${escapeHtml(JSON.stringify(r.details || {}))}</td></tr>`).join('');
    };
    render();
    search?.addEventListener('input', render);
    refresh?.addEventListener('click', async()=>{ try { const res=await api('/api/audit-logs'); rows=res.auditLogs||[]; render(); showToast('Activity log refreshed','success',1800); } catch(e){ showToast(e.message||'Could not load activity log','error'); }});
    exportBtn?.addEventListener('click',()=>{ const header=['Time','Action','Entity','ID','Actor','Details']; const data=[header,...rows.map(r=>[r.created_at,r.action,r.entity_type,r.entity_id,r.actor_email||r.actor_id||'System',JSON.stringify(r.details||{})])]; const csv=data.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`railkavach-activity-${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); });
}

function initNotifications(notifications = []) {
    const list = document.getElementById('notif-list');
    const count = document.getElementById('notif-count');
    const unread = notifications.filter(n => !n.is_read).length;
    if (count) {
        count.textContent = unread;
        count.classList.toggle('hidden', unread === 0);
    }
    if (list) {
        list.innerHTML = notifications.length ? notifications.map(n => `
            <div class="notif-item ${n.type || 'blue'}" data-id="${n.id}">
                <span class="notif-ic"><i class="fas ${n.icon || 'fa-circle-info'}"></i></span>
                <div><p>${escapeHtml(n.text)}</p><span>${timeAgo(n.created_at)}</span></div>
            </div>
        `).join('') : '<div class="empty-state" style="padding:20px"><i class="fas fa-bell-slash"></i><p>No notifications yet</p></div>';
    }
    document.getElementById('notif-clear')?.addEventListener('click', async () => {
        try {
            await Promise.all(notifications.filter(n => !n.is_read).map(n => api(`/api/notifications?id=${encodeURIComponent(n.id)}`, { method: 'PATCH', body: JSON.stringify({ id: n.id }) })));
            if (count) count.classList.add('hidden');
            document.querySelectorAll('.notif-item').forEach(x => x.classList.add('read'));
            showToast('Notifications marked as read', 'success');
        } catch (e) { showToast(e.message, 'error'); }
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

/* ==========================================================================
   Navigation between sections
   ========================================================================== */
const sectionTitles = {
    'overview': ['Dashboard', 'Live snapshot of your railway assets'],
    'asset-registry': ['Asset Registry', 'Track every registered railway component'],
    'portal-integrations': ['Portal Integrations', 'Connections to UDM and TMS portals'],
    'inventory-status': ['Inventory Status', 'Stock, inspections and vendor quality'],
    'inspections': ['Inspections', 'Record, review and track railway asset inspections'],
    'ai-inspection': ['AI Visual Inspection', 'YOLO-powered image analysis for railway components'],
    'qr-generator': ['QR Generator', 'Create traceable tags for new components'],
    'scan-qr': ['Scan QR', 'Look up an asset by scanning its tag'],
    'ai-report': ['AI-Based Report', 'Predictive insights generated from asset history']
};

function goToSection(targetId) {
    const navLinks = document.querySelectorAll('.main-nav a');
    const sections = document.querySelectorAll('.section');

    navLinks.forEach(link => link.parentElement.classList.remove('active'));
    const activeLink = document.querySelector(`.main-nav a[href="#${targetId}"]`);
    if (activeLink) activeLink.parentElement.classList.add('active');

    sections.forEach(section => section.classList.toggle('active', section.id === targetId));

    const meta = sectionTitles[targetId];
    if (meta) {
        document.getElementById('page-title-text').textContent = meta[0];
        document.getElementById('page-subtitle-text').textContent = meta[1];
    }

    document.querySelector('.app-container').removeAttribute('data-sidebar-open');
    document.querySelector('.main-content').scrollTo?.({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initNavigation() {
    document.querySelectorAll('.main-nav a').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            goToSection(this.getAttribute('href').substring(1));
        });
    });
}

function initQuickActions() {
    document.querySelectorAll('.quick-action').forEach(btn => {
        btn.addEventListener('click', () => goToSection(btn.dataset.goto));
    });
}

function initGlobalSearch() {
    const input = document.getElementById('global-search');

    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== input) {
            e.preventDefault();
            input.focus();
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const term = input.value.trim();
        if (!term) return;
        goToSection('asset-registry');
        const assetSearch = document.getElementById('asset-search');
        assetSearch.value = term;
        assetSearch.dispatchEvent(new Event('input'));
        showToast(`Searching assets for "${term}"`, 'info', 2200);
    });
}

/* ==========================================================================
   Overview / Dashboard
   ========================================================================== */
function initOverview(assetData = [], notifications = []) {
    const counts = { Active: 0, Maintenance: 0, Inactive: 0 };
    assetData.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
    animateCount('stat-total', assetData.length);
    animateCount('stat-active', counts.Active || 0);
    animateCount('stat-maintenance', counts.Maintenance || 0);
    animateCount('stat-inactive', counts.Inactive || 0);

    const activity = notifications.slice(0, 5);
    const list = document.getElementById('activity-list');
    if (list) list.innerHTML = activity.length ? activity.map(n => `
        <li><span class="act-dot ${n.type || 'blue'}"></span><span class="act-text">${escapeHtml(n.text)}</span><span class="act-time">${timeAgo(n.created_at)}</span></li>
    `).join('') : '<li><span class="act-text">No activity recorded yet.</span></li>';

    const ctx = document.getElementById('overviewChart');
    if (ctx && window.Chart) {
        if (window.rkOverviewChart) window.rkOverviewChart.destroy();
        window.rkOverviewChart = new Chart(ctx.getContext('2d'), {
            type: 'line',
            data: {
                labels: ['Active', 'Maintenance', 'Inactive'],
                datasets: [{ label: 'Assets', data: [counts.Active || 0, counts.Maintenance || 0, counts.Inactive || 0], borderColor: '#2f6fed', backgroundColor: 'rgba(47,111,237,0.08)', tension: .35, fill: true }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
        });
    }
}

function animateCount(elId, target, duration = 700) {
    const el = document.getElementById(elId);
    if (!el) return;
    const start = 0;
    const startTime = performance.now();
    function tick(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(start + (target - start) * eased);
        if (progress < 1) requestAnimationFrame(tick);
        else el.textContent = target;
    }
    requestAnimationFrame(tick);
}

/* ==========================================================================
   Generic searchable / sortable / paginated table controller
   ========================================================================== */
function createTableController({ data, tbody, renderRow, searchInput, searchFields, countEl, sortHeaders, pageSize, prevBtn, nextBtn, pageLabel, emptyColspan, emptyText, statusFilterBtn, statusFilterLabel }) {
    const state = { search: '', sortKey: null, sortDir: 1, page: 1, statusFilter: null };

    function getFiltered() {
        let rows = data;
        if (state.statusFilter) {
            rows = rows.filter(r => r.status === state.statusFilter);
        }
        if (state.search) {
            const term = state.search.toLowerCase();
            rows = rows.filter(r => searchFields.some(f => String(r[f] || '').toLowerCase().includes(term)));
        }
        if (state.sortKey) {
            rows = [...rows].sort((a, b) => {
                const av = String(a[state.sortKey] || '').toLowerCase();
                const bv = String(b[state.sortKey] || '').toLowerCase();
                if (av < bv) return -1 * state.sortDir;
                if (av > bv) return 1 * state.sortDir;
                return 0;
            });
        }
        return rows;
    }

    function render() {
        const filtered = getFiltered();
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        state.page = Math.min(state.page, totalPages);
        const start = (state.page - 1) * pageSize;
        const pageRows = filtered.slice(start, start + pageSize);

        tbody.innerHTML = '';
        if (pageRows.length === 0) {
            const tr = document.createElement('tr');
            tr.className = 'table-empty-row';
            tr.innerHTML = `<td colspan="${emptyColspan}"><i class="fas fa-inbox" style="font-size:1.4rem;opacity:.4;display:block;margin-bottom:.4rem;"></i>${emptyText}</td>`;
            tbody.appendChild(tr);
        } else {
            pageRows.forEach(row => tbody.appendChild(renderRow(row)));
        }

        if (countEl) countEl.textContent = `${filtered.length} of ${data.length} record${data.length === 1 ? '' : 's'}`;
        if (pageLabel) pageLabel.textContent = `Page ${state.page} of ${totalPages}`;
        if (prevBtn) prevBtn.disabled = state.page <= 1;
        if (nextBtn) nextBtn.disabled = state.page >= totalPages;
    }

    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                state.search = searchInput.value.trim();
                state.page = 1;
                render();
            }, 180);
        });
    }

    if (sortHeaders) {
        sortHeaders.forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                if (state.sortKey === key) {
                    state.sortDir *= -1;
                } else {
                    state.sortKey = key;
                    state.sortDir = 1;
                }
                sortHeaders.forEach(h => {
                    h.classList.remove('sorted');
                    const icon = h.querySelector('i');
                    if (icon) icon.className = 'fas fa-sort';
                });
                th.classList.add('sorted');
                const icon = th.querySelector('i');
                if (icon) icon.className = state.sortDir === 1 ? 'fas fa-sort-up' : 'fas fa-sort-down';
                render();
            });
        });
    }

    if (prevBtn) prevBtn.addEventListener('click', () => { state.page--; render(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { state.page++; render(); });

    if (statusFilterBtn) {
        const statuses = [null, 'Active', 'Maintenance', 'Inactive'];
        statusFilterBtn.addEventListener('click', () => {
            const idx = statuses.indexOf(state.statusFilter);
            state.statusFilter = statuses[(idx + 1) % statuses.length];
            statusFilterLabel.textContent = state.statusFilter ? state.statusFilter : 'All statuses';
            state.page = 1;
            render();
        });
    }

    render();
    return {
        render,
        setExternalSearch: (val) => { if (searchInput) { searchInput.value = val; state.search = val; state.page = 1; render(); } },
        replaceData: (rows) => { data.splice(0, data.length, ...(rows || [])); state.page = 1; render(); }
    };
}

/* ==========================================================================
   Asset Registry table
   ========================================================================== */
function initAssetTable(assetData) {
    const tbody = document.querySelector('#asset-table tbody');
    const controller = createTableController({
        data: assetData, tbody,
        searchInput: document.getElementById('asset-search'),
        searchFields: ['id', 'type', 'location', 'status', 'vendor', 'batch_number'],
        countEl: document.getElementById('asset-count'),
        sortHeaders: document.querySelectorAll('#asset-table th[data-sort]'), pageSize: 5,
        prevBtn: document.getElementById('asset-prev'), nextBtn: document.getElementById('asset-next'),
        pageLabel: document.getElementById('asset-page-label'), emptyColspan: 5,
        emptyText: 'No assets registered yet',
        statusFilterBtn: document.getElementById('asset-filter-status'), statusFilterLabel: document.getElementById('asset-filter-label'),
        renderRow: (asset) => {
            const statusClass = asset.status === 'Active' ? 'success' : asset.status === 'Maintenance' ? 'warning' : 'danger';
            const row = document.createElement('tr');
            row.innerHTML = `<td><span class="id-chip">${escapeHtml(asset.id)}</span></td><td>${escapeHtml(asset.type)}</td><td>${escapeHtml(asset.location)}</td><td><span class="status-badge ${statusClass}">${escapeHtml(asset.status)}</span></td><td><button class="btn-icon" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" title="Edit"><i class="fas fa-edit"></i></button><button class="btn-icon" title="Delete"><i class="fas fa-trash"></i></button></td>`;
            row.querySelector('[title="View"]').addEventListener('click', () => showAssetDetails(asset));
            row.querySelector('[title="Edit"]').addEventListener('click', () => editAsset(asset, controller));
            row.querySelector('[title="Delete"]').addEventListener('click', async () => {
                if (!await showConfirm(`This will permanently remove ${asset.id}.`, { title: 'Delete asset?', okLabel: 'Delete' })) return;
                try { await api(`/api/assets?id=${encodeURIComponent(asset.id)}`, { method: 'DELETE', body: JSON.stringify({ id: asset.id }) }); await loadLiveDashboard(); showToast(`${asset.id} deleted`, 'success'); } catch (e) { showToast(e.message, 'error'); }
            });
            return row;
        }
    });
    document.getElementById('asset-add').addEventListener('click', () => addAsset(assetData, controller));
    document.getElementById('asset-export').addEventListener('click', () => exportToCsv('registered-assets.csv', assetData));
    return controller;
}

async function showAssetDetails(asset) {
    if (!asset?.id) return;
    let inspections = [];
    let risk = null;
    try {
        const [inspectionResponse, riskResponse] = await Promise.all([
            api(`/api/inspections?asset_id=${encodeURIComponent(asset.id)}`),
            api(`/api/risk?asset_id=${encodeURIComponent(asset.id)}`).catch(() => null)
        ]);
        inspections = Array.isArray(inspectionResponse?.inspections) ? inspectionResponse.inspections : [];
        risk = riskResponse?.risk || null;
    } catch (error) {
        showToast(error.message || 'Could not load asset details', 'error');
        return;
    }
    inspections.sort((a,b) => new Date(b.inspected_at || b.created_at || 0) - new Date(a.inspected_at || a.created_at || 0));
    const latest = inspections[0];
    const riskLevel = risk?.level || 'PENDING';
    const riskClass = riskLevel === 'LOW' ? 'success' : riskLevel === 'MEDIUM' ? 'warning' : riskLevel === 'HIGH' || riskLevel === 'CRITICAL' ? 'danger' : 'info';
    const statusClass = asset.status === 'Active' ? 'success' : asset.status === 'Maintenance' ? 'warning' : 'danger';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content asset-detail-modal">
        <span class="close-modal" aria-label="Close">&times;</span>
        <div class="inspection-detail-head"><div><span class="eyebrow">LIVE ASSET DETAILS</span><h3>${escapeHtml(asset.id)}</h3><p>${escapeHtml(asset.type || 'Railway component')}</p></div><span class="status-badge ${statusClass}">${escapeHtml(asset.status || 'Unknown')}</span></div>
        <div class="details-grid inspection-detail-grid">
            <div><span>Location</span><strong>${escapeHtml(asset.location || '—')}</strong></div>
            <div><span>Vendor</span><strong>${escapeHtml(asset.vendor || '—')}</strong></div>
            <div><span>Batch</span><strong>${escapeHtml(asset.batch_number || '—')}</strong></div>
            <div><span>Registered</span><strong>${escapeHtml(formatDate(asset.created_at))}</strong></div>
        </div>
        <div class="asset-live-risk"><div><span class="eyebrow">CURRENT RISK</span><h4>${escapeHtml(riskLevel)} ${risk?.score == null ? '' : `· ${escapeHtml(String(risk.score))}%`}</h4></div><span class="status-badge ${riskClass}">${escapeHtml((risk?.ml_available || risk?.method === 'tree-ensemble-ml-with-safety-guardrail' || risk?.method === 'random-forest-ml') ? 'ML' : (risk?.fallback_used || risk?.ml_unavailable_reason) ? 'Baseline (Fallback)' : risk ? 'Baseline' : 'Unavailable')}</span></div>
        <div class="inspection-history-panel"><div class="measurement-head"><span class="eyebrow">INSPECTION HISTORY</span><strong>${inspections.length} record${inspections.length === 1 ? '' : 's'}</strong></div>
            ${inspections.length ? `<div class="asset-inspection-history">${inspections.slice(0,8).map(item => { const c=item.status==='Passed'?'success':item.status==='Failed'?'danger':'warning'; return `<button class="asset-history-row" data-inspection-id="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.status || 'Pending')}</strong><small>${escapeHtml(formatDate(item.inspected_at || item.created_at))}</small></span><span class="status-badge ${c}">${escapeHtml(item.status || 'Pending')}</span></button>`; }).join('')}</div>` : '<div class="empty-state" style="padding:20px"><p>No inspections recorded yet.</p></div>'}
        </div>
        ${latest ? `<div class="inspection-note-box"><span>Latest Notes</span><p>${escapeHtml(latest.notes || 'No notes recorded.')}</p></div>` : ''}
        <div class="details-actions"><button class="btn btn-secondary" id="asset-detail-close">Close</button><button class="btn btn-primary" id="asset-detail-inspect"><i class="fas fa-clipboard-check"></i> New Inspection</button></div>
    </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('is-visible'));
    const close=()=>{modal.classList.remove('is-visible');setTimeout(()=>modal.remove(),180);};
    modal.querySelector('.close-modal').onclick=close;
    modal.querySelector('#asset-detail-close').onclick=close;
    modal.addEventListener('click',e=>{if(e.target===modal)close();});
    modal.querySelectorAll('[data-inspection-id]').forEach(btn=>btn.addEventListener('click',()=>{const item=inspections.find(i=>String(i.id)===String(btn.dataset.inspectionId));if(item){close();showInspectionDetails(item,asset);}}));
    modal.querySelector('#asset-detail-inspect').onclick=()=>{close();window.rkControllers.inspection?.openForm({asset_id:asset.id});};
}

function assetForm(initial = {}) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content asset-form-modal">
        <span class="close-modal" aria-label="Close">&times;</span>
        <div class="inspection-detail-head">
            <div>
                <span class="eyebrow">ASSET REGISTRY</span>
                <h3>${initial.id ? 'Edit Asset' : 'Add New Asset'}</h3>
                <p>${initial.id ? 'Update the registered asset details.' : 'Register a railway component in the live asset registry.'}</p>
            </div>
        </div>
        <div class="details-grid" style="margin-top:18px">
            <label>Asset ID
                <input id="m-id" value="${escapeHtml(initial.id || '')}" placeholder="AST-001" ${initial.id ? 'disabled' : ''}>
                <small>${initial.id ? 'Asset ID cannot be changed after registration.' : 'Leave blank to generate an ID automatically.'}</small>
            </label>
            <label>Asset Type *
                <select id="m-type">
                    <option value="">Select type</option>
                    ${['Rail','Sleeper','Ballast','Fastener','Signal','Bridge Component','Other'].map(v => `<option value="${v}" ${initial.type === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </label>
            <label>Location *
                <input id="m-location" value="${escapeHtml(initial.location || '')}" placeholder="Section A-12">
            </label>
            <label>Vendor
                <input id="m-vendor" value="${escapeHtml(initial.vendor || '')}" placeholder="Vendor name">
            </label>
            <label>Batch Number
                <input id="m-batch" value="${escapeHtml(initial.batch_number || '')}" placeholder="Batch number">
            </label>
            <label>Status
                <select id="m-status">
                    <option value="Active" ${initial.status === 'Active' || !initial.status ? 'selected' : ''}>Active</option>
                    <option value="Maintenance" ${initial.status === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
                    <option value="Inactive" ${initial.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                </select>
            </label>
        </div>
        <div id="asset-form-error" class="form-error" style="display:none"></div>
        <div class="details-actions">
            <button class="btn btn-secondary" id="m-cancel">Cancel</button>
            <button class="btn btn-primary" id="m-save"><i class="fas fa-save"></i> ${initial.id ? 'Update Asset' : 'Save Asset'}</button>
        </div>
    </div>`;

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('is-visible'));

    const close = () => {
        modal.classList.remove('is-visible');
        setTimeout(() => modal.remove(), 180);
    };

    modal.querySelector('.close-modal').onclick = close;
    modal.querySelector('#m-cancel').onclick = close;
    modal.addEventListener('click', e => {
        if (e.target === modal) close();
    });

    return modal;
}

function validateAssetForm(modal) {
    const type = modal.querySelector('#m-type').value.trim();
    const location = modal.querySelector('#m-location').value.trim();
    const idValue = modal.querySelector('#m-id').value.trim();
    const error = modal.querySelector('#asset-form-error');

    if (!type || !location) {
        error.textContent = 'Asset Type and Location are required.';
        error.style.display = 'block';
        return null;
    }

    if (idValue && !/^[A-Za-z0-9_-]{2,40}$/.test(idValue)) {
        error.textContent = 'Asset ID can contain only letters, numbers, hyphens and underscores.';
        error.style.display = 'block';
        return null;
    }

    error.style.display = 'none';

    return {
        ...(idValue ? { id: idValue } : {}),
        type,
        location,
        vendor: modal.querySelector('#m-vendor').value.trim(),
        batch_number: modal.querySelector('#m-batch').value.trim(),
        status: modal.querySelector('#m-status').value
    };
}

async function addAsset(data, controller) {
    const modal = assetForm();

    modal.querySelector('#m-save').onclick = async () => {
        const payload = validateAssetForm(modal);
        if (!payload) return;

        const saveButton = modal.querySelector('#m-save');
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        try {
            const result = await api('/api/assets', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            await loadLiveDashboard();
            modal.remove();
            showToast(`Asset ${result?.asset?.id || payload.id || 'registered'} successfully`, 'success');
        } catch (e) {
            saveButton.disabled = false;
            saveButton.innerHTML = '<i class="fas fa-save"></i> Save Asset';
            showToast(e.message || 'Could not save asset', 'error', 5000);
        }
    };
}

async function editAsset(asset, controller) {
    const modal = assetForm(asset);

    modal.querySelector('#m-save').onclick = async () => {
        const payload = validateAssetForm(modal);
        if (!payload) return;

        delete payload.id;

        const saveButton = modal.querySelector('#m-save');
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

        try {
            await api(`/api/assets?id=${encodeURIComponent(asset.id)}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });

            await loadLiveDashboard();
            modal.remove();
            showToast(`${asset.id} updated successfully`, 'success');
        } catch (e) {
            saveButton.disabled = false;
            saveButton.innerHTML = '<i class="fas fa-save"></i> Update Asset';
            showToast(e.message || 'Could not update asset', 'error', 5000);
        }
    };
}

/* ==========================================================================
   Inventory table
   ========================================================================== */
function initInventoryTable(inventoryData) {
    const tbody = document.querySelector('#inventory-table tbody');
    const controller = createTableController({
        data: inventoryData, tbody,
        searchInput: document.getElementById('inventory-search'), searchFields: ['id','type','batch','vendor','warranty_months','status'],
        countEl: document.getElementById('inventory-count'), sortHeaders: document.querySelectorAll('#inventory-table th[data-sort]'), pageSize: 10,
        emptyColspan: 8, emptyText: 'No inventory records yet',
        renderRow: (item) => {
            const row = document.createElement('tr');
            const statusClass = item.status === 'Deployed' ? 'success' : item.status === 'Maintenance' ? 'warning' : item.status === 'Disposed' ? 'danger' : 'info';
            row.innerHTML = `<td><span class="id-chip">${escapeHtml(item.id)}</span></td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.batch)}</td><td>${escapeHtml(item.vendor)}</td><td>${Number(item.warranty_months || 0)} months</td><td><span class="status-badge ${statusClass}">${escapeHtml(item.status || 'In Stock')}</span></td><td>${formatDate(item.supply_date || item.created_at)}</td><td><button class="btn-icon" title="View"><i class="fas fa-eye"></i></button><button class="btn-icon" title="Edit"><i class="fas fa-edit"></i></button><button class="btn-icon" title="Delete"><i class="fas fa-trash"></i></button></td>`;
            row.querySelector('[title="View"]').addEventListener('click', () => showToast(`${item.id} · ${item.type} · ${item.vendor} · ${item.status}`, 'info', 5000));
            row.querySelector('[title="Edit"]').addEventListener('click', () => editInventory(item));
            row.querySelector('[title="Delete"]').addEventListener('click', async () => {
                if (!await showConfirm(`This will permanently remove ${item.id}.`, { title: 'Delete inventory item?', okLabel: 'Delete' })) return;
                try { await api(`/api/inventory?id=${encodeURIComponent(item.id)}`, { method:'DELETE', body:JSON.stringify({id:item.id}) }); await loadLiveDashboard(); showToast('Inventory item deleted','success'); } catch(e) { showToast(e.message,'error'); }
            });
            return row;
        }
    });
    document.getElementById('inventory-export').addEventListener('click', () => exportToCsv('inventory.csv', inventoryData));
    document.getElementById('inventory-add')?.addEventListener('click', addInventory);
    return controller;
}


function inventoryForm(initial = {}) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content"><span class="close-modal">&times;</span>
        <h3>${initial.id ? 'Edit Inventory Item' : 'Add Inventory Item'}</h3>
        <div class="details-grid" style="margin-top:18px">
            <label>Type<input id="mi-type" value="${escapeHtml(initial.type || '')}" placeholder="Rail / Sleeper / Fitting"></label>
            <label>Batch<input id="mi-batch" value="${escapeHtml(initial.batch || '')}" placeholder="Batch number"></label>
            <label>Vendor<input id="mi-vendor" value="${escapeHtml(initial.vendor || '')}" placeholder="Vendor name"></label>
            <label>Warranty (months)<input id="mi-warranty" type="number" min="0" value="${Number(initial.warranty_months || 0)}"></label>
            <label>Supply Date<input id="mi-date" type="date" value="${initial.supply_date ? String(initial.supply_date).slice(0,10) : ''}"></label>
            <label>Asset ID<input id="mi-asset" value="${escapeHtml(initial.asset_id || '')}" placeholder="AST-001 (optional)"></label>
            <label>Status<select id="mi-status">
                <option value="In Stock" ${initial.status === 'In Stock' || !initial.status ? 'selected' : ''}>In Stock</option>
                <option value="Deployed" ${initial.status === 'Deployed' ? 'selected' : ''}>Deployed</option>
                <option value="Maintenance" ${initial.status === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
                <option value="Disposed" ${initial.status === 'Disposed' ? 'selected' : ''}>Disposed</option>
            </select></label>
        </div>
        <div class="details-actions"><button class="btn btn-secondary" id="mi-cancel">Cancel</button><button class="btn btn-primary" id="mi-save">Save Inventory</button></div>
    </div>`;
    document.body.appendChild(modal);
    setTimeout(() => modal.style.display = 'flex', 10);
    return modal;
}
async function addInventory() {
    const modal = inventoryForm();
    const close = () => modal.remove();
    modal.querySelector('#mi-cancel').onclick = close;
    modal.querySelector('.close-modal').onclick = close;
    modal.querySelector('#mi-save').onclick = async () => {
        const payload = {
            type: modal.querySelector('#mi-type').value,
            batch: modal.querySelector('#mi-batch').value,
            vendor: modal.querySelector('#mi-vendor').value,
            warranty_months: Number(modal.querySelector('#mi-warranty').value || 0),
            supply_date: modal.querySelector('#mi-date').value || null,
            asset_id: modal.querySelector('#mi-asset').value.trim() || null,
            status: modal.querySelector('#mi-status').value
        };
        try {
            await api('/api/inventory', { method:'POST', body:JSON.stringify(payload) });
            await loadLiveDashboard();
            close();
            showToast('Inventory item added successfully', 'success');
        } catch(e) { showToast(e.message, 'error'); }
    };
}
async function editInventory(item) {
    const modal = inventoryForm(item);
    const close = () => modal.remove();
    modal.querySelector('#mi-cancel').onclick = close;
    modal.querySelector('.close-modal').onclick = close;
    modal.querySelector('#mi-save').onclick = async () => {
        const payload = {
            id: item.id,
            type: modal.querySelector('#mi-type').value,
            batch: modal.querySelector('#mi-batch').value,
            vendor: modal.querySelector('#mi-vendor').value,
            warranty_months: Number(modal.querySelector('#mi-warranty').value || 0),
            supply_date: modal.querySelector('#mi-date').value || null,
            asset_id: modal.querySelector('#mi-asset').value.trim() || null,
            status: modal.querySelector('#mi-status').value
        };
        try {
            await api(`/api/inventory?id=${encodeURIComponent(item.id)}`, { method:'PATCH', body:JSON.stringify(payload) });
            await loadLiveDashboard();
            close();
            showToast('Inventory item updated', 'success');
        } catch(e) { showToast(e.message, 'error'); }
    };
}

function exportToCsv(filename, rows) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${rows.length} rows to ${filename}`, 'success');
}

/* ==========================================================================
   Charts (Inventory Status section)
   ========================================================================== */
function initCharts(inventoryData = [], inspections = []) {
    const invCounts = { 'In Stock':0, Deployed:0, Maintenance:0, Disposed:0 };
    inventoryData.forEach(i => { if (invCounts[i.status] !== undefined) invCounts[i.status]++; });
    const inspectionCounts = { Passed:0, Failed:0, Pending:0 };
    inspections.forEach(i => { if (inspectionCounts[i.status] !== undefined) inspectionCounts[i.status]++; });
    const vendors = {};
    inventoryData.forEach(i => vendors[i.vendor] = (vendors[i.vendor] || 0) + 1);

    const makeChart = (id, config, key) => { const el=document.getElementById(id); if(!el||!window.Chart)return; if(window[key])window[key].destroy(); window[key]=new Chart(el.getContext('2d'),config); };
    makeChart('inventoryChart',{type:'doughnut',data:{labels:Object.keys(invCounts),datasets:[{data:Object.values(invCounts),backgroundColor:['#17974f','#2f6fed','#d98c00','#d9363e'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}},'rkInventoryChart');
    makeChart('inspectionChart',{type:'doughnut',data:{labels:Object.keys(inspectionCounts),datasets:[{data:Object.values(inspectionCounts),backgroundColor:['#17974f','#d9363e','#d98c00'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}},'rkInspectionChart');
    const vendorNames=Object.keys(vendors); makeChart('vendorChart',{type:'bar',data:{labels:vendorNames.length?vendorNames:['No vendors'],datasets:[{label:'Inventory records',data:vendorNames.length?vendorNames.map(v=>vendors[v]):[0],backgroundColor:'#2f6fed',borderWidth:0,borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}},'rkVendorChart');
}

/* ==========================================================================
   QR Generator
   ========================================================================== */
function initInspectionTable(inspectionData = [], assetData = []) {
    const tbody = document.querySelector('#inspection-table tbody');
    const searchInput = document.getElementById('inspection-search');
    const countEl = document.getElementById('inspection-count');
    const passedEl = document.getElementById('inspection-passed-count');
    const pendingEl = document.getElementById('inspection-pending-count');
    const failedEl = document.getElementById('inspection-failed-count');
    const totalEl = document.getElementById('inspection-total-count');
    const addBtn = document.getElementById('inspection-add');
    const exportBtn = document.getElementById('inspection-export');
    const summaryGrid = document.getElementById('inspection-summary-grid');
    const sortHeaders = document.querySelectorAll('#inspection-table th[data-sort]');
    const prevBtn = document.getElementById('inspection-prev');
    const nextBtn = document.getElementById('inspection-next');
    const pageLabel = document.getElementById('inspection-page-label');
    if (!tbody) return null;

    let data = Array.isArray(inspectionData) ? [...inspectionData] : [];
    let assets = Array.isArray(assetData) ? [...assetData] : [];
    let term = '';
    let statusFilter = '';
    let sortKey = 'inspected_at';
    let sortDir = 'desc';
    let page = 1;
    const pageSize = 8;

    const assetMap = () => Object.fromEntries(assets.map(a => [a.id, a]));
    const statusClass = status => status === 'Passed' ? 'success' : status === 'Failed' ? 'danger' : 'warning';

    const getFiltered = () => {
        const t = term.toLowerCase();
        let rows = data.filter(i => {
            const asset = assetMap()[i.asset_id];
            if (statusFilter && i.status !== statusFilter) return false;
            if (!t) return true;
            const haystack = [i.asset_id, i.status, i.notes, asset?.type, asset?.location].join(' ').toLowerCase();
            return haystack.includes(t);
        });
        rows.sort((a, b) => {
            let av = a[sortKey], bv = b[sortKey];
            if (sortKey === 'inspected_at') { av = new Date(av || 0).getTime(); bv = new Date(bv || 0).getTime(); }
            else { av = String(av ?? '').toLowerCase(); bv = String(bv ?? '').toLowerCase(); }
            if (av < bv) return sortDir === 'asc' ? -1 : 1;
            if (av > bv) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return rows;
    };

    const render = () => {
        const counts = { Passed: 0, Pending: 0, Failed: 0 };
        data.forEach(i => counts[i.status] = (counts[i.status] || 0) + 1);
        if (passedEl) passedEl.textContent = counts.Passed;
        if (pendingEl) pendingEl.textContent = counts.Pending;
        if (failedEl) failedEl.textContent = counts.Failed;
        if (totalEl) totalEl.textContent = data.length;

        const filtered = getFiltered();
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        if (page > totalPages) page = totalPages;
        const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

        if (countEl) countEl.textContent = `${filtered.length} inspection${filtered.length === 1 ? '' : 's'}${statusFilter ? ` · ${statusFilter}` : ''}`;
        if (pageLabel) pageLabel.textContent = `Page ${page} of ${totalPages}`;
        if (prevBtn) prevBtn.disabled = page <= 1;
        if (nextBtn) nextBtn.disabled = page >= totalPages;

        sortHeaders.forEach(th => {
            th.classList.toggle('is-sorted', th.dataset.sort === sortKey);
            const icon = th.querySelector('i');
            if (icon) icon.className = th.dataset.sort === sortKey ? `fas fa-sort-${sortDir === 'asc' ? 'up' : 'down'}` : 'fas fa-sort';
        });

        if (!data.length) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:32px"><i class="fas fa-clipboard-check"></i><p>No inspections recorded yet.</p><button class="btn btn-primary btn-sm" id="inspection-empty-add"><i class="fas fa-plus"></i> Record the first inspection</button></div></td></tr>`;
            tbody.querySelector('#inspection-empty-add')?.addEventListener('click', () => openForm());
            return;
        }
        if (!pageRows.length) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state" style="padding:32px"><i class="fas fa-magnifying-glass"></i><p>No inspections match your filters.</p></div></td></tr>`;
            return;
        }

        tbody.innerHTML = pageRows.map(i => {
            const asset = assetMap()[i.asset_id];
            const inspector = i.inspector_id ? (window.rkData?.users?.find?.(u => u.id === i.inspector_id)?.name || i.inspector_id.slice(0, 8)) : '—';
            return `<tr class="inspection-row">
                <td><span class="id-chip">${escapeHtml(i.asset_id || '—')}</span>${asset?.type ? `<small class="table-subtext">${escapeHtml(asset.type)}</small>` : ''}</td>
                <td><span class="status-badge ${statusClass(i.status)}">${escapeHtml(i.status || 'Pending')}</span></td>
                <td>${escapeHtml(formatDate(i.inspected_at))}<small class="table-subtext">${escapeHtml(timeAgo(i.inspected_at))}</small></td>
                <td>${escapeHtml(inspector)}</td>
                <td class="inspection-risk-cell" data-risk-asset="${escapeHtml(i.asset_id || '')}"><span class="risk-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</span></td>
                <td class="inspection-notes-cell">${escapeHtml(i.notes || '—')}</td>
                <td><button class="btn-icon" title="View" data-action="view"><i class="fas fa-eye"></i></button><button class="btn-icon" title="Edit" data-action="edit"><i class="fas fa-edit"></i></button><button class="btn-icon" title="Delete" data-action="delete"><i class="fas fa-trash"></i></button></td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('tr.inspection-row').forEach((row, idx) => {
            const item = pageRows[idx];
            if (!item) return;
            row.querySelector('[data-action="view"]')?.addEventListener('click', () => showInspectionDetails(item, assetMap()[item.asset_id]));
            row.querySelector('[data-action="edit"]')?.addEventListener('click', () => editInspection(item, assets));
            row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
                if (!await showConfirm(`Delete inspection for ${item.asset_id || 'this asset'}?`, { title: 'Delete inspection?', okLabel: 'Delete' })) return;
                try {
                    await api(`/api/inspections?id=${encodeURIComponent(item.id)}`, { method: 'DELETE', body: JSON.stringify({ id: item.id }) });
                    data = data.filter(i => i.id !== item.id);
                    render();
                    showToast('Inspection deleted', 'success');
                    loadLiveDashboard().catch(() => {});
                } catch (error) { showToast(error.message || 'Could not delete inspection', 'error'); }
            });
        });
        hydrateRisks(pageRows);
    };

    const openForm = async (initial = {}) => {
        // If the dashboard loaded partially, fetch assets specifically for the form.
        // This keeps inspection creation independent from other dashboard widgets.
        if (!assets.length) {
            try {
                const assetResponse = await api('/api/assets');
                assets = Array.isArray(assetResponse.assets) ? assetResponse.assets : [];
            } catch (error) {
                console.error('Could not load assets for inspection form:', error);
                showToast(error.message || 'Could not load assets. Check your Supabase connection.', 'error', 5000);
                return null;
            }
        }
        if (!assets.length) {
            showToast('No assets found. Add an asset first from the Assets or QR Generator section.', 'warning', 5500);
            return null;
        }

        const isEdit = Boolean(initial.id);
        const selectedAsset = initial.asset_id || '';
        const statuses = [
            { value: 'Pending', label: 'Pending', icon: 'fa-hourglass-half' },
            { value: 'Passed', label: 'Passed', icon: 'fa-circle-check' },
            { value: 'Failed', label: 'Failed', icon: 'fa-triangle-exclamation' }
        ];
        const measurementFields = [
            { id: 'wear', key: 'wear_level', label: 'Wear Level', hint: 'Surface wear vs. new condition' },
            { id: 'corrosion', key: 'corrosion_level', label: 'Corrosion', hint: 'Rust / chemical degradation' },
            { id: 'crack', key: 'crack_level', label: 'Crack Level', hint: 'Visible or detected cracking' },
            { id: 'deformation', key: 'deformation_level', label: 'Deformation', hint: 'Bending or shape distortion' },
            { id: 'vibration', key: 'vibration_level', label: 'Vibration', hint: 'Operational vibration severity' }
        ];

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `<div class="modal-content inspection-modal-content inspection-form-shell">
            <span class="close-modal" aria-label="Close">&times;</span>
            <div class="inspection-form-hero">
                <div class="inspection-form-hero-icon"><i class="fas fa-clipboard-check"></i></div>
                <div class="inspection-form-hero-copy"><span class="eyebrow">FIELD INSPECTION</span><h3>${isEdit ? 'Edit Inspection' : 'New Inspection'}</h3><p>Capture asset condition, measurements and optional AI findings in one structured record.</p></div>
                <div class="inspection-form-live"><span></span> Live save</div>
            </div>
            <div class="inspection-form-steps"><span class="is-active"><b>01</b> Asset</span><span><b>02</b> Condition</span><span><b>03</b> AI evidence</span><span><b>04</b> Notes & save</span></div>

            <div class="inspection-form-section inspection-section-card">
                <div class="inspection-section-title"><div class="inspection-section-icon"><i class="fas fa-location-dot"></i></div><div><strong>Asset & inspection time</strong><small>Select the component being inspected and when the inspection happened.</small></div><span class="section-required">Required</span></div>
                <div class="details-grid">
                    <label>Asset
                        <select id="inspection-asset" ${isEdit ? 'disabled' : ''}>
                            <option value="">Select asset</option>
                            ${assets.map(a => `<option value="${escapeHtml(a.id)}" ${a.id === selectedAsset ? 'selected' : ''}>${escapeHtml(a.id)} — ${escapeHtml(a.type || 'Component')}</option>`).join('')}
                        </select>
                    </label>
                    <label>Inspection Date<input type="datetime-local" id="inspection-date" value="${initial.inspected_at ? new Date(initial.inspected_at).toISOString().slice(0,16) : new Date().toISOString().slice(0,16)}"></label>
                </div>
                <div id="inspection-asset-preview" class="inspection-asset-preview">${assetPreviewHtml(assetMap()[selectedAsset])}</div>
            </div>

            <div class="inspection-form-section inspection-section-card">
                <div class="inspection-section-title"><div class="inspection-section-icon"><i class="fas fa-circle-check"></i></div><div><strong>Inspection outcome</strong><small>Choose the current operational status of this asset.</small></div><span class="section-required">Required</span></div>
                <div class="status-choice-group" id="inspection-status-group" role="radiogroup" aria-label="Inspection status">
                    ${statuses.map(s => `<button type="button" class="status-choice ${statusClass(s.value)} ${(initial.status || 'Pending') === s.value ? 'is-active' : ''}" data-status="${s.value}"><i class="fas ${s.icon}"></i> ${s.label}</button>`).join('')}
                </div>
                <input type="hidden" id="inspection-status" value="${escapeHtml(initial.status || 'Pending')}">
            </div>

            <div class="inspection-form-section inspection-section-card">
                <div class="inspection-section-title"><div class="inspection-section-icon"><i class="fas fa-gauge-high"></i></div><div><strong>Condition measurements</strong><small>Use 0–5: 0 = excellent, 5 = critical. AI findings can raise these values automatically.</small></div><span class="section-required">Required</span></div>
                <div class="measurement-slider-grid">
                    ${measurementFields.map(f => {
                        const value = Number.isFinite(Number(initial[f.key])) ? Number(initial[f.key]) : 0;
                        return `<div class="measurement-slider">
                            <div class="measurement-slider-top"><label for="inspection-${f.id}">${f.label}</label><span class="measurement-slider-value" id="inspection-${f.id}-value">${value}</span></div>
                            <input type="range" id="inspection-${f.id}" min="0" max="5" step="1" value="${value}" data-field="${f.key}">
                            <small class="measurement-slider-hint">${f.hint}</small>
                        </div>`;
                    }).join('')}
                </div>
                <div class="measurement-extra-grid">
                    <label>Temperature (°C)<input type="number" id="inspection-temperature" min="-50" max="150" step="0.1" placeholder="Optional" value="${initial.temperature_c ?? ''}"></label>
                    <label>Maintenance Count<input type="number" id="inspection-maintenance" min="0" max="999" step="1" value="${Number.isFinite(Number(initial.maintenance_count)) ? Number(initial.maintenance_count) : 0}"></label>
                    <label>Previous Failures<input type="number" id="inspection-failures" min="0" max="999" step="1" value="${Number.isFinite(Number(initial.previous_failures)) ? Number(initial.previous_failures) : 0}"></label>
                </div>
            </div>

            <div class="inspection-form-section inspection-section-card yolo-section">
                <div class="inspection-section-title"><div class="inspection-section-icon ai"><i class="fas fa-wand-magic-sparkles"></i></div><div><strong>AI visual evidence <span class="optional-tag">Optional</span></strong><small>Attach an image and run YOLO to support the inspection with visual evidence.</small></div><span class="ai-status-dot"><i class="fas fa-circle"></i> Ready</span></div>
                <div class="yolo-upload-row">
                    <label class="yolo-file-label">Inspection image<input type="file" id="inspection-yolo-image" accept="image/png,image/jpeg,image/webp"></label>
                    <button type="button" class="btn btn-secondary" id="inspection-yolo-analyze"><i class="fas fa-camera"></i> Analyze Image</button>
                </div>
                <div id="inspection-yolo-preview" class="yolo-preview empty"><span>No image selected yet.</span></div>
                <div id="inspection-yolo-result" class="yolo-result" aria-live="polite"></div>
                <input type="hidden" id="inspection-yolo-data" value="">
            </div>

            <div class="inspection-form-section inspection-section-card">
                <div class="inspection-section-title"><div class="inspection-section-icon"><i class="fas fa-note-sticky"></i></div><div><strong>Inspector notes <span class="optional-tag">Optional</span></strong><small>Add observations, corrective action or maintenance context.</small></div></div>
                <label class="full-span">Notes<textarea id="inspection-notes" rows="4" maxlength="2000" placeholder="Example: Minor surface wear observed near joint; schedule follow-up inspection...">${escapeHtml(initial.notes || '')}</textarea></label>
                <div class="inspection-note-meta"><span><i class="fas fa-shield-halved"></i> Stored securely with the inspection record</span><span id="inspection-note-count">0 / 2000</span></div>
            </div>

            <div class="details-actions"><button class="btn btn-secondary" id="inspection-cancel">Cancel</button><button class="btn btn-primary" id="inspection-save"><i class="fas fa-floppy-disk"></i> Save Inspection</button></div>
        </div>`;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('is-visible'));
        const close = () => { modal.classList.remove('is-visible'); setTimeout(() => modal.remove(), 180); document.removeEventListener('keydown', onEsc); };
        const onEsc = e => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onEsc);
        modal.querySelector('.close-modal').onclick = close;
        modal.querySelector('#inspection-cancel').onclick = close;
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        // Segmented status control keeps the same hidden input the save handler already reads.
        modal.querySelectorAll('.status-choice').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.status-choice').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                modal.querySelector('#inspection-status').value = btn.dataset.status;
            });
        });

        // Live-updating slider labels + a small asset preview so the form feels responsive.
        modal.querySelectorAll('.measurement-slider input[type="range"]').forEach(input => {
            input.addEventListener('input', () => {
                const out = modal.querySelector(`#${input.id}-value`);
                if (out) out.textContent = input.value;
            });
        });
        modal.querySelector('#inspection-asset')?.addEventListener('change', e => {
            const preview = modal.querySelector('#inspection-asset-preview');
            if (preview) preview.innerHTML = assetPreviewHtml(assetMap()[e.target.value]);
        });
        const noteInput = modal.querySelector('#inspection-notes');
        const noteCount = modal.querySelector('#inspection-note-count');
        const updateNoteCount = () => { if (noteCount && noteInput) noteCount.textContent = `${noteInput.value.length} / 2000`; };
        noteInput?.addEventListener('input', updateNoteCount);
        updateNoteCount();

        let yoloResult = null;
        let yoloImageName = null;
        let yoloBusy = false;
        const yoloInput = modal.querySelector('#inspection-yolo-image');
        const yoloPreview = modal.querySelector('#inspection-yolo-preview');
        const yoloResultEl = modal.querySelector('#inspection-yolo-result');
        const yoloAnalyze = modal.querySelector('#inspection-yolo-analyze');
        const fileToDataUrl = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
        yoloInput?.addEventListener('change', () => {
            const file = yoloInput.files?.[0];
            yoloResult = null;
            yoloResultEl.innerHTML = '';
            if (!file) { yoloPreview.className = 'yolo-preview empty'; yoloPreview.innerHTML = '<span>No image selected.</span>'; return; }
            if (file.size > 8 * 1024 * 1024) { showToast('Image must be 8 MB or smaller.', 'warning'); yoloInput.value = ''; return; }
            yoloImageName = file.name;
            const url = URL.createObjectURL(file);
            yoloPreview.className = 'yolo-preview';
            yoloPreview.innerHTML = `<img src="${url}" alt="Inspection image preview">`;
        });
        yoloAnalyze?.addEventListener('click', async () => {
            const file = yoloInput?.files?.[0];
            if (!file || yoloBusy) { if (!file) showToast('Select an inspection image first.', 'warning'); return; }
            yoloBusy = true;
            yoloAnalyze.disabled = true; yoloAnalyze.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing…';
            try {
                const dataUrl = await fileToDataUrl(file);
                const result = await api('/api/yolo/predict', { method: 'POST', body: JSON.stringify({ image_base64: dataUrl, filename: file.name }) });
                yoloResult = result;
                if (result.model_is_railway_specific === false || result.demo_model) {
                    throw new Error('This image was analyzed with a non-railway YOLO model. Railway defect prediction is blocked until a trained railway model is installed.');
                }
                const levels = result.condition_levels || {};
                // Feed only validated railway-model findings into the structured inspection fields.
                [['crack_level','crack'],['corrosion_level','corrosion'],['deformation_level','deformation'],['wear_level','wear']].forEach(([inputId,key]) => {
                    if (levels[key] != null && Number(levels[key]) > 0) {
                        const input = modal.querySelector(`#inspection-${inputId.replace('_level','')}`);
                        if (input) { input.value = Math.max(Number(input.value), Number(levels[key])); input.dispatchEvent(new Event('input')); }
                    }
                });
                const count = Number(result.count || (Array.isArray(result.detections) ? result.detections.length : 0));
                let risk = String(result.visual_risk_level || '').toUpperCase().trim();
                let note;
                if (!count) {
                    risk = 'INCONCLUSIVE';
                    note = 'No defects detected above configured confidence threshold. Manual inspection required.';
                } else if (risk === 'REVIEW_REQUIRED' || Number(result.confidence || 0) < 50 || risk === 'LOW' || !risk) {
                    risk = (risk === 'HIGH' || risk === 'CRITICAL') ? risk : 'REVIEW REQUIRED';
                    note = risk === 'REVIEW REQUIRED'
                        ? 'Low-confidence defect detections require manual review.'
                        : 'Defect evidence detected by railway-specific model.';
                } else {
                    note = 'Defect evidence detected by the railway-specific model.';
                }
                yoloResultEl.innerHTML = `<div class="yolo-result-card"><strong>Visual risk: ${escapeHtml(risk)}</strong><span>${escapeHtml(note)} · ${escapeHtml(String(result.confidence ?? 0))}% max confidence</span>${count ? `<div class="yolo-detection-list">${result.detections.slice(0,8).map(d => `<span>${escapeHtml(d.canonical_class || d.class)} · ${Math.round(Number(d.confidence)*100)}%</span>`).join('')}</div>` : '<small style="color:var(--signal-amber,#b45309);">No defects detected above threshold. Manual review required.</small>'}</div>`;
                showToast(`YOLO analysis complete: ${risk}`, 'warning', 3500);
            } catch (error) { yoloResult = null; yoloResultEl.innerHTML = `<div class="yolo-error">${escapeHtml(error.message || 'YOLO analysis failed.')}</div>`; }
            finally { yoloAnalyze.disabled = false; yoloAnalyze.innerHTML = '<i class="fas fa-camera"></i> Analyze Image'; }
        });

        modal.querySelector('#inspection-save').onclick = async () => {
            const assetId = initial.asset_id || modal.querySelector('#inspection-asset').value;
            const status = modal.querySelector('#inspection-status').value;
            const notes = modal.querySelector('#inspection-notes').value.trim();
            const inspectedAt = modal.querySelector('#inspection-date').value;
            const numberField = (selector, min, max, allowBlank = false) => {
                const raw = modal.querySelector(selector).value.trim();
                if (allowBlank && raw === '') return null;
                const value = Number(raw);
                return Number.isFinite(value) && value >= min && value <= max ? value : NaN;
            };
            const measurements = {
                wear_level: numberField('#inspection-wear', 0, 5),
                corrosion_level: numberField('#inspection-corrosion', 0, 5),
                crack_level: numberField('#inspection-crack', 0, 5),
                deformation_level: numberField('#inspection-deformation', 0, 5),
                vibration_level: numberField('#inspection-vibration', 0, 5),
                temperature_c: numberField('#inspection-temperature', -50, 150, true),
                maintenance_count: numberField('#inspection-maintenance', 0, 999),
                previous_failures: numberField('#inspection-failures', 0, 999)
            };
            if (Object.values(measurements).some(v => Number.isNaN(v))) { showToast('Enter valid inspection measurements', 'warning'); return; }
            if (!assetId) { showToast('Select an asset', 'warning'); return; }
            const saveBtn = modal.querySelector('#inspection-save');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
            try {
                const payload = { asset_id: assetId, status, notes, inspected_at: inspectedAt ? new Date(inspectedAt).toISOString() : new Date().toISOString(), ...measurements, yolo_image_name: yoloImageName, yolo_detections: yoloResult?.detections || null, yolo_confidence: yoloResult?.confidence ?? null, yolo_risk_level: yoloResult?.visual_risk_level || null };
                const url = initial.id ? `/api/inspections?id=${encodeURIComponent(initial.id)}` : '/api/inspections/create';
                const response = await api(url, { method: initial.id ? 'PATCH' : 'POST', body: JSON.stringify(initial.id ? { id: initial.id, ...payload } : payload) });
                if (initial.id) {
                    data = data.map(i => i.id === initial.id ? response.inspection : i);
                } else {
                    data = [response.inspection, ...data];
                    page = 1;
                }
                // Update the table immediately with the Supabase response.
                render();

                // Close/show success as soon as the database write succeeds.
                // A secondary dashboard refresh must never make a successful save
                // look like a failed inspection submission.
                close();

                let riskMessage = '';
                try {
                    const riskResponse = await api(`/api/risk?asset_id=${encodeURIComponent(assetId)}`);
                    if (riskResponse.risk) {
                        riskMessage = ` · Risk ${riskResponse.risk.level} (${riskResponse.risk.score}%)`;
                    }
                } catch (riskError) {
                    console.warn('Risk refresh unavailable after inspection save:', riskError.message);
                }

                const saveNote = response.structuredMeasurementsSaved === false
                    ? ' Core inspection saved; measurement columns are not available yet.'
                    : '';
                showToast(`${initial.id ? 'Inspection updated' : 'Inspection recorded successfully'}${riskMessage}${saveNote}`, 'success', 5200);

                // Force a fresh inspection read so the table always reflects Supabase.
                try {
                    const fresh = await api('/api/inspections');
                    data = Array.isArray(fresh.inspections) ? fresh.inspections : data;
                    render();
                } catch (refreshInspectionError) {
                    console.warn('Fresh inspection reload failed:', refreshInspectionError.message);
                }

                // Refresh other dashboard sections independently.
                loadLiveDashboard().catch(refreshError => {
                    console.warn('Dashboard refresh after inspection save failed:', refreshError.message);
                });
            } catch (e) {
                console.error('Inspection save failed:', e);
                showToast(e.message || 'Could not save inspection', 'error');
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save Inspection';
            }
        };
        return modal;
    };

    function assetPreviewHtml(asset) {
        if (!asset) return '<div class="inspection-asset-preview-empty"><i class="fas fa-circle-info"></i> Select an asset to see its details here.</div>';
        return `<div class="inspection-asset-preview-row">
            <span class="id-chip">${escapeHtml(asset.id)}</span>
            <span><i class="fas fa-cube"></i> ${escapeHtml(asset.type || 'Component')}</span>
            <span><i class="fas fa-location-dot"></i> ${escapeHtml(asset.location || '—')}</span>
            <span class="status-badge ${asset.status === 'Active' ? 'success' : asset.status === 'Maintenance' ? 'warning' : 'danger'}">${escapeHtml(asset.status || '—')}</span>
        </div>`;
    }

    async function hydrateRisks(rows) {
        const ids = [...new Set(rows.map(i => i.asset_id).filter(Boolean))];
        if (!ids.length) return;
        const results = await Promise.all(ids.map(async assetId => {
            try {
                const res = await api(`/api/risk?asset_id=${encodeURIComponent(assetId)}`);
                return [assetId, res.risk];
            } catch (_) {
                return [assetId, null];
            }
        }));
        const riskMap = Object.fromEntries(results);
        tbody.querySelectorAll('[data-risk-asset]').forEach(cell => {
            const risk = riskMap[cell.dataset.riskAsset];
            if (!risk) { cell.innerHTML = '<span class="status-badge info">N/A</span>'; return; }
            const level = String(risk.level || 'PENDING').toUpperCase();
            const isMl = Boolean(risk.ml_available || risk.method === 'tree-ensemble-ml-with-safety-guardrail' || risk.method === 'random-forest-ml');
            const isFallback = Boolean(risk.fallback_used || risk.ml_unavailable_reason);
            const method = isMl ? 'ML' : isFallback ? 'FALLBACK' : 'BASE';
            const methodTitle = isMl ? 'ML Model (Tree Ensemble)' : isFallback ? `Baseline Fallback (ML unavailable: ${risk.ml_unavailable_reason || 'model error'})` : 'Baseline Rule Engine';
            cell.innerHTML = `<span class="status-badge ${cls}">${escapeHtml(level)}</span><small class="table-subtext" title="${escapeHtml(methodTitle)}">${escapeHtml(String(risk.score ?? '—'))}% · ${escapeHtml(method)}</small>`;
        });
    }

    addBtn?.addEventListener('click', () => openForm());
    let searchDebounce;
    searchInput?.addEventListener('input', e => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => { term = e.target.value.trim(); page = 1; render(); }, 180);
    });
    exportBtn?.addEventListener('click', () => exportToCsv('railkavach-inspections.csv', getFiltered()));

    summaryGrid?.querySelectorAll('[data-status-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            statusFilter = btn.dataset.statusFilter || '';
            page = 1;
            summaryGrid.querySelectorAll('[data-status-filter]').forEach(b => b.classList.toggle('is-active', b === btn));
            render();
        });
    });

    sortHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (sortKey === key) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
            else { sortKey = key; sortDir = key === 'inspected_at' ? 'desc' : 'asc'; }
            render();
        });
    });

    prevBtn?.addEventListener('click', () => { if (page > 1) { page -= 1; render(); } });
    nextBtn?.addEventListener('click', () => { page += 1; render(); });

    render();
    hydrateRisks(getFiltered().slice(0, pageSize));
    return {
        replaceData(next = [], nextAssets = assets) { data = Array.isArray(next) ? [...next] : []; assets = Array.isArray(nextAssets) ? [...nextAssets] : []; render(); },
        openForm
    };
}

function showInspectionDetails(inspection, asset) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    const cls = inspection.status === 'Passed' ? 'success' : inspection.status === 'Failed' ? 'danger' : 'warning';
    modal.innerHTML = `<div class="modal-content inspection-detail-modal">
        <span class="close-modal">&times;</span>
        <div class="inspection-detail-head"><div><span class="eyebrow">INSPECTION</span><h3>${escapeHtml(inspection.asset_id || '—')}</h3><p>${escapeHtml(asset?.type || 'Railway asset')}</p></div><span class="status-badge ${cls}">${escapeHtml(inspection.status || 'Pending')}</span></div>
        <div class="details-grid inspection-detail-grid">
            <div><span>Inspection date</span><strong>${escapeHtml(formatDate(inspection.inspected_at))}</strong></div>
            <div><span>Location</span><strong>${escapeHtml(asset?.location || '—')}</strong></div>
            <div><span>Vendor</span><strong>${escapeHtml(asset?.vendor || '—')}</strong></div>
            <div><span>Inspector</span><strong>${escapeHtml(inspection.inspector_id ? inspection.inspector_id.slice(0, 12) : '—')}</strong></div>
        </div>
        <div class="measurement-readout-grid">
            ${[['Wear',inspection.wear_level],['Corrosion',inspection.corrosion_level],['Cracks',inspection.crack_level],['Deformation',inspection.deformation_level],['Vibration',inspection.vibration_level],['Temperature',inspection.temperature_c == null ? null : `${inspection.temperature_c} °C`],['Maintenance',inspection.maintenance_count],['Previous failures',inspection.previous_failures]].map(([label,value]) => `<div><span>${label}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`).join('')}
        </div>
        ${inspection.yolo_risk_level || (Array.isArray(inspection.yolo_detections) && inspection.yolo_detections.length) ? `
        <div class="inspection-yolo-card" style="margin: 14px 0; padding: 12px 14px; background: rgba(37,99,235,0.04); border: 1px solid rgba(37,99,235,0.18); border-radius: 8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                <span class="eyebrow" style="color:var(--signal-blue,#2563eb); font-weight:700;"><i class="fas fa-camera"></i> AI Visual Evidence</span>
                <span class="status-badge ${inspection.yolo_risk_level === 'CRITICAL' || inspection.yolo_risk_level === 'HIGH' ? 'danger' : 'warning'}">${escapeHtml(inspection.yolo_risk_level || 'INCONCLUSIVE')}</span>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; font-size: 12px;">
                <div><span>Image:</span> <strong>${escapeHtml(inspection.yolo_image_name || 'Attached')}</strong></div>
                <div><span>Confidence:</span> <strong>${inspection.yolo_confidence != null ? escapeHtml(String(inspection.yolo_confidence)) + '%' : '—'}</strong></div>
                <div><span>Detections:</span> <strong>${Array.isArray(inspection.yolo_detections) ? inspection.yolo_detections.length : 0}</strong></div>
            </div>
        </div>` : ''}
        <div class="inspection-note-box"><span>Notes</span><p>${escapeHtml(inspection.notes || 'No notes recorded.')}</p></div>
        <div class="details-actions"><button class="btn btn-secondary" id="inspection-detail-close">Close</button><button class="btn btn-secondary" id="inspection-detail-asset"><i class="fas fa-train"></i> Asset Details</button><button class="btn btn-primary" id="inspection-detail-edit"><i class="fas fa-edit"></i> Edit</button></div>
    </div>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('is-visible'));
    const close = () => { modal.classList.remove('is-visible'); setTimeout(() => modal.remove(), 180); };
    modal.querySelector('.close-modal').onclick = close;
    modal.querySelector('#inspection-detail-close').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('#inspection-detail-edit').onclick = () => { close(); window.rkControllers.inspection?.openForm(inspection); };
    modal.querySelector('#inspection-detail-asset').onclick = () => { close(); showAssetDetails(asset); };
}

function editInspection(inspection) {
    window.rkControllers.inspection?.openForm(inspection);
}

function initQrGenerator() {
    const generateBtn = document.getElementById('generate-qr');
    const container = document.getElementById('qr-container');
    const downloadBtn = document.getElementById('download-qr');
    const copyBtn = document.getElementById('copy-qr-data');
    const supplyDate = document.getElementById('supply-date');
    if (!generateBtn || !container) return;

    if (supplyDate && !supplyDate.value) supplyDate.valueAsDate = new Date();

    let lastQr = null;

    const renderStructuredResult = (asset, inventory) => {
        const status = asset.status || 'Active';
        const statusClass = status === 'Active' ? 'success' : status === 'Maintenance' ? 'warning' : 'danger';
        const qrPayload = `RAILKAVACH|ASSET|${asset.id}`;
        const copyText = [
            'RAILKAVACH ASSET',
            `Asset ID: ${asset.id}`,
            `Component: ${asset.type || '—'}`,
            `Location: ${asset.location || '—'}`,
            `Vendor: ${asset.vendor || '—'}`,
            `Batch: ${asset.batch_number || '—'}`,
            `Status: ${status}`,
            `Warranty: ${inventory?.warranty_months ?? 0} months`,
            `Supply Date: ${inventory?.supply_date || '—'}`
        ].join('\n');

        container.insertAdjacentHTML('beforeend', `
            <div class="qr-result-card">
                <div class="qr-result-head">
                    <div>
                        <span class="eyebrow"><i class="fas fa-circle-check"></i> Saved successfully</span>
                        <h3>${escapeHtml(asset.id)}</h3>
                    </div>
                    <span class="status-badge ${statusClass}">${escapeHtml(status)}</span>
                </div>
                <div class="qr-structured-grid">
                    <div><span>Component</span><strong>${escapeHtml(asset.type || '—')}</strong></div>
                    <div><span>Location</span><strong>${escapeHtml(asset.location || '—')}</strong></div>
                    <div><span>Vendor</span><strong>${escapeHtml(asset.vendor || '—')}</strong></div>
                    <div><span>Batch</span><strong>${escapeHtml(asset.batch_number || '—')}</strong></div>
                    <div><span>Warranty</span><strong>${Number(inventory?.warranty_months || 0)} months</strong></div>
                    <div><span>Supply date</span><strong>${escapeHtml(inventory?.supply_date || '—')}</strong></div>
                </div>
                <div class="qr-payload">
                    <span><i class="fas fa-qrcode"></i> QR payload</span>
                    <code>${escapeHtml(qrPayload)}</code>
                </div>
            </div>
        `);

        lastQr = { asset, inventory, qrPayload, copyText };
    };

    generateBtn.addEventListener('click', async () => {
        const vendor = document.getElementById('vendor-name')?.value.trim();
        const batch = document.getElementById('batch-number')?.value.trim();
        const date = document.getElementById('supply-date')?.value;
        const warranty = Number(document.getElementById('warranty-period')?.value || 0);
        const uiStatus = document.getElementById('current-status')?.value || 'In Stock';
        const type = document.getElementById('component-type')?.value.trim() || 'Railway Component';
        const location = document.getElementById('component-location')?.value.trim() || 'Unassigned';

        if (!vendor || !batch) {
            showToast('Vendor and batch number are required', 'warning');
            return;
        }

        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
        container.innerHTML = '<div class="loading-inline"><span class="spinner"></span> Creating asset and QR code…</div>';
        if (downloadBtn) downloadBtn.disabled = true;
        if (copyBtn) copyBtn.disabled = true;

        const assetId = `AST-${Date.now().toString(36).toUpperCase()}`;
        const assetStatus = uiStatus === 'Maintenance' ? 'Maintenance' : 'Active';

        try {
            const assetResponse = await api('/api/assets', {
                method: 'POST',
                body: JSON.stringify({
                    id: assetId,
                    type,
                    location,
                    status: assetStatus,
                    vendor,
                    batch_number: batch,
                    qr_data: { schema: 'RAILKAVACH-QR-V1', asset_id: assetId }
                })
            });

            const savedAsset = assetResponse.asset;
            const inventoryId = `INV-${assetId.replace(/^AST-/, '')}`;
            const inventoryResponse = await api('/api/inventory', {
                method: 'POST',
                body: JSON.stringify({
                    id: inventoryId,
                    type,
                    batch,
                    vendor,
                    warranty_months: warranty,
                    supply_date: date || null,
                    status: uiStatus,
                    asset_id: savedAsset.id
                })
            });

            // The QR contains only a compact structured identifier, not SQL or a large JSON blob.
            const qrPayload = `RAILKAVACH|ASSET|${savedAsset.id}`;
            const qr = qrcode(10, 'M');
            qr.addData(qrPayload);
            qr.make();

            container.innerHTML = `
                <div class="qr-code-wrap">
                    <div class="qr-code-image">${qr.createImgTag(6, 10)}</div>
                    <p class="qr-scan-hint"><i class="fas fa-camera"></i> Scan to load this asset from the RAILKAVACH database</p>
                </div>
            `;

            renderStructuredResult(savedAsset, inventoryResponse.inventory);
            lastQr = { ...lastQr, asset: savedAsset, inventory: inventoryResponse.inventory, qrPayload };

            if (downloadBtn) downloadBtn.disabled = false;
            if (copyBtn) copyBtn.disabled = false;
            showToast(`${savedAsset.id} created and QR generated`, 'success');

            // Keep the dashboard data in sync if the live loader exists.
            if (typeof loadLiveDashboard === 'function') {
                loadLiveDashboard().catch(() => {});
            }
        } catch (e) {
            console.error(e);
            container.innerHTML = '<div class="empty-state"><i class="fas fa-circle-exclamation"></i><p>Could not create the asset.</p></div>';
            showToast(e.message || 'Could not save component', 'error');
        } finally {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fas fa-qrcode"></i> Generate QR Code';
        }
    });

    downloadBtn?.addEventListener('click', () => {
        const img = container.querySelector('.qr-code-image img');
        if (!img || !lastQr) return;
        const link = document.createElement('a');
        link.download = `railkavach-${lastQr.asset.id}.png`;
        link.href = img.src;
        link.click();
        showToast('QR image downloaded', 'success');
    });

    copyBtn?.addEventListener('click', async () => {
        if (!lastQr) return;
        try {
            await navigator.clipboard.writeText(lastQr.copyText);
            showToast('Structured asset details copied', 'success');
        } catch (e) {
            showToast('Could not copy asset details', 'error');
        }
    });
}

function initScanner() {
    const startBtn = document.getElementById('start-scanner');
    const stopBtn = document.getElementById('stop-scanner');
    const result = document.getElementById('scan-result-data');
    let scanner;
    let lastScannedId = null;

    if (!startBtn || !result) return;

    const renderAsset = (asset, inspections = [], risk = null) => {
        const status = asset.status || 'Unknown';
        const sortedInspections = [...inspections].sort((a, b) => new Date(b.inspected_at || b.created_at || 0) - new Date(a.inspected_at || a.created_at || 0));
        const latestInspection = sortedInspections[0];
        const inspectionClass = latestInspection?.status === 'Passed' ? 'success' : latestInspection?.status === 'Failed' ? 'danger' : 'warning';
        const inspectionHistory = sortedInspections.length ? sortedInspections.slice(0, 5).map(item => {
            const cls = item.status === 'Passed' ? 'success' : item.status === 'Failed' ? 'danger' : 'warning';
            return `<div class=\"scan-inspection-row\"><div><strong>${escapeHtml(item.status || 'Pending')}</strong><span>${formatDate(item.inspected_at || item.created_at)}</span></div><span class=\"status-badge ${cls}\">${escapeHtml(item.status || 'Pending')}</span></div>`;
        }).join('') : '<div class=\"scan-inspection-empty\">No inspection records found for this asset.</div>';
        const statusClass = status === 'Active' ? 'success' : status === 'Maintenance' ? 'warning' : status === 'Inactive' ? 'danger' : 'info';
        const riskLevel = risk?.level || 'PENDING';
        const riskClass = riskLevel === 'LOW' ? 'success' : riskLevel === 'MEDIUM' ? 'warning' : riskLevel === 'HIGH' || riskLevel === 'CRITICAL' ? 'danger' : 'info';
        const created = asset.created_at ? new Date(asset.created_at).toLocaleDateString(undefined, {day:'2-digit', month:'short', year:'numeric'}) : '—';
        const updated = asset.updated_at ? new Date(asset.updated_at).toLocaleDateString(undefined, {day:'2-digit', month:'short', year:'numeric'}) : '—';

        result.innerHTML = `
            <div class="mobile-scan-card">
                <div class="mobile-scan-top">
                    <div class="scan-success-icon"><i class="fas fa-circle-check"></i></div>
                    <div class="mobile-scan-heading">
                        <span class="eyebrow">RAILKAVACH ASSET</span>
                        <h3>${escapeHtml(asset.id || 'Unknown Asset')}</h3>
                        <p><i class="fas fa-database"></i> Live database record</p>
                    </div>
                    <span class="status-badge ${statusClass}">${escapeHtml(status)}</span>
                </div>

                <div class="mobile-asset-hero">
                    <div class="mobile-asset-type-icon"><i class="fas fa-train"></i></div>
                    <div>
                        <span>Component</span>
                        <strong>${escapeHtml(asset.type || 'Railway Component')}</strong>
                    </div>
                </div>

                <div class="mobile-data-list">
                    <div class="mobile-data-row">
                        <div class="mobile-data-icon"><i class="fas fa-location-dot"></i></div>
                        <div><span>Location</span><strong>${escapeHtml(asset.location || 'Not assigned')}</strong></div>
                    </div>
                    <div class="mobile-data-row">
                        <div class="mobile-data-icon"><i class="fas fa-building"></i></div>
                        <div><span>Vendor</span><strong>${escapeHtml(asset.vendor || 'Not available')}</strong></div>
                    </div>
                    <div class="mobile-data-row">
                        <div class="mobile-data-icon"><i class="fas fa-box"></i></div>
                        <div><span>Batch Number</span><strong>${escapeHtml(asset.batch_number || 'Not available')}</strong></div>
                    </div>
                    <div class="mobile-data-row">
                        <div class="mobile-data-icon"><i class="fas fa-calendar"></i></div>
                        <div><span>Registered</span><strong>${created}</strong></div>
                    </div>
                    <div class="mobile-data-row">
                        <div class="mobile-data-icon"><i class="fas fa-clock-rotate-left"></i></div>
                        <div><span>Last Updated</span><strong>${updated}</strong></div>
                    </div>
                </div>

                <div class="scan-live-section">
                    <div class="scan-live-heading"><div><span class="eyebrow">CONDITION RISK</span><h4>${risk ? `${escapeHtml(riskLevel)} · ${escapeHtml(String(risk.score))}%` : 'Assessment unavailable'}</h4></div>${risk ? `<span class="status-badge ${riskClass}">${escapeHtml(riskLevel)}</span>` : ''}</div>
                    <p class="scan-inspection-notes">${risk ? ((risk.ml_available || risk.method === 'tree-ensemble-ml-with-safety-guardrail' || risk.method === 'random-forest-ml') ? 'Live Tree Ensemble ML prediction from the latest structured inspection data.' : (risk.fallback_used || risk.ml_unavailable_reason) ? `Live baseline assessment (ML fallback: ${escapeHtml(risk.ml_unavailable_reason || 'runtime error')}).` : 'Live baseline assessment from current asset status and inspection history.') : 'Risk assessment could not be loaded.'}</p>
                </div>
                <div class="scan-live-section">
                    <div class="scan-live-heading"><div><span class="eyebrow">LATEST INSPECTION</span><h4>${latestInspection ? escapeHtml(latestInspection.status || 'Pending') : 'Not inspected yet'}</h4></div>${latestInspection ? `<span class="status-badge ${inspectionClass}">${escapeHtml(latestInspection.status || 'Pending')}</span>` : ''}</div>
                    ${latestInspection ? `<div class="scan-inspection-meta"><span><i class="fas fa-calendar-check"></i> ${formatDate(latestInspection.inspected_at || latestInspection.created_at)}</span><span><i class="fas fa-user-check"></i> ${escapeHtml(latestInspection.inspector_id || 'Inspector')}</span></div><p class="scan-inspection-notes">${escapeHtml(latestInspection.notes || 'No inspection notes recorded.')}</p>` : '<p class="scan-inspection-notes">Create an inspection to start tracking this asset condition.</p>'}
                </div>
                <div class="scan-live-section">
                    <div class="scan-live-heading"><div><span class="eyebrow">INSPECTION HISTORY</span><h4>${sortedInspections.length} record${sortedInspections.length === 1 ? '' : 's'}</h4></div></div>
                    <div class="scan-inspection-history">${inspectionHistory}</div>
                </div>
                <div class="mobile-scan-actions">
                    <button class="btn btn-primary mobile-full-btn" id="scan-view-details"><i class="fas fa-eye"></i> View Full Details</button>
                    <button class="btn btn-secondary mobile-full-btn" id="scan-new-inspection"><i class="fas fa-clipboard-check"></i> New Inspection</button>
                    <button class="btn btn-secondary mobile-full-btn" id="scan-copy-details"><i class="fas fa-copy"></i> Copy Details</button>
                </div>
            </div>
        `;

        document.getElementById('scan-view-details')?.addEventListener('click', () => {
            showScanDetailsModal(asset, sortedInspections);
        });

        document.getElementById('scan-new-inspection')?.addEventListener('click', () => {
            const inspectionNav = document.querySelector('a[href="#inspections"]');
            inspectionNav?.click();
            setTimeout(() => {
                if (window.rkControllers.inspection?.openForm) window.rkControllers.inspection.openForm({ asset_id: asset.id });
                else showToast(`Open Inspections → New Inspection for ${asset.id}`, 'info');
            }, 80);
        });

        document.getElementById('scan-copy-details')?.addEventListener('click', async () => {
            const text = [
                'RAILKAVACH ASSET',
                `Asset ID: ${asset.id || '—'}`,
                `Component: ${asset.type || '—'}`,
                `Status: ${asset.status || '—'}`,
                `Location: ${asset.location || '—'}`,
                `Vendor: ${asset.vendor || '—'}`,
                `Batch Number: ${asset.batch_number || '—'}`,
                `Registered: ${created}`,
                `Last Updated: ${updated}`,
                `Latest Inspection: ${latestInspection?.status || 'Not inspected'}`,
                `Risk: ${risk ? `${risk.level} (${risk.score}%)` : 'Unavailable'}`,
                `Inspection Date: ${latestInspection ? formatDate(latestInspection.inspected_at || latestInspection.created_at) : '—'}`,
                `Inspection Notes: ${latestInspection?.notes || '—'}`
            ].join('\n');

            try {
                await navigator.clipboard.writeText(text);
                showToast('Asset details copied', 'success');
            } catch (_) {
                showToast('Could not copy details', 'error');
            }
        });
    };

    const showScanDetailsModal = (asset, inspections = []) => {
        const modal = document.createElement('div');
        modal.className = 'modal mobile-scan-modal';
        modal.innerHTML = `
            <div class="modal-content mobile-details-modal">
                <button class="mobile-modal-close" aria-label="Close"><i class="fas fa-xmark"></i></button>
                <div class="mobile-modal-header">
                    <span class="eyebrow">ASSET DETAILS</span>
                    <h3>${escapeHtml(asset.id || 'Asset')}</h3>
                    <span class="status-badge ${asset.status === 'Active' ? 'success' : asset.status === 'Maintenance' ? 'warning' : 'danger'}">${escapeHtml(asset.status || 'Unknown')}</span>
                </div>
                <div class="mobile-modal-grid">
                    <div><span>Component</span><strong>${escapeHtml(asset.type || '—')}</strong></div>
                    <div><span>Location</span><strong>${escapeHtml(asset.location || '—')}</strong></div>
                    <div><span>Vendor</span><strong>${escapeHtml(asset.vendor || '—')}</strong></div>
                    <div><span>Batch Number</span><strong>${escapeHtml(asset.batch_number || '—')}</strong></div>
                    <div><span>Created</span><strong>${asset.created_at ? new Date(asset.created_at).toLocaleString() : '—'}</strong></div>
                    <div><span>Updated</span><strong>${asset.updated_at ? new Date(asset.updated_at).toLocaleString() : '—'}</strong></div>
                </div>
                <div class="scan-modal-history">
                    <div class="scan-live-heading"><div><span class="eyebrow">INSPECTION HISTORY</span><h4>${inspections.length ? `${inspections.length} record${inspections.length === 1 ? '' : 's'}` : 'No records'}</h4></div></div>
                    <div class="scan-inspection-history">${inspections.slice(0, 8).map(item => `<div class=\"scan-inspection-row\"><div><strong>${escapeHtml(item.status || 'Pending')}</strong><span>${formatDate(item.inspected_at || item.created_at)}</span></div><span class=\"status-badge ${item.status === 'Passed' ? 'success' : item.status === 'Failed' ? 'danger' : 'warning'}\">${escapeHtml(item.status || 'Pending')}</span></div>`).join('') || '<div class=\"scan-inspection-empty\">No inspection records found.</div>'}</div>
                </div>
                <div class="mobile-live-note"><i class="fas fa-shield-halved"></i><span>This information was retrieved from the current RAILKAVACH database.</span></div>
            </div>
        `;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('is-visible'));
        const close = () => { modal.classList.remove('is-visible'); setTimeout(() => modal.remove(), 180); };
        modal.querySelector('.mobile-modal-close').onclick = close;
        modal.addEventListener('click', e => { if (e.target === modal) close(); });
    };

    const stop = () => {
        if (!scanner) return;
        scanner.stop().then(() => {
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }).catch(() => {
            startBtn.disabled = false;
            stopBtn.disabled = true;
        });
    };

    startBtn.addEventListener('click', () => {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        result.innerHTML = `
            <div class="mobile-scan-loading">
                <div class="scan-loader-icon"><i class="fas fa-qrcode"></i></div>
                <h4>Scanning for a RAILKAVACH QR</h4>
                <p>Point your camera at the QR code and keep it inside the frame.</p>
            </div>
        `;

        scanner = new Html5Qrcode('qr-reader');
        scanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            async (decodedText) => {
                if (lastScannedId === decodedText) return;
                lastScannedId = decodedText;

                try {
                    let assetId = null;

                    if (decodedText.startsWith('RAILKAVACH|ASSET|')) {
                        assetId = decodedText.split('|')[2];
                    } else {
                        try {
                            const parsed = JSON.parse(decodedText);
                            assetId = parsed.id || parsed.asset_id || parsed.assetId;
                        } catch (_) {
                            const match = decodedText.match(/\bAST-[A-Z0-9]+\b/i);
                            assetId = match ? match[0].toUpperCase() : null;
                        }
                    }

                    if (!assetId) throw new Error('This is not a valid RAILKAVACH asset QR.');

                    result.innerHTML = `
                        <div class="mobile-scan-loading">
                            <div class="scan-loader-icon"><i class="fas fa-database"></i></div>
                            <h4>Loading asset details…</h4>
                            <p>Getting the latest information from the database.</p>
                        </div>
                    `;

                    const response = await api(`/api/assets?id=${encodeURIComponent(assetId)}`);
                    const asset = response.assets?.[0];

                    if (!asset) throw new Error(`Asset ${assetId} was not found.`);

                    let inspections = [];
                    let risk = null;
                    try {
                        const inspectionResponse = await api(`/api/inspections?asset_id=${encodeURIComponent(assetId)}`);
                        inspections = inspectionResponse.inspections || [];
                    } catch (inspectionError) {
                        console.warn('Inspection history unavailable for scanned asset:', inspectionError);
                    }
                    try {
                        const riskResponse = await api(`/api/risk?asset_id=${encodeURIComponent(assetId)}`);
                        risk = riskResponse.risk || null;
                    } catch (riskError) {
                        console.warn('Risk assessment unavailable for scanned asset:', riskError);
                    }

                    renderAsset(asset, inspections, risk);
                    showToast('Asset details loaded', 'success');
                    stop();
                } catch (e) {
                    result.innerHTML = `
                        <div class="mobile-scan-error">
                            <div class="scan-error-icon"><i class="fas fa-triangle-exclamation"></i></div>
                            <h4>Could not load this QR</h4>
                            <p>${escapeHtml(e.message || 'The QR code could not be processed.')}</p>
                            <button class="btn btn-primary" id="scan-again"><i class="fas fa-rotate"></i> Scan Again</button>
                        </div>
                    `;
                    document.getElementById('scan-again')?.addEventListener('click', () => {
                        lastScannedId = null;
                        startBtn.click();
                    });
                    showToast(e.message || 'Invalid QR code', 'error');
                    stop();
                }
            },
            () => {}
        ).catch(error => {
            console.error(error);
            result.innerHTML = `
                <div class="mobile-scan-error">
                    <div class="scan-error-icon"><i class="fas fa-camera-slash"></i></div>
                    <h4>Camera unavailable</h4>
                    <p>Please allow camera access in your browser settings and try again.</p>
                </div>
            `;
            startBtn.disabled = false;
            stopBtn.disabled = true;
            showToast('Camera access failed', 'error');
        });
    });

    stopBtn?.addEventListener('click', () => {
        lastScannedId = null;
        stop();
        result.innerHTML = `
            <div class="mobile-scan-empty">
                <div><i class="fas fa-qrcode"></i></div>
                <h4>Ready to scan</h4>
                <p>Tap <strong>Start Scanner</strong> and point your camera at a RAILKAVACH QR.</p>
            </div>
        `;
    });
}

function initPortalStatus(portals = []) {
    const map = Object.fromEntries(portals.map(p => [p.name, p]));
    ['UDM','TMS'].forEach(name => {
        const p = map[name]; updatePortalStatus(name, p?.status === 'Connected');
        const card = [...document.querySelectorAll('.portal-card')].find(c => c.querySelector('h3')?.textContent.includes(name));
        if (!card || !p) return;
        const details = card.querySelector('.portal-details');
        if (details) {
            const spans = details.querySelectorAll('span');
            if (spans[0]) spans[0].textContent = p.last_sync ? `Last sync: ${new Date(p.last_sync).toLocaleString()}` : 'Last sync: Never';
        }
    });
    document.querySelectorAll('.portal-details .btn').forEach(button => {
        button.addEventListener('click', async function () {
            const portalType=this.closest('.portal-card').querySelector('h3').textContent.trim(); const p=map[portalType];
            const modal=document.createElement('div'); modal.className='modal'; modal.innerHTML=`<div class="modal-content"><span class="close-modal">&times;</span><div class="portal-details-modal"><h3>${escapeHtml(portalType)} Integration Details</h3><div class="details-grid"><div class="detail-item"><span class="detail-label">Status</span><span class="detail-value">${escapeHtml(p?.status||'Disconnected')}</span></div><div class="detail-item"><span class="detail-label">Last Sync</span><span class="detail-value">${p?.last_sync?new Date(p.last_sync).toLocaleString():'Never'}</span></div><div class="detail-item"><span class="detail-label">API Version</span><span class="detail-value">${escapeHtml(p?.api_version||'—')}</span></div><div class="detail-item"><span class="detail-label">Data Points</span><span class="detail-value">${Number(p?.data_points||0).toLocaleString()}</span></div><div class="detail-item"><span class="detail-label">Last Error</span><span class="detail-value">${escapeHtml(p?.last_error||'None')}</span></div><div class="detail-item"><span class="detail-label">Uptime</span><span class="detail-value">${p?.uptime==null?'—':p.uptime+'%'}</span></div></div><div class="details-actions"><button class="btn btn-secondary" id="modal-refresh">Refresh Status</button><button class="btn btn-primary" id="modal-sync">Record Sync</button></div></div></div>`;
            document.body.appendChild(modal); setTimeout(()=>modal.style.display='flex',10); const close=()=>modal.remove(); modal.querySelector('.close-modal').onclick=close; modal.addEventListener('click',e=>{if(e.target===modal)close()});
            modal.querySelector('#modal-refresh').onclick=()=>{showToast(`${portalType} status loaded from database`,'info');close()};
            modal.querySelector('#modal-sync').onclick=async()=>{try{await api(`/api/portals?name=${encodeURIComponent(portalType)}`,{method:'PATCH',body:JSON.stringify({name:portalType,status:'Connected',last_sync:new Date().toISOString()})});showToast(`${portalType} sync timestamp saved`,'success');close()}catch(e){showToast(e.message,'error')}};
        });
    });
}

function updatePortalStatus(portalType, isConnected) {
    document.querySelectorAll('.portal-card').forEach(card => {
        const cardTitle = card.querySelector('h3').textContent;
        if (!cardTitle.includes(portalType)) return;
        const statusIcon = card.querySelector('.portal-status i');
        const statusText = card.querySelector('.portal-status p');
        if (isConnected) {
            statusIcon.className = 'fas fa-check-circle portal-connected';
            statusText.textContent = `${portalType} Portal is connected and integrated`;
        } else {
            statusIcon.className = 'fas fa-times-circle';
            statusIcon.style.color = 'var(--signal-red)';
            statusText.textContent = `${portalType} Portal connection failed`;
        }
    });
}

/* ==========================================================================
   AI Visual Inspection
   ========================================================================== */
function initAiInspection() {
    const input = document.getElementById('ai-image-input');
    const choose = document.getElementById('ai-choose-image');
    const zone = document.getElementById('ai-upload-zone');
    const selected = document.getElementById('ai-selected-file');
    const analyze = document.getElementById('ai-analyze-btn');
    const result = document.getElementById('ai-result-container');
    const status = document.getElementById('ai-result-status');
    const badge = document.getElementById('ai-model-badge');
    const note = document.getElementById('ai-model-note');
    if (!input || !choose || !analyze || !result) return;

    let file = null;
    let previewUrl = null;
    let analysisBusy = false;
    const escape = window.escapeHtml || (v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
    const setStatus = (text, cls = '') => {
        if (!status) return;
        status.className = `status-badge ${cls}`.trim();
        status.textContent = text;
    };
    const showFile = f => {
        file = f || null;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        if (!file) { selected.hidden = true; selected.innerHTML = ''; analyze.disabled = true; setStatus('Waiting'); return; }
        if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { showToast('Please choose a JPG, PNG or WebP image.', 'warning'); return; }
        if (file.size > 8 * 1024 * 1024) { showToast('Image must be 8 MB or smaller.', 'warning'); return; }
        previewUrl = URL.createObjectURL(file);
        selected.hidden = false;
        selected.innerHTML = `<img src="${previewUrl}" alt="Selected inspection image"><div><strong>${escape(file.name)}</strong><span>${(file.size / 1024 / 1024).toFixed(2)} MB · ${escape(file.type)}</span></div><button type="button" class="btn-icon" id="ai-remove-image" title="Remove image"><i class="fas fa-xmark"></i></button>`;
        selected.querySelector('#ai-remove-image')?.addEventListener('click', () => { input.value = ''; showFile(null); });
        analyze.disabled = false; setStatus('Ready');
    };
    choose.addEventListener('click', () => input.click());
    zone?.addEventListener('click', e => { if (!e.target.closest('button')) input.click(); });
    input.addEventListener('change', () => { if (input.files?.[0]) showFile(input.files[0]); });
    ['dragenter','dragover'].forEach(ev => zone?.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('is-dragging'); }));
    ['dragleave','drop'].forEach(ev => zone?.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('is-dragging'); }));
    zone?.addEventListener('drop', e => { if (e.dataTransfer?.files?.[0]) showFile(e.dataTransfer.files[0]); });
    // Keep network + inference fast by normalizing the image in the browser.
    // YOLO already resizes to 640px internally, so sending an 8MB camera image
    // gives little detection benefit but adds upload/decode latency.
    const MAX_ANALYSIS_SIDE = 1600;
    const MAX_ANALYSIS_BYTES = 2.5 * 1024 * 1024;

    const loadImageForAnalysis = f => new Promise((resolve, reject) => {
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The image could not be read.')); };
        img.src = url;
    });

    const canvasToBlob = (canvas, quality) => new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare the image.')), 'image/jpeg', quality);
    });

    const prepareImageForAnalysis = async f => {
        if (f.size <= MAX_ANALYSIS_BYTES && f.type === 'image/jpeg') {
            return f;
        }

        const img = await loadImageForAnalysis(f);
        const scale = Math.min(1, MAX_ANALYSIS_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Your browser cannot prepare this image.');

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Usually one pass is enough. A second pass guarantees the request
        // stays compact even for very detailed camera images.
        let quality = 0.84;
        let blob = await canvasToBlob(canvas, quality);
        while (blob.size > MAX_ANALYSIS_BYTES && quality > 0.58) {
            quality -= 0.08;
            blob = await canvasToBlob(canvas, quality);
        }

        if (blob.size > MAX_ANALYSIS_BYTES) {
            throw new Error('This image is still too large after optimization. Please choose a smaller image.');
        }

        return new File([blob], f.name.replace(/\.[^.]+$/, '') + '-optimized.jpg', {
            type: 'image/jpeg',
            lastModified: Date.now()
        });
    };

    const toDataUrl = f => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not prepare the image for upload.'));
        r.readAsDataURL(f);
    });
    const renderResult = data => {
        if (!data || typeof data !== 'object') {
            setStatus('Failed', 'danger');
            result.innerHTML = `<div class="ai-error"><i class="fas fa-triangle-exclamation"></i><div><strong>Invalid inspection response</strong><p>The vision model did not return a valid result payload.</p></div></div>`;
            return;
        }

        const detections = Array.isArray(data.detections) ? data.detections : [];
        const count = detections.length;
        const maxConf = Number(data.confidence || 0);

        // Determine visual risk level with safe semantics.
        // Never default missing risk to 'LOW'. Zero detections is INCONCLUSIVE.
        let rawRisk = String(data.visual_risk_level || '').toUpperCase().trim();
        let risk;
        let riskLabel;
        let cls;
        let riskSubtitle;

        if (count === 0) {
            risk = 'INCONCLUSIVE';
            riskLabel = 'INCONCLUSIVE';
            cls = 'warning';
            riskSubtitle = 'Manual review required (0 defects detected)';
        } else {
            // Check for low-confidence detections (all detections or max confidence < 50%)
            const hasStrong = detections.some(d => Number(d.confidence || 0) >= 0.50);
            if (!hasStrong || rawRisk === 'REVIEW_REQUIRED' || rawRisk === 'UNCERTAIN') {
                risk = 'REVIEW_REQUIRED';
                riskLabel = 'REVIEW REQUIRED';
                cls = 'warning';
                riskSubtitle = `${maxConf.toFixed(1)}% max confidence (low-confidence prediction)`;
            } else if (rawRisk === 'CRITICAL') {
                risk = 'CRITICAL';
                riskLabel = 'CRITICAL';
                cls = 'danger';
                riskSubtitle = `${maxConf.toFixed(1)}% max confidence (severe defect)`;
            } else if (rawRisk === 'HIGH') {
                risk = 'HIGH';
                riskLabel = 'HIGH';
                cls = 'danger';
                riskSubtitle = `${maxConf.toFixed(1)}% max confidence (defect evidence)`;
            } else {
                risk = (rawRisk === 'LOW' || !rawRisk) ? 'MEDIUM' : rawRisk;
                riskLabel = risk;
                cls = 'warning';
                riskSubtitle = `${maxConf.toFixed(1)}% max confidence`;
            }
        }

        setStatus(riskLabel, cls);

        const headingNote = count === 0
            ? 'No defects detected above threshold'
            : (cls === 'danger'
                ? 'High-priority defect evidence — verify in field'
                : 'Review detected objects before recording inspection');

        const detectionItemsHtml = count > 0
            ? detections.map((d, i) => {
                const confVal = Number(d.confidence || 0);
                const confPct = (confVal * 100).toFixed(1);
                const isLow = confVal < 0.50;
                const className = escape(d.canonical_class || d.class || 'Unknown defect');
                const boxStr = Array.isArray(d.bbox) ? d.bbox.map(v => Number(v).toFixed(0)).join(', ') : '—';
                return `<div class="ai-detection-item ${isLow ? 'low-conf' : ''}">
                    <span class="ai-detection-index">${i + 1}</span>
                    <div>
                        <strong>${className}</strong>
                        <small>Box: ${boxStr}${isLow ? ' · <span style="color:var(--signal-amber,#b45309);font-weight:600;">Low confidence</span>' : ''}</small>
                    </div>
                    <span class="ai-confidence ${isLow ? 'warning' : ''}">${confPct}%</span>
                </div>`;
            }).join('')
            : `<div class="ai-no-detection warning">
                <i class="fas fa-triangle-exclamation" style="color: var(--signal-amber, #f59e0b);"></i>
                <div>
                    <strong>No defects detected above configured confidence threshold</strong>
                    <small>This does not confirm that the asset is defect-free. Manual inspection is required.</small>
                </div>
            </div>`;

        result.innerHTML = `
            <div class="ai-result-top">
                <div class="ai-risk-score ${cls}">
                    <span>Visual risk</span>
                    <strong>${escape(riskLabel)}</strong>
                    <small>${escape(riskSubtitle)}</small>
                </div>
                <div class="ai-result-kpi">
                    <span>Detections</span>
                    <strong>${count}</strong>
                </div>
                <div class="ai-result-kpi">
                    <span>Model</span>
                    <strong>${escape(data.model || 'YOLO')}</strong>
                </div>
            </div>
            <div class="ai-detection-heading">
                <h4>Detected objects</h4>
                <span>${escape(headingNote)}</span>
            </div>
            <div class="ai-detection-list">${detectionItemsHtml}</div>
            <div class="ai-result-footer">
                <span><i class="fas fa-shield-halved"></i> Advisory visual AI · Requires engineering confirmation</span>
                <button class="btn btn-secondary btn-sm" id="ai-open-inspection"><i class="fas fa-clipboard-check"></i> Record inspection</button>
            </div>
        `;

        document.getElementById('ai-open-inspection')?.addEventListener('click', () => {
            goToSection('inspections');
            window.rkControllers.inspection?.openForm?.();
        });

        if (badge) {
            badge.textContent = data.demo_model ? 'Demo model' : 'Railway model';
            badge.className = `ai-model-badge ${data.demo_model ? 'demo' : 'ready'}`;
        }
        if (note) {
            note.textContent = data.demo_model
                ? 'The bundled YOLO model is working for pipeline demonstration. Train a railway-specific model before using detections as production defect findings.'
                : 'Railway-specific YOLO model is active for this inspection.';
        }
    };
    analyze.addEventListener('click', async () => {
        if (!file || analysisBusy) return;

        analysisBusy = true;
        analyze.disabled = true;
        analyze.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing…';
        setStatus('Preparing','warning');
        result.innerHTML = '<div class="ai-loading"><span class="spinner"></span><h4>Optimizing image</h4><p>Reducing image size before computer-vision analysis.</p></div>';

        try {
            const optimized = await prepareImageForAnalysis(file);
            const dataUrl = await toDataUrl(optimized);

            analyze.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing…';
            setStatus('Analyzing','warning');
            result.innerHTML = '<div class="ai-loading"><span class="spinner"></span><h4>Running computer vision</h4><p>YOLO is analyzing the optimized image.</p></div>';

            const data = await api('/api/yolo/predict', {
                method: 'POST',
                body: JSON.stringify({
                    image_base64: dataUrl,
                    filename: optimized.name
                })
            });

            renderResult(data);
            showToast('Image analysis completed.','success',2200);
        } catch (e) {
            setStatus('Failed','danger');
            result.innerHTML = `<div class="ai-error"><i class="fas fa-triangle-exclamation"></i><div><strong>Inspection could not be completed</strong><p>${escape(e.message || 'YOLO prediction failed.')}</p></div></div>`;
            showToast(e.message || 'YOLO prediction failed.','error',4500);
        } finally {
            analysisBusy = false;
            analyze.disabled = !file;
            analyze.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Analyze image';
        }
    });
    if (badge) { badge.textContent = 'Local model'; badge.className = 'ai-model-badge'; }
}

/* ==========================================================================
   AI Report
   ========================================================================== */
function initAiReport() {
    const generate = document.getElementById('generate-report');
    const csvBtn = document.getElementById('report-csv');
    const pdfBtn = document.getElementById('report-pdf');
    const container = document.getElementById('report-container');
    const assetFilter = document.getElementById('report-asset-filter');
    const riskFilter = document.getElementById('report-risk-filter');
    if (!generate || !container) return;

    const state = { rows: [], meta: null };
    const escape = window.escapeHtml || (v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

    function populateAssetFilter() {
        if (!assetFilter) return;
        const assets = Array.isArray(window.rkData?.assets) ? window.rkData.assets : [];
        const current = assetFilter.value;
        assetFilter.innerHTML = '<option value="">All Assets</option>' + assets.map(a => `<option value="${escape(a.id)}">${escape(a.id)} — ${escape(a.type || 'Asset')}</option>`).join('');
        assetFilter.value = current;
    }
    populateAssetFilter();

    function periodStart(value) {
        const now = new Date();
        const days = { '1month': 30, '3months': 90, '6months': 180, '1year': 365 }[value];
        if (!days) return null;
        return new Date(now.getTime() - days * 86400000);
    }

    function renderReport() {
        const meta = state.meta;
        if (!meta) return;
        const rows = state.rows;
        const counts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
        rows.forEach(r => { if (counts[r.risk] !== undefined) counts[r.risk]++; });
        const failed = rows.filter(r => r.inspection_status === 'Failed').length;
        const pending = rows.filter(r => r.inspection_status === 'Pending').length;
        const maintenance = rows.filter(r => r.asset_status === 'Maintenance').length;
        const ml = rows.filter(r => r.ml_available || r.method === 'tree-ensemble-ml-with-safety-guardrail' || r.method === 'random-forest-ml').length;
        const period = escape(meta.periodLabel);
        container.innerHTML = `
            <div class="report-print-area" id="report-print-area">
                <div class="report-header-row"><div><span class="eyebrow">RAILKAVACH REPORT</span><h3>${escape(meta.title)}</h3><p>Generated from live Supabase data · ${period}</p></div><div class="report-generated">${escape(new Date().toLocaleString())}</div></div>
                <div class="details-grid report-kpis">
                    <div class="detail-item"><span class="detail-label">Assets</span><span class="detail-value">${rows.length}</span></div>
                    <div class="detail-item"><span class="detail-label">Failed</span><span class="detail-value">${failed}</span></div>
                    <div class="detail-item"><span class="detail-label">Pending</span><span class="detail-value">${pending}</span></div>
                    <div class="detail-item"><span class="detail-label">Maintenance</span><span class="detail-value">${maintenance}</span></div>
                    <div class="detail-item"><span class="detail-label">ML Assessed</span><span class="detail-value">${ml}</span></div>
                    <div class="detail-item"><span class="detail-label">Critical</span><span class="detail-value">${counts.CRITICAL}</span></div>
                </div>
                <div class="chart-container report-chart"><canvas id="reportChart"></canvas></div>
                <h4>Asset Risk & Inspection Summary</h4>
                <div class="table-responsive"><table class="data-table report-table"><thead><tr><th>Asset</th><th>Component</th><th>Location</th><th>Status</th><th>Inspection</th><th>Risk</th><th>Score</th><th>Method</th></tr></thead><tbody>
                ${rows.length ? rows.map(r => `<tr><td><strong>${escape(r.asset_id)}</strong></td><td>${escape(r.type)}</td><td>${escape(r.location)}</td><td>${escape(r.asset_status)}</td><td>${escape(r.inspection_status)}</td><td><span class="status-badge ${r.risk==='CRITICAL'||r.risk==='HIGH'?'danger':r.risk==='MEDIUM'?'warning':'success'}">${escape(r.risk)}</span></td><td>${r.score == null ? '—' : escape(String(r.score))+'%'}</td><td>${escape((r.ml_available || r.method === 'tree-ensemble-ml-with-safety-guardrail' || r.method === 'random-forest-ml') ? 'Ensemble ML' : (r.fallback_used || r.ml_unavailable_reason) ? 'Baseline (Fallback)' : 'Baseline')}</td></tr>`).join('') : '<tr><td colspan="8"><div class="empty-state"><p>No matching report records.</p></div></td></tr>'}
                </tbody></table></div>
                <div class="report-findings"><h4>Findings</h4><ul><li>${counts.CRITICAL ? `${counts.CRITICAL} critical asset(s) need immediate review.` : 'No critical assets in this report.'}</li><li>${counts.HIGH ? `${counts.HIGH} high-risk asset(s) should be prioritized.` : 'No high-risk assets in this report.'}</li><li>${failed ? `${failed} failed inspection(s) require follow-up.` : 'No failed inspections in this report.'}</li><li>${pending ? `${pending} inspection(s) are pending.` : 'No pending inspections in this report.'}</li></ul></div>
            </div>`;
        if (csvBtn) csvBtn.disabled = rows.length === 0;
        if (pdfBtn) pdfBtn.disabled = rows.length === 0;
        const ctx = document.getElementById('reportChart')?.getContext('2d');
        if (ctx && window.Chart) {
            if (window.rkReportChart) window.rkReportChart.destroy();
            window.rkReportChart = new Chart(ctx, { type:'bar', data:{labels:['LOW','MEDIUM','HIGH','CRITICAL'],datasets:[{label:'Assets by risk',data:[counts.LOW,counts.MEDIUM,counts.HIGH,counts.CRITICAL],borderWidth:0,borderRadius:6}]}, options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}}} });
        }
    }

    generate.addEventListener('click', async () => {
        const reportType = document.getElementById('report-type')?.value;
        const timePeriod = document.getElementById('time-period')?.value;
        if (!reportType || !timePeriod) { showToast('Select report type and time period', 'warning'); return; }
        populateAssetFilter();
        container.innerHTML = '<div class="loading-inline"><span class="spinner"></span> Generating report from live data…</div>';
        try {
            const assets = Array.isArray(window.rkData?.assets) ? window.rkData.assets : [];
            const inspections = Array.isArray(window.rkData?.inspections) ? window.rkData.inspections : [];
            const start = periodStart(timePeriod);
            const assetId = assetFilter?.value || '';
            const selectedAssets = assets.filter(a => !assetId || String(a.id) === String(assetId));
            const latestByAsset = new Map();
            inspections.filter(i => !start || new Date(i.inspected_at || i.created_at || 0) >= start).sort((a,b)=>new Date(b.inspected_at||b.created_at||0)-new Date(a.inspected_at||a.created_at||0)).forEach(i => { if (!latestByAsset.has(String(i.asset_id))) latestByAsset.set(String(i.asset_id), i); });
            const riskResults = await Promise.all(selectedAssets.map(async a => { try { const x=await api(`/api/risk?asset_id=${encodeURIComponent(a.id)}`); return [String(a.id), x.risk]; } catch { return [String(a.id), null]; } }));
            const riskMap = new Map(riskResults);
            let rows = selectedAssets.map(a => { const i=latestByAsset.get(String(a.id)); const r=riskMap.get(String(a.id)); return {asset_id:a.id,type:a.type||'Asset',location:a.location||'—',asset_status:a.status||'Unknown',inspection_status:i?.status||'Not inspected',risk:String(r?.level||'PENDING').toUpperCase(),score:r?.score ?? null,method:r?.method||'baseline-rule-engine',ml_available:Boolean(r?.ml_available),fallback_used:Boolean(r?.fallback_used),ml_unavailable_reason:r?.ml_unavailable_reason||null,inspected_at:i?.inspected_at||i?.created_at||null}; });
            const rf = riskFilter?.value || '';
            if (rf) rows = rows.filter(r => r.risk === rf);
            const periodLabel = {'1month':'last month','3months':'last 3 months','6months':'last 6 months','1year':'last year'}[timePeriod] || timePeriod;
            state.rows = rows; state.meta = { title: `${reportType.charAt(0).toUpperCase()+reportType.slice(1)} Report`, periodLabel };
            renderReport();
            showToast('Live report generated', 'success', 1800);
        } catch (e) { console.error(e); container.innerHTML='<div class="empty-state"><i class="fas fa-circle-exclamation"></i><p>Could not generate the report.</p></div>'; showToast(e.message||'Could not generate report','error',4000); if(csvBtn)csvBtn.disabled=true;if(pdfBtn)pdfBtn.disabled=true; }
    });

    csvBtn?.addEventListener('click', () => {
        if (!state.rows.length) return;
        const header=['Asset','Component','Location','Asset Status','Inspection','Risk','Score','Method','Inspection Date'];
        const data=[header,...state.rows.map(r=>[r.asset_id,r.type,r.location,r.asset_status,r.inspection_status,r.risk,r.score==null?'':r.score,r.method,r.inspected_at||''])];
        const csv=data.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`railkavach-report-${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500);
    });
    pdfBtn?.addEventListener('click', () => { if (!state.rows.length) return; window.print(); });
}
