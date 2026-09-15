const statusEl = document.getElementById('admin-status');
const bodyEl = document.getElementById('users-body');
const loadingEl = document.getElementById('users-loading');
const tableEl = document.getElementById('users-table');
const emptyEl = document.getElementById('users-empty');
const modal = document.getElementById('user-modal');

let users = [];
let currentUserId = null;

function status(message='', type='') {
    statusEl.textContent = message;
    statusEl.className = `status-msg ${type}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function roleLabel(role) {
    return {admin:'Admin', manager:'Manager', inspector:'Inspector', operator:'Operator'}[role] || role;
}

function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'2-digit'});
}

async function request(url, options={}) {
    const res = await fetch(url, {credentials:'include', headers:{'Content-Type':'application/json', ...(options.headers||{})}, ...options});
    let data={}; try { data=await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
}

function initials(name) {
    return String(name || 'U').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
}

function updateStats() {
    document.getElementById('stat-total').textContent = users.length;
    document.getElementById('stat-active').textContent = users.filter(u=>u.isActive).length;
    document.getElementById('stat-admin').textContent = users.filter(u=>u.role==='admin').length;
    document.getElementById('stat-google').textContent = users.filter(u=>Boolean(u.googleId)).length;
}

function filteredUsers() {
    const q = document.getElementById('user-search').value.trim().toLowerCase();
    const role = document.getElementById('role-filter').value;
    const statusFilter = document.getElementById('status-filter').value;
    return users.filter(u => {
        const matchQ = !q || `${u.name} ${u.email}`.toLowerCase().includes(q);
        const matchRole = !role || u.role === role;
        const matchStatus = !statusFilter || (statusFilter==='active' ? u.isActive : !u.isActive);
        return matchQ && matchRole && matchStatus;
    });
}

function renderUsers() {
    const rows = filteredUsers();
    bodyEl.innerHTML = '';
    loadingEl.style.display = 'none';
    tableEl.style.display = rows.length ? 'table' : 'none';
    emptyEl.style.display = rows.length ? 'none' : 'block';

    rows.forEach(user => {
        const tr=document.createElement('tr');
        const login = user.googleId ? '<span class="badge active"><i class="fab fa-google"></i>&nbsp; Google</span>' : '<span class="badge" style="background:#f2f4f7;color:#667085">Password</span>';
        tr.innerHTML = `
          <td><div class="user-cell"><div class="avatar">${escapeHtml(initials(user.name))}</div><div><div class="user-name">${escapeHtml(user.name)}</div><div class="user-email">${escapeHtml(user.email)}</div></div></div></td>
          <td><select class="role" aria-label="Role for ${escapeHtml(user.name)}"><option value="operator">Operator</option><option value="inspector">Inspector</option><option value="manager">Manager</option><option value="admin">Admin</option></select></td>
          <td><span class="badge ${user.isActive?'active':'inactive'}">${user.isActive?'Active':'Inactive'}</span></td>
          <td>${login}</td>
          <td>${formatDate(user.createdAt)}</td>
          <td><div class="actions"><button class="icon-btn save" title="Save changes"><i class="fas fa-floppy-disk"></i></button><button class="icon-btn toggle" title="${user.isActive?'Deactivate user':'Activate user'}"><i class="fas ${user.isActive?'fa-user-slash':'fa-user-check'}"></i></button></div></td>`;
        tr.querySelector('.role').value=user.role;

        tr.querySelector('.save').onclick=async()=>{
            const role=tr.querySelector('.role').value;
            try{
                await request(`/api/users?id=${encodeURIComponent(user.id)}`,{method:'PATCH',body:JSON.stringify({role})});
                status(`${user.name} updated successfully.`,'success');
                await loadUsers(false);
            }catch(e){status(e.message,'error');}
        };

        tr.querySelector('.toggle').onclick=async()=>{
            if (user.id === currentUserId && user.isActive) {
                status('You cannot deactivate your own admin account.','error');
                return;
            }
            const next=!user.isActive;
            const action=next?'activate':'deactivate';
            if(!confirm(`Are you sure you want to ${action} ${user.name}?`)) return;
            try{
                await request(`/api/users?id=${encodeURIComponent(user.id)}`,{method:'PATCH',body:JSON.stringify({is_active:next})});
                status(`${user.name} is now ${next?'active':'inactive'}.`,'success');
                await loadUsers(false);
            }catch(e){status(e.message,'error');}
        };
        bodyEl.appendChild(tr);
    });
}

async function loadUsers(showLoading=true) {
    if(showLoading){loadingEl.style.display='block';tableEl.style.display='none';emptyEl.style.display='none';}
    try{
        const me=await request('/api/me');
        currentUserId=me.user?.id || null;
        const data=await request('/api/users');
        users=data.users||[];
        updateStats();
        renderUsers();
    }catch(e){
        if(/401|403|admin access/i.test(e.message)){window.location.href='index.html';return;}
        status(e.message,'error');
        loadingEl.style.display='none';
    }
}

function openModal(){modal.style.display='flex';setTimeout(()=>document.getElementById('name').focus(),20);}
function closeModal(){modal.style.display='none';document.getElementById('create-user-form').reset();document.getElementById('strength-bar').style.width='0';status('');}

document.getElementById('open-create').onclick=openModal;
document.getElementById('close-modal').onclick=closeModal;
document.getElementById('cancel-create').onclick=closeModal;
modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
document.getElementById('back-btn').onclick=()=>window.location.href='index.html';
document.getElementById('refresh-users').onclick=()=>loadUsers(true);
['user-search','role-filter','status-filter'].forEach(id=>document.getElementById(id).addEventListener('input',renderUsers));
document.getElementById('toggle-password').onclick=()=>{
    const input=document.getElementById('password'), icon=document.querySelector('#toggle-password i');
    input.type=input.type==='password'?'text':'password';
    icon.className=input.type==='password'?'fas fa-eye':'fas fa-eye-slash';
};
document.getElementById('password').addEventListener('input',e=>{
    const p=e.target.value; let score=0;
    if(p.length>=8)score++; if(/[A-Z]/.test(p))score++; if(/[a-z]/.test(p))score++; if(/\d/.test(p))score++; if(/[^A-Za-z0-9]/.test(p))score++;
    const bar=document.getElementById('strength-bar');
    bar.style.width=`${score*20}%`;
    bar.style.background=score<=2?'#c73535':score<=3?'#b26a00':'#16834d';
});

document.getElementById('create-user-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const payload={name:document.getElementById('name').value.trim(),email:document.getElementById('email').value.trim(),password:document.getElementById('password').value,role:document.getElementById('role').value};
    if(payload.password.length<8){status('Use a password with at least 8 characters.','error');return;}
    try{
        await request('/api/users',{method:'POST',body:JSON.stringify(payload)});
        closeModal();
        status(`${payload.name} was created successfully.`,'success');
        await loadUsers(false);
    }catch(e){status(e.message,'error');}
});

loadUsers();
