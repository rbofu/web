const API = '/api/admin';

let unitsCache = []; // refreshed whenever the Units or Users panel is opened

function unitOptions(includeBlank){
  const opts = unitsCache.map(u => ({ value: String(u.id), label: '— '.repeat(u.depth || 0) + u.name }));
  return includeBlank ? [{ value: '', label: '— Top level (no parent) —' }, ...opts] : opts;
}
const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrator — full site & calendar access' },
  { value: 'leader', label: 'Leader — can see/manage their unit and its sub-units' },
  { value: 'staff', label: 'Staff — can see/manage only their own unit' }
];

async function loadUnitsCache(){
  const res = await fetch(`${API}/collections/units`);
  const flat = await res.json();
  // annotate with depth for indentation, matching backend's tree-walk convention
  const byParent = {};
  flat.forEach(u => { (byParent[String(u.parentId)] = byParent[String(u.parentId)] || []).push(u); });
  const ordered = [];
  (function walk(parentId, depth){
    (byParent[String(parentId)] || []).forEach(u => { ordered.push({ ...u, depth }); walk(u.id, depth + 1); });
  })(null, 0);
  unitsCache = ordered;
  return unitsCache;
}
function unitName(id){
  const u = unitsCache.find(x => String(x.id) === String(id));
  return u ? u.name : '—';
}

const SCHEMAS = {
  news:       { label: 'News', fields: [
                  { key:'title', label:'Title', type:'text' },
                  { key:'category', label:'Category', type:'text' },
                  { key:'date', label:'Date', type:'date' },
                  { key:'image', label:'Image', type:'image' },
                  { key:'excerpt', label:'Excerpt', type:'textarea' }
                ], columns:['title','category','date'] },
  events:     { label: 'Events', fields: [
                  { key:'title', label:'Title', type:'text' },
                  { key:'date', label:'Date', type:'date' },
                  { key:'location', label:'Location', type:'text' },
                  { key:'excerpt', label:'Description', type:'textarea' }
                ], columns:['title','location','date'] },
  activities: { label: 'Activities', fields: [
                  { key:'title', label:'Title', type:'text' },
                  { key:'category', label:'Category', type:'text' },
                  { key:'date', label:'Date', type:'date' },
                  { key:'image', label:'Image', type:'image' },
                  { key:'excerpt', label:'Excerpt', type:'textarea' },
                  { key:'body', label:'Full description', type:'textarea' }
                ], columns:['title','category','date'] },
  diseases:   { label: 'Diseases', fields: [
                  { key:'name', label:'Name', type:'text' },
                  { key:'description', label:'Description', type:'textarea' }
                ], columns:['name','description'] },
  partners:   { label: 'Partners', fields: [
                  { key:'name', label:'Name', type:'text' },
                  { key:'logo', label:'Logo', type:'image' }
                ], columns:['name'] },
  resources:  { label: 'Resources', fields: [
                  { key:'title', label:'Title', type:'text' },
                  { key:'type', label:'Type (e.g. PDF)', type:'text' },
                  { key:'date', label:'Date', type:'date' },
                  { key:'file', label:'File', type:'file' }
                ], columns:['title','type','date'] },
  units:      { label: 'Organisational Units', fields: [
                  { key:'name', label:'Unit name', type:'text' },
                  { key:'parentId', label:'Parent unit', type:'select', options:() => unitOptions(true) }
                ], columns:['name','parentId'], format:{ parentId: v => v ? unitName(v) : '— Top level —' } },
  users:      { label: 'Staff Accounts', fields: [
                  { key:'name', label:'Full name', type:'text' },
                  { key:'username', label:'Username', type:'text' },
                  { key:'email', label:'Email (for calendar reminders)', type:'text' },
                  { key:'password', label:'Password', type:'password' },
                  { key:'role', label:'Role', type:'select', options:() => ROLE_OPTIONS },
                  { key:'unitId', label:'Home unit (what they belong to, and can manage)', type:'select', options:() => unitOptions(false) },
                  { key:'visibilityUnitId', label:'Can see calendar for (their unit by default; pick a higher unit to grant broader visibility)', type:'select', options:() => unitOptions(false) }
                ], columns:['name','username','role','unitId'], format:{ unitId: v => unitName(v), role: v => (ROLE_OPTIONS.find(r=>r.value===v)||{}).label || v } },
};

let currentPanel = 'news';
let editingId = null;

const panelsEl = document.getElementById('panels');
const panelTitleEl = document.getElementById('panelTitle');
const modalBg = document.getElementById('modalBg');
const modalTitle = document.getElementById('modalTitle');
const formFields = document.getElementById('formFields');
const itemForm = document.getElementById('itemForm');
const addBtn = document.getElementById('addBtn');

document.querySelectorAll('.sidebar button[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
});
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/admin/logout', { method:'POST' });
  window.location.href = '/admin/login';
});
document.getElementById('cancelBtn').addEventListener('click', closeModal);

async function switchPanel(name){
  currentPanel = name;
  document.querySelectorAll('.sidebar button[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  addBtn.style.display = (name === 'statistics' || name === 'messages' || name === 'mailOutbox') ? 'none' : 'inline-block';
  if (name === 'units' || name === 'users') await loadUnitsCache();
  if (name === 'statistics'){ panelTitleEl.textContent = 'Statistics'; renderStatistics(); }
  else if (name === 'messages'){ panelTitleEl.textContent = 'Contact Messages'; renderMessages(); }
  else if (name === 'mailOutbox'){ panelTitleEl.textContent = 'Mail Outbox'; renderMailOutbox(); }
  else { panelTitleEl.textContent = SCHEMAS[name].label; renderCollection(name); }
}

async function renderMailOutbox(){
  panelsEl.innerHTML = '<p class="empty">Loading…</p>';
  const res = await fetch(`${API}/mail-outbox`);
  const items = await res.json();
  const banner = `<div style="background:#fff;border:1px solid var(--line);border-radius:4px;padding:14px 18px;margin-bottom:16px;font-size:.85rem;color:var(--muted);display:flex;justify-content:space-between;align-items:center;">
    <span>Reminder emails appear here. Without SMTP settings configured (see README), they are simulated rather than actually sent.</span>
    <button class="btn secondary" id="runRemindersBtn">Check reminders now</button>
  </div>`;
  if (!items.length){ panelsEl.innerHTML = banner + '<p class="empty">No mail sent yet.</p>'; }
  else{
    panelsEl.innerHTML = banner + `<table>
      <thead><tr><th>To</th><th>Subject</th><th>Delivery</th><th>Date</th></tr></thead>
      <tbody>${items.map(m => `
        <tr>
          <td>${escapeHtml((m.to || []).join(', '))}</td>
          <td>${escapeHtml(m.subject)}</td>
          <td>${escapeHtml(m.delivery)}</td>
          <td>${new Date(m.date).toLocaleString()}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  }
  document.getElementById('runRemindersBtn').addEventListener('click', async () => {
    await fetch(`${API}/run-reminders`, { method: 'POST' });
    renderMailOutbox();
  });
}

async function renderCollection(name){
  panelsEl.innerHTML = '<p class="empty">Loading…</p>';
  const base = (name === 'users') ? `${API}/users` : `${API}/collections/${name}`;
  const res = await fetch(base);
  const items = await res.json();
  const schema = SCHEMAS[name];
  if (!items.length){ panelsEl.innerHTML = '<p class="empty">No items yet. Click "Add new" to create one.</p>'; return; }
  const rows = items.map(item => `
    <tr>
      ${schema.columns.map(c => {
        const raw = item[c] ?? '';
        const val = (schema.format && schema.format[c]) ? schema.format[c](raw, item) : raw;
        return `<td>${escapeHtml(String(val)).slice(0,140)}</td>`;
      }).join('')}
      <td class="row-actions">
        <button data-edit="${item.id}">Edit</button>
        <button class="danger" data-del="${item.id}">Delete</button>
      </td>
    </tr>`).join('');
  panelsEl.innerHTML = `
    <table>
      <thead><tr>${schema.columns.map(c => `<th>${c}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  panelsEl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(name, items.find(i => String(i.id)===b.dataset.edit))));
  panelsEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteItem(name, b.dataset.del)));
}

function openModal(name, item){
  editingId = item ? item.id : null;
  modalTitle.textContent = (item ? 'Edit ' : 'Add ') + SCHEMAS[name].label.replace(/s$/, '');
  formFields.innerHTML = SCHEMAS[name].fields.map(f => renderField(f, item)).join('');
  modalBg.classList.add('show');
  SCHEMAS[name].fields.forEach(f => {
    if (f.type === 'image' || f.type === 'file') wireUpload(f);
  });
}

function renderField(f, item){
  const value = item ? (item[f.key] ?? '') : '';
  if (f.type === 'textarea'){
    return `<div class="field"><label for="f_${f.key}">${f.label}</label><textarea id="f_${f.key}" name="${f.key}">${escapeHtml(value)}</textarea></div>`;
  }
  if (f.type === 'select'){
    const opts = f.options();
    return `<div class="field"><label for="f_${f.key}">${f.label}</label>
      <select id="f_${f.key}" name="${f.key}">
        ${opts.map(o => `<option value="${escapeHtml(o.value)}" ${String(value)===String(o.value)?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}
      </select></div>`;
  }
  if (f.type === 'password'){
    return `<div class="field"><label for="f_${f.key}">${f.label}</label>
      <input id="f_${f.key}" name="${f.key}" type="password" autocomplete="new-password" placeholder="${item ? 'Leave blank to keep current password' : 'Set a password'}">
      </div>`;
  }
  if (f.type === 'image' || f.type === 'file'){
    const accept = f.type === 'image' ? 'image/*' : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*';
    return `
      <div class="field">
        <label>${f.label}</label>
        <div class="upload-cols">
          <div>
            <span class="sublabel">Upload from device</span>
            <input type="file" id="pick_${f.key}" accept="${accept}">
            <div class="upload-status" id="status_${f.key}"></div>
          </div>
          <div>
            <span class="sublabel">Or paste a URL</span>
            <input id="f_${f.key}" name="${f.key}" type="text" value="${escapeHtml(value)}" placeholder="https://example.com/image.jpg">
          </div>
        </div>
        ${f.type === 'image' ? `<img id="preview_${f.key}" class="upload-preview" src="${escapeHtml(value)}" style="${value ? '' : 'display:none;'}">` : ''}
        <div class="upload-hint">${f.type === 'image' ? 'Upload JPG, PNG, GIF, WEBP or SVG (up to 10MB), or link to an image already online.' : 'Upload PDF, Word, Excel, PowerPoint or an image (up to 10MB), or link to a file already online.'}</div>
      </div>`;
  }
  return `<div class="field"><label for="f_${f.key}">${f.label}</label><input id="f_${f.key}" name="${f.key}" type="${f.type}" value="${escapeHtml(value)}"></div>`;
}

function wireUpload(f){
  const picker = document.getElementById(`pick_${f.key}`);
  const textInput = document.getElementById(`f_${f.key}`);
  const status = document.getElementById(`status_${f.key}`);
  const preview = document.getElementById(`preview_${f.key}`);
  if (!picker) return;
  if (preview){
    textInput.addEventListener('input', () => {
      preview.src = textInput.value;
      preview.style.display = textInput.value ? '' : 'none';
    });
  }
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file) return;
    status.textContent = 'Uploading…';
    status.style.color = 'var(--muted)';
    try{
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/admin/upload', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      textInput.value = data.url;
      if (preview){ preview.src = data.url; preview.style.display = ''; }
      status.textContent = `Uploaded: ${data.name}`;
      status.style.color = 'var(--teal)';
    }catch(err){
      status.textContent = err.message || 'Upload failed';
      status.style.color = '#c0392b';
    }finally{
      picker.value = '';
    }
  });
}
function closeModal(){ modalBg.classList.remove('show'); editingId = null; }

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const schema = SCHEMAS[currentPanel];
  const body = {};
  schema.fields.forEach(f => {
    const val = document.getElementById('f_' + f.key).value;
    if (f.type === 'password' && !val) return; // don't overwrite password when left blank
    body[f.key] = val;
  });
  const base = (currentPanel === 'users') ? `${API}/users` : `${API}/collections/${currentPanel}`;
  const url = editingId ? `${base}/${editingId}` : base;
  const res = await fetch(url, {
    method: editingId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Could not save. Please check the form and try again.');
    return;
  }
  closeModal();
  if (currentPanel === 'units' || currentPanel === 'users') await loadUnitsCache();
  renderCollection(currentPanel);
});

addBtn.addEventListener('click', () => {
  if (currentPanel === 'statistics' || currentPanel === 'messages') return;
  openModal(currentPanel, null);
});

async function deleteItem(name, id){
  if (!confirm('Delete this item?')) return;
  const base = (name === 'users') ? `${API}/users` : `${API}/collections/${name}`;
  const res = await fetch(`${base}/${id}`, { method:'DELETE' });
  if (!res.ok){
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Could not delete this item.');
    return;
  }
  if (name === 'units') await loadUnitsCache();
  renderCollection(name);
}

async function renderStatistics(){
  panelsEl.innerHTML = '<p class="empty">Loading…</p>';
  const res = await fetch(`${API}/statistics`);
  const stats = await res.json();
  const labels = {
    visitorsToday:'Visitors today', visitorsYesterday:'Visitors yesterday', visitorsWeek:'Visitors this week',
    visitorsTotal:'Total visitors', diseasesTracked:'Diseases tracked', districtsCovered:'Districts covered',
    activeProjects:'Active projects', peopleTreatedMillions:'People reached (millions)'
  };
  panelsEl.innerHTML = `<form class="stat-form" id="statForm">
    ${Object.keys(stats).map(k => `
      <div class="field">
        <label for="s_${k}">${labels[k] || k}</label>
        <input id="s_${k}" name="${k}" type="number" value="${stats[k]}">
      </div>`).join('')}
    <div class="modal-actions"><button class="btn" type="submit">Save statistics</button></div>
  </form>`;
  document.getElementById('statForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    Object.keys(stats).forEach(k => body[k] = Number(document.getElementById('s_' + k).value));
    await fetch(`${API}/statistics`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    alert('Statistics updated.');
  });
}

async function renderMessages(){
  panelsEl.innerHTML = '<p class="empty">Loading…</p>';
  const res = await fetch(`${API}/messages`);
  const items = await res.json();
  if (!items.length){ panelsEl.innerHTML = '<p class="empty">No messages yet.</p>'; return; }
  panelsEl.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Email</th><th>Subject</th><th>Message</th><th>Date</th><th></th></tr></thead>
    <tbody>${items.map(m => `
      <tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.email)}</td>
        <td>${escapeHtml(m.subject || '')}</td>
        <td>${escapeHtml(m.message).slice(0,160)}</td>
        <td>${new Date(m.date).toLocaleString()}</td>
        <td class="row-actions"><button class="danger" data-delmsg="${m.id}">Delete</button></td>
      </tr>`).join('')}</tbody>
  </table>`;
  panelsEl.querySelectorAll('[data-delmsg]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this message?')) return;
    await fetch(`${API}/messages/${b.dataset.delmsg}`, { method:'DELETE' });
    renderMessages();
  }));
}

function escapeHtml(str=''){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

switchPanel('news');
