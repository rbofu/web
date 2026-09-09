const API = '/api/calendar';

async function init(){
  const context = await renderCalNav('profile');
  if (!context) return;

  const res = await fetch(`${API}/me`);
  const me = await res.json();

  document.getElementById('p_username').value = me.username;
  document.getElementById('p_name').value = me.name;
  document.getElementById('p_email').value = me.email || '';
  document.getElementById('p_mobile').value = me.mobile || '';
  document.getElementById('p_education').value = me.education || '';
  document.getElementById('p_unit').value = me.unitName;
  document.getElementById('p_role').value = me.role;
  document.getElementById('p_privilege').value = me.privilegeLabel;
}

document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  const body = {
    name: document.getElementById('p_name').value,
    email: document.getElementById('p_email').value,
    mobile: document.getElementById('p_mobile').value,
    education: document.getElementById('p_education').value,
  };
  const password = document.getElementById('p_password').value;
  if (password) body.password = password;

  const res = await fetch(`${API}/me`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (res.ok){
    status.textContent = 'Profile updated.';
    status.style.color = 'var(--teal)';
    document.getElementById('p_password').value = '';
  } else {
    status.textContent = 'Could not update your profile.';
    status.style.color = '#c0392b';
  }
});

init();
