// ==========================================================================
// NTDCP frontend — shared behaviour + API wiring
// The backend (Express) serves this same origin, so relative /api calls work.
// ==========================================================================
const API = '/api';

/* ---------- Mobile nav + mega menus ---------- */
function initNav(){
  const toggle = document.querySelector('.menu-toggle');
  const list = document.querySelector('.nav-list');
  if (toggle && list){
    toggle.addEventListener('click', () => list.classList.toggle('open'));
  }
  document.querySelectorAll('.nav-list > li').forEach(li => {
    const btn = li.querySelector('button.nav-top');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = li.classList.contains('open');
      document.querySelectorAll('.nav-list > li.open').forEach(o => o.classList.remove('open'));
      if (!isOpen) li.classList.add('open');
    });
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.nav-list > li.open').forEach(o => o.classList.remove('open'));
  });
}

/* ---------- Hero carousel ---------- */
function initHero(){
  const slides = document.querySelectorAll('.hero-slide[data-slide]');
  const dotsWrap = document.querySelector('.hero-dots');
  if (!slides.length || !dotsWrap) return;
  let active = 0;
  slides.forEach((s, i) => {
    const dot = document.createElement('button');
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', () => show(i));
    dotsWrap.appendChild(dot);
  });
  const dots = dotsWrap.querySelectorAll('button');
  function show(i){
    slides[active].style.display = 'none';
    dots[active].classList.remove('active');
    active = i;
    slides[active].style.display = 'flex';
    dots[active].classList.add('active');
  }
  slides.forEach((s, i) => { if (i !== 0) s.style.display = 'none'; });
  setInterval(() => show((active + 1) % slides.length), 6000);
}

/* ---------- Back to top ---------- */
function initBackToTop(){
  const btn = document.querySelector('.back-to-top');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('show', window.scrollY > 400);
  });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ---------- Animated stat counters ---------- */
function animateCounters(){
  const items = document.querySelectorAll('[data-count]');
  if (!items.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.count, 10) || 0;
      let cur = 0;
      const step = Math.max(1, Math.ceil(target / 60));
      const tick = () => {
        cur = Math.min(target, cur + step);
        el.textContent = cur.toLocaleString();
        if (cur < target) requestAnimationFrame(tick);
      };
      tick();
      io.unobserve(el);
    });
  }, { threshold: 0.4 });
  items.forEach(el => io.observe(el));
}

/* ---------- Helpers ---------- */
function fmtDate(iso){
  try{
    return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  }catch(e){ return iso; }
}
function esc(str=''){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function getJSON(path){
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('Request failed: ' + path);
  return res.json();
}

/* ---------- Dynamic sections (populated from the backend API) ---------- */
async function loadStatistics(){
  const wraps = document.querySelectorAll('[data-widget="statistics"]');
  if (!wraps.length) return;
  try{
    const s = await getJSON('/statistics');
    wraps.forEach(wrap => {
      wrap.querySelectorAll('[data-count-key]').forEach(el => {
        const key = el.dataset.countKey;
        if (s[key] !== undefined){
          el.dataset.count = s[key];
          el.textContent = Number(s[key]).toLocaleString();
        }
      });
    });
  }catch(e){ /* keep static fallback markup already in the page */ }
  animateCounters();
}

async function loadEvents(){
  const wrap = document.querySelector('[data-widget="events"]');
  if (!wrap) return;
  try{
    const items = await getJSON('/events?limit=4');
    if (!items.length) return;
    wrap.innerHTML = items.map(ev => `
      <div class="event-item">
        <div class="d">${esc(fmtDate(ev.date))} · ${esc(ev.location || '')}</div>
        <h4>${esc(ev.title)}</h4>
      </div>`).join('');
  }catch(e){ /* fallback stays */ }
}

async function loadNews(){
  const wrap = document.querySelector('[data-widget="news"]');
  if (!wrap) return;
  try{
    const items = await getJSON('/news?limit=' + (wrap.dataset.limit || 4));
    if (!items.length) return;
    wrap.innerHTML = items.map(n => `
      <div class="news-item">
        <img src="${esc(n.image || '/assets/img/placeholder-news.svg')}" alt="">
        <div>
          <h4><a href="media.html">${esc(n.title)}</a></h4>
          <div class="date">Posted ${esc(fmtDate(n.date))}</div>
        </div>
      </div>`).join('');
  }catch(e){ /* fallback stays */ }
}

async function loadResources(){
  const wrap = document.querySelector('[data-widget="resources"]');
  if (!wrap) return;
  try{
    const items = await getJSON('/resources?limit=' + (wrap.dataset.limit || 4));
    if (!items.length) return;
    wrap.innerHTML = items.map(r => `
      <div class="resource-item">
        <div class="ico">${esc((r.type||'PDF').slice(0,3).toUpperCase())}</div>
        <div>
          <h4 style="margin:0 0 4px;font-size:.92rem;"><a href="publications.html">${esc(r.title)}</a></h4>
          <div class="date">Posted ${esc(fmtDate(r.date))}</div>
        </div>
      </div>`).join('');
  }catch(e){ /* fallback stays */ }
}

const THUMB_GRADIENTS = [
  'linear-gradient(135deg,#124d6e,#0e7a72)',
  'linear-gradient(135deg,#256b3f,#0e7a72)',
  'linear-gradient(135deg,#0a2a3f,#256b3f)',
  'linear-gradient(135deg,#0e7a72,#e8a63b)'
];
async function loadActivities(){
  const wrap = document.querySelector('[data-widget="activities"]');
  if (!wrap) return;
  try{
    const items = await getJSON('/activities?limit=' + (wrap.dataset.limit || 4));
    if (!items.length) return;
    wrap.innerHTML = items.map((a, i) => `
      <article class="card">
        <div class="thumb" style="${a.image ? `background-image:url('${esc(a.image)}');background-size:cover;background-position:center;` : `background:${THUMB_GRADIENTS[i % THUMB_GRADIENTS.length]};`}"></div>
        <div class="body">
          <span class="tag">${esc(a.category || 'Activity')}</span>
          <h3>${esc(a.title)}</h3>
          <p>${esc((a.excerpt||'').slice(0,110))}${(a.excerpt||'').length>110?'…':''}</p>
          <div class="meta">${esc(fmtDate(a.date))}</div>
        </div>
        <a class="stretched" href="activity.html?id=${esc(a.id)}" aria-label="${esc(a.title)}"></a>
      </article>`).join('');
  }catch(e){ /* fallback stays */ }
}

const DISEASE_ICONS = [
  '<path d="M12 2c-4 5-7 8.5-7 12.5A7 7 0 0 0 19 14.5C19 10.5 16 7 12 2Z"/>',
  '<path d="M4 12c3-6 6-9 8-9s5 3 8 9c-3 6-6 9-8 9s-5-3-8-9Z"/><circle cx="12" cy="12" r="2.4"/>',
  '<path d="M6 20c0-6 3-9 6-9s6 3 6 9"/><circle cx="12" cy="6" r="3.2"/>',
  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  '<path d="M4 4v16M4 12h16M4 20h16" stroke-linecap="round"/>'
];
async function loadDiseases(){
  const wrap = document.querySelector('[data-widget="diseases"]');
  if (!wrap) return;
  try{
    const items = await getJSON('/diseases');
    if (!items.length) return;
    wrap.innerHTML = items.map((d, i) => `
      <article class="card disease-card">
        <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">${DISEASE_ICONS[i % DISEASE_ICONS.length]}</svg></div>
        <h3>${esc(d.name)}</h3>
        <p>${esc(d.description)}</p>
      </article>`).join('');
  }catch(e){ /* fallback stays */ }
}

async function loadPartners(){
  const wrap = document.querySelector('[data-widget="partners"]');
  if (!wrap) return;
  try{
    const items = await getJSON('/partners');
    if (!items.length) return;
    wrap.innerHTML = items.map(p => `<div class="p-logo">${esc(p.name)}</div>`).join('');
  }catch(e){ /* fallback stays */ }
}

/* ---------- Contact form ---------- */
function initContactForm(){
  const form = document.querySelector('#contact-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('.form-status');
    const data = Object.fromEntries(new FormData(form).entries());
    status.textContent = 'Sending…';
    try{
      const res = await fetch(API + '/contact', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error();
      status.textContent = 'Thank you — your message has been sent. We will respond shortly.';
      status.style.color = 'var(--teal-600)';
      form.reset();
    }catch(err){
      status.textContent = 'Something went wrong. Please try again or email us directly.';
      status.style.color = '#c0392b';
    }
  });
}

/* ---------- Header / footer partials + active nav link ---------- */
async function loadPartials(){
  const headerSlot = document.querySelector('#site-header');
  const footerSlot = document.querySelector('#site-footer');
  const jobs = [];
  if (headerSlot) jobs.push(fetch('partials/header.html').then(r => r.text()).then(html => headerSlot.innerHTML = html));
  if (footerSlot) jobs.push(fetch('partials/footer.html').then(r => r.text()).then(html => footerSlot.innerHTML = html));
  await Promise.all(jobs);
  const page = document.body.dataset.page;
  if (page){
    document.querySelectorAll('.nav-list a[data-page]').forEach(a => {
      if (a.dataset.page === page) a.classList.add('current');
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadPartials();
  initNav();
  initHero();
  initBackToTop();
  animateCounters();
  initContactForm();
  loadStatistics();
  loadEvents();
  loadNews();
  loadResources();
  loadActivities();
  loadDiseases();
  loadPartners();
});
