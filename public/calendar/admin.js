const API = '/api/calendar/admin';
let accounts = [];
let units = [];
let currentUserId = null;

async function init(){
  const context = await renderCalNav('admin');
  if (!context) return;
  currentUserId = context.user.id;

  if (context.user.role !== 'admin'){
    document.getElementById('mainContent').innerHTML = '<div class="denied"><h1>Access denied</h1><p>This page is only available to administrator accounts.</p></div>';
    return;
  }

  const [uRes, aRes] = await Promise.all([fetch(`${API}/units`), fetch(`${API}/accounts`)]);
  units = await uRes.json();
  accounts = await aRes.json();

  const rootUnit = units.find(u => u.depth === 0);
  window.__rootUnitId = rootUnit ? rootUnit.id : null;

  populateUnitSelect('na_unit');
  populateUnitSelect('ea_unit');
  renderStats();
  renderTable();
}

function populateUnitSelect(id){
  document.getElementById(id).innerHTML = units.map(u => `<option value="${u.id}">${u.label}</option>`).join('');
}

function unitName(id){
  const u = units.find(x => String(x.id) === String(id));
  return u ? u.name : '—';
}

function privilegeOf(acc){
  if (acc.role === 'admin' || String(acc.visibilityUnitId) === String(window.__rootUnitId)) return 'admin';
  return 'normal';
}

function renderStats(){
  document.getElementById('onlineCount').textContent = accounts.filter(a => a.online).length;
  document.getElementById('totalCount').textContent = accounts.length;
}

function renderTable(){
  const wrap = document.getElementById('accountsTable');
  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Full name</th><th>Username</th><th>Unit</th><th>Role</th><th>Privilege</th>
      <th>Online</th><th>Logins</th><th>Uploads</th><th>Reports</th><th></th>
    </tr></thead>
    <tbody>${accounts.map(a => `
      <tr>
        <td><a data-edit="${a.id}">${esc(a.name)}</a></td>
        <td>${esc(a.username)}</td>
        <td>${esc(unitName(a.unitId))}</td>
        <td><span class="role-badge ${a.role==='admin'?'admin':''}">${esc(a.role)}</span></td>
        <td>
          <select data-privilege="${a.id}">
            <option value="normal" ${privilegeOf(a)==='normal'?'selected':''}>Normal (own unit)</option>
            <option value="admin" ${privilegeOf(a)==='admin'?'selected':''}>Administration (all units)</option>
          </select>
        </td>
        <td><span class="online-dot ${a.online?'on':'off'}"></span>${a.online?'Online':'Offline'}</td>
        <td>${a.loginCount || 0} total${a.lastLoginAt ? '<br><span style="color:var(--muted);">' + new Date(a.lastLoginAt).toLocaleString() + '</span>' : ''}</td>
        <td><label class="toggle"><input type="checkbox" data-toggle="canUpload" data-id="${a.id}" ${a.canUpload?'checked':''}><span class="slider"></span></label></td>
        <td><label class="toggle"><input type="checkbox" data-toggle="canReport" data-id="${a.id}" ${a.canReport?'checked':''}><span class="slider"></span></label></td>
        <td class="row-actions">
          <a data-edit="${a.id}">Edit</a>
          <input type="password" placeholder="New password" data-pw="${a.id}">
          <a data-reset="${a.id}">Reset</a>
          ${a.id === currentUserId ? '<div class="you-tag">You</div>' : `<a data-remove="${a.id}" class="danger">Remove</a>`}
        </td>
      </tr>`).join('')}</tbody>
  </table>`;

  wrap.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => openEditModal(el.dataset.edit)));
  wrap.querySelectorAll('[data-privilege]').forEach(el => el.addEventListener('change', () => setPrivilege(el.dataset.privilege, el.value)));
  wrap.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('change', () => toggleFlag(el.dataset.id, el.dataset.toggle, el.checked)));
  wrap.querySelectorAll('[data-reset]').forEach(el => el.addEventListener('click', () => resetPassword(el.dataset.reset)));
  wrap.querySelectorAll('[data-remove]').forEach(el => el.addEventListener('click', () => removeAccount(el.dataset.remove)));
}

async function setPrivilege(id, value){
  const acc = accounts.find(a => String(a.id) === String(id));
  const visibilityUnitId = value === 'admin' ? window.__rootUnitId : acc.unitId;
  const res = await fetch(`${API}/accounts/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibilityUnitId })
  });
  if (res.ok) refresh(); else alert('Could not update privilege.');
}

async function toggleFlag(id, flag, value){
  const res = await fetch(`${API}/accounts/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [flag]: value })
  });
  if (!res.ok) alert('Could not update this setting.');
}

async function resetPassword(id){
  const input = document.querySelector(`[data-pw="${id}"]`);
  if (!input.value){ alert('Enter a new password first.'); return; }
  const res = await fetch(`${API}/accounts/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value })
  });
  if (res.ok){ input.value = ''; alert('Password reset.'); } else alert('Could not reset password.');
}

async function removeAccount(id){
  if (!confirm('Remove this account? This cannot be undone.')) return;
  const res = await fetch(`${API}/accounts/${id}`, { method: 'DELETE' });
  if (res.ok) refresh(); else { const err = await res.json().catch(()=>({})); alert(err.error || 'Could not remove this account.'); }
}

function openEditModal(id){
  const a = accounts.find(x => String(x.id) === String(id));
  document.getElementById('editForm').dataset.id = id;
  document.getElementById('ea_name').value = a.name;
  document.getElementById('ea_email').value = a.email || '';
  document.getElementById('ea_mobile').value = a.mobile || '';
  document.getElementById('ea_unit').value = a.unitId;
  document.getElementById('ea_role').value = a.role;
  document.getElementById('editModalBg').classList.add('show');
}
document.getElementById('editCancelBtn').addEventListener('click', () => document.getElementById('editModalBg').classList.remove('show'));
document.getElementById('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = e.target.dataset.id;
  const body = {
    name: document.getElementById('ea_name').value,
    email: document.getElementById('ea_email').value,
    mobile: document.getElementById('ea_mobile').value,
    unitId: document.getElementById('ea_unit').value,
    role: document.getElementById('ea_role').value,
  };
  const res = await fetch(`${API}/accounts/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (res.ok){ document.getElementById('editModalBg').classList.remove('show'); refresh(); }
  else alert('Could not save changes.');
});

document.getElementById('newAccountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const unitId = document.getElementById('na_unit').value;
  const privilege = document.getElementById('na_privilege').value;
  const body = {
    name: document.getElementById('na_name').value,
    username: document.getElementById('na_username').value,
    password: document.getElementById('na_password').value,
    email: document.getElementById('na_email').value,
    mobile: document.getElementById('na_mobile').value,
    education: document.getElementById('na_education').value,
    unitId,
    role: document.getElementById('na_role').value,
    visibilityUnitId: privilege === 'admin' ? window.__rootUnitId : unitId,
  };
  const res = await fetch(`${API}/accounts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (res.ok){ e.target.reset(); refresh(); }
  else { const err = await res.json().catch(()=>({})); alert(err.error || 'Could not create account.'); }
});

document.getElementById('deleteAllBtn').addEventListener('click', async () => {
  if (!confirm('This will permanently delete EVERY activity in the system, including attachments. Are you sure?')) return;
  if (!confirm('Really sure? This cannot be undone.')) return;
  const res = await fetch(`${API}/activities`, { method: 'DELETE' });
  if (res.ok) alert('All activities deleted.'); else alert('Could not delete activities.');
});

async function refresh(){
  const aRes = await fetch(`${API}/accounts`);
  accounts = await aRes.json();
  renderStats();
  renderTable();
}

init();
