let posts = [];
let editingId = null;
let isAuthor = false;
let isLoggedIn = false;
let activeCategory = null;
let activeSubcategory = null;

const listEl = document.getElementById('post-list');
const detailEl = document.getElementById('post-detail');
const viewList = document.getElementById('view-list');
const viewForm = document.getElementById('view-form');
const viewRequests = document.getElementById('view-requests');
const viewProfile = document.getElementById('view-profile');
const viewAdmin = document.getElementById('view-admin');
const viewSubmissions = document.getElementById('view-submissions');
const viewSubsRequests = document.getElementById('view-subs-requests');
const ALL_VIEWS = [viewList, viewForm, viewRequests, viewProfile, viewAdmin, viewSubmissions, viewSubsRequests];

function arrowSVG(){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
}
function escapeHtml(s){
  const d = document.createElement('div');
  d.innerText = s;
  return d.innerHTML;
}
function toBnDigits(n){
  const bn = ['০','১','২','৩','৪','৫','৬','৭','৮','৯'];
  return String(n).split('').map(c => /[0-9]/.test(c) ? bn[+c] : c).join('');
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'অজানা সমস্যা হয়েছে।');
    err.status = res.status;
    throw err;
  }
  return data;
}

async function loadPosts(){
  try{
    posts = await api('/posts');
    renderList();
  }catch(e){
    listEl.innerHTML = `<div class="empty-state"><p>লেখাগুলো লোড করা যায়নি। সার্ভার চালু আছে কিনা যাচাই করুন।</p></div>`;
  }
}

// ==================== ক্যাটাগরি নেভিগেশন ====================

function renderCategoryNav(){
  const nav = document.getElementById('category-nav');
  const menuItems = isLoggedIn
    ? `<button class="more-menu-item" id="menu-write-btn">লিখুন</button>
       <button class="more-menu-item" data-view="profile">প্রোফাইল</button>
       ${isAuthor ? `<button class="more-menu-item" data-view="admin">ড্যাশবোর্ড</button>` : ''}`
    : `<button class="more-menu-item" data-view="admin">লগইন</button>`;

  nav.innerHTML = Object.keys(CATEGORIES).map(cat => `
    <button class="nav-btn cat-btn ${activeCategory === cat ? 'active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
  `).join('') + `
    <div class="more-menu-wrap">
      <button class="nav-btn more-btn" id="more-btn" aria-label="আরও অপশন">⋮</button>
      <div class="more-menu" id="more-menu">
        ${menuItems}
      </div>
    </div>
  `;
  nav.querySelectorAll('.cat-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> selectCategory(btn.dataset.cat, null, true));
  });

  const moreBtn = document.getElementById('more-btn');
  const moreMenu = document.getElementById('more-menu');
  moreBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    moreMenu.classList.toggle('open');
  });

  const writeBtn = document.getElementById('menu-write-btn');
  if(writeBtn){
    writeBtn.addEventListener('click', ()=>{
      moreMenu.classList.remove('open');
      openForm(null);
    });
  }
  nav.querySelectorAll('.more-menu-item[data-view]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      moreMenu.classList.remove('open');
      activeCategory = null; activeSubcategory = null; renderCategoryNav();
      showView(btn.dataset.view);
    });
  });

  renderSubcategoryRow();
}

// একবারই রেজিস্টার করা — মেনুর বাইরে ক্লিক করলে খোলা "আরও অপশন" মেনু বন্ধ হয়ে যাবে
document.addEventListener('click', ()=>{
  const openMenu = document.querySelector('.more-menu.open');
  if(openMenu) openMenu.classList.remove('open');
});

function renderSubcategoryRow(){
  const row = document.getElementById('subcategory-row');
  if(!activeCategory){
    row.innerHTML = '';
    row.classList.remove('active');
    return;
  }
  const subs = CATEGORIES[activeCategory] || [];
  row.classList.add('active');
  row.innerHTML = `
    <button class="sub-tag ${!activeSubcategory ? 'active' : ''}" data-sub="">সব</button>
    ${subs.map(sub => `<button class="sub-tag ${activeSubcategory === sub ? 'active' : ''}" data-sub="${escapeHtml(sub)}">${escapeHtml(sub)}</button>`).join('')}
  `;
  row.querySelectorAll('.sub-tag').forEach(btn=>{
    btn.addEventListener('click', ()=> selectCategory(activeCategory, btn.dataset.sub || null, true));
  });
}

function categoryPath(cat, sub){
  if(!cat) return '/';
  const slug = CATEGORY_SLUGS[cat];
  if(!slug) return '/';
  return sub ? `/category/${slug}/${encodeURIComponent(sub)}` : `/category/${slug}`;
}

function selectCategory(cat, sub, push){
  activeCategory = cat;
  activeSubcategory = sub;
  renderCategoryNav();
  showView('list', false);
  if(push !== false){
    history.pushState({view:'category', cat, sub}, '', categoryPath(cat, sub));
  }
}

function goHome(push){
  activeCategory = null;
  activeSubcategory = null;
  renderCategoryNav();
  showView('list', false);
  if(push !== false){
    history.pushState({}, '', '/');
  }
}

// ==================== ভিউ সুইচিং ====================

const STATIC_VIEW_PATHS = {
  list: '/', admin: '/admin', profile: '/profile',
  requests: '/requests', submissions: '/submissions', 'subs-requests': '/subs-requests',
};

function showView(name, push){
  ALL_VIEWS.forEach(v=>v.classList.remove('active'));
  detailEl.innerHTML = '';
  if(name==='list') viewList.classList.add('active');
  if(name==='form') viewForm.classList.add('active');
  if(name==='requests'){
    if(!isAuthor){ showView('admin', push); return; }
    viewRequests.classList.add('active');
    loadPaymentRequests();
  }
  if(name==='profile'){
    viewProfile.classList.add('active');
    loadProfile();
  }
  if(name==='admin'){
    viewAdmin.classList.add('active');
    renderAdminView();
  }
  if(name==='submissions'){
    if(!isAuthor){ showView('admin', push); return; }
    viewSubmissions.classList.add('active');
    loadSubmissions();
  }
  if(name==='subs-requests'){
    if(!isAuthor){ showView('admin', push); return; }
    viewSubsRequests.classList.add('active');
    loadSubsRequests();
  }
  // URL ঠিকানা বার সবসময় বর্তমানে দেখানো পাতার সাথে মিলিয়ে রাখা — যে জায়গা থেকেই showView() ডাকা হোক না কেন
  if(push !== false && STATIC_VIEW_PATHS[name]){
    history.pushState({}, '', STATIC_VIEW_PATHS[name]);
  }
  window.scrollTo({top:0, behavior:'smooth'});
}

// ==================== পোস্ট তালিকা ====================

function renderList(){
  const filtered = posts.filter(p => {
    if(!activeCategory) return true;
    if(p.category !== activeCategory) return false;
    if(activeSubcategory && p.subcategory !== activeSubcategory) return false;
    return true;
  });

  if(filtered.length === 0){
    listEl.innerHTML = `<div class="empty-state"><p>${activeCategory ? 'এই ক্যাটাগরিতে এখনো কোনো লেখা নেই।' : 'এখনো কোনো লেখা নেই।'}</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map(p => `
    <article class="post-item" data-id="${p.id}">
      <div class="post-meta">
        <span>${p.date}</span><span class="dot"></span><span>পড়তে ${p.readTime}</span>
        ${p.isPaid ? `<span class="price-badge">৳${toBnDigits(p.price)}</span>` : ''}
        ${p.category ? `<span class="cat-tag">${escapeHtml(p.category)}${p.subcategory ? ' · ' + escapeHtml(p.subcategory) : ''}</span>` : ''}
      </div>
      <h2 class="post-title">${escapeHtml(p.title)}</h2>
      <p class="post-excerpt">${escapeHtml(p.excerpt)}</p>
      <span class="read-more">পুরো লেখাটি পড়ুন ${arrowSVG()}</span>
    </article>
  `).join('');
  document.querySelectorAll('.post-item').forEach(el=>{
    el.addEventListener('click', ()=> openPost(el.dataset.id));
  });
}

// ==================== একক পোস্ট ====================

async function openPost(id, push){
  let p;
  try{
    p = await api('/posts/' + encodeURIComponent(id));
  }catch(e){
    alert('লেখাটি লোড করা যায়নি।');
    return;
  }
  ALL_VIEWS.forEach(v=>v.classList.remove('active'));
  const bodyHtml = p.locked
    ? await renderPaywall(p)
    : `<div class="post-body">${p.body.map(par=>`<p>${escapeHtml(par)}</p>`).join('')}</div>`;

  detailEl.innerHTML = `
    <div class="post-full">
      <button class="back-btn" id="back-btn">${arrowSVG()} সব লেখায় ফিরে যান</button>
      <div class="post-meta">
        <span>${p.date}</span><span class="dot"></span><span>পড়তে ${p.readTime}</span>
        ${p.isPaid ? `<span class="price-badge">৳${toBnDigits(p.price)}</span>` : ''}
        ${p.category ? `<span class="cat-tag">${escapeHtml(p.category)}${p.subcategory ? ' · ' + escapeHtml(p.subcategory) : ''}</span>` : ''}
      </div>
      <h1 class="post-title">${escapeHtml(p.title)}</h1>
      <div class="post-actions">
        <button class="copy-link-btn" id="copy-link-btn">লিংক কপি করুন</button>
        ${isAuthor ? `
        <button id="edit-btn">সম্পাদনা করুন</button>
        <button class="delete-btn" id="delete-btn">মুছে ফেলুন</button>
        <button class="stats-toggle" id="stats-toggle">পরিসংখ্যান</button>` : ''}
      </div>
      <div id="stats-panel"></div>
      ${bodyHtml}
    </div>
  `;
  if(push !== false){
    history.pushState({view:'post', id:p.id}, '', '/post/' + encodeURIComponent(p.id));
  }
  document.getElementById('back-btn').addEventListener('click', ()=> history.back());
  document.getElementById('copy-link-btn').addEventListener('click', ()=> copyPostLink(p.id));
  if(p.locked){
    wirePaywallForm(p);
  }
  if(isAuthor){
    document.getElementById('edit-btn').addEventListener('click', ()=> openForm(p));
    document.getElementById('stats-toggle').addEventListener('click', ()=> toggleStats(p.id));
    document.getElementById('delete-btn').addEventListener('click', async ()=>{
      if(!confirm('এই লেখাটি স্থায়ীভাবে মুছে ফেলতে চান?')) return;
      try{
        await api('/posts/' + encodeURIComponent(p.id), { method: 'DELETE' });
        await loadPosts();
        showView('admin');
      }catch(e){
        alert(e.message);
      }
    });
  }
  window.scrollTo({top:0, behavior:'smooth'});
}

function copyPostLink(id){
  const url = window.location.origin + '/post/' + encodeURIComponent(id);
  const btn = document.getElementById('copy-link-btn');
  const done = () => { const old = btn.textContent; btn.textContent = 'কপি হয়েছে ✓'; setTimeout(()=> btn.textContent = old, 2000); };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(done).catch(()=> prompt('লিংকটি কপি করুন:', url));
  } else {
    prompt('লিংকটি কপি করুন:', url);
  }
}

let statsVisible = false;
async function toggleStats(postId){
  const panel = document.getElementById('stats-panel');
  if(statsVisible){
    panel.innerHTML = '';
    statsVisible = false;
    return;
  }
  panel.innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  statsVisible = true;
  try{
    const s = await api('/posts/' + encodeURIComponent(postId) + '/stats');
    const dailyRows = s.daily.map(d => `<tr><td>${escapeHtml(d.date)}</td><td>${toBnDigits(d.count)}</td></tr>`).join('');
    const monthlyRows = s.monthly.map(m => `<tr><td>${escapeHtml(m.month)}</td><td>${toBnDigits(m.count)}</td></tr>`).join('');
    panel.innerHTML = `
      <div class="stats-panel">
        <div class="stats-summary">
          <div><strong>${toBnDigits(s.total)}</strong>মোট ভিউ</div>
        </div>
        <p class="hint">সাম্প্রতিক দিনগুলো</p>
        <table class="stats-table">${dailyRows || '<tr><td colspan="2">কোনো ডেটা নেই</td></tr>'}</table>
        <p class="hint" style="margin-top:14px;">মাস অনুযায়ী</p>
        <table class="stats-table">${monthlyRows || '<tr><td colspan="2">কোনো ডেটা নেই</td></tr>'}</table>
      </div>
    `;
  }catch(e){
    panel.innerHTML = `<div class="stats-panel"><p>পরিসংখ্যান লোড করা যায়নি।</p></div>`;
  }
}

// ==================== লেখার ফর্ম ====================

function populateCategorySelects(selectedCat, selectedSub){
  const catEl = document.getElementById('f-category');
  const subEl = document.getElementById('f-subcategory');
  catEl.innerHTML = '<option value="">— বাছাই করুন —</option>' +
    Object.keys(CATEGORIES).map(c => `<option value="${escapeHtml(c)}" ${c===selectedCat?'selected':''}>${escapeHtml(c)}</option>`).join('');
  function refreshSubs(){
    const cat = catEl.value;
    const subs = CATEGORIES[cat] || [];
    subEl.innerHTML = '<option value="">— ঐচ্ছিক —</option>' +
      subs.map(s => `<option value="${escapeHtml(s)}" ${s===selectedSub?'selected':''}>${escapeHtml(s)}</option>`).join('');
    subEl.disabled = subs.length === 0;
  }
  catEl.onchange = refreshSubs;
  refreshSubs();
}

function openForm(existingPost, push){
  if(existingPost && !isAuthor){ showView('admin'); return; } // সম্পাদনা শুধু লেখকের জন্য
  if(!existingPost && !isLoggedIn){ showView('admin'); return; } // নতুন লেখা জমা দিতে অন্তত লগইন দরকার
  editingId = existingPost ? existingPost.id : null;
  const errEl = document.getElementById('form-error');
  errEl.style.display = 'none';
  const titleEl = document.getElementById('f-title');
  const excerptEl = document.getElementById('f-excerpt');
  const priceEl = document.getElementById('f-price');
  const priceFieldEl = document.getElementById('f-price-field');
  const bodyEl = document.getElementById('f-body');
  const formHeader = document.getElementById('form-title');
  const saveBtn = document.getElementById('save-btn');
  const submissionNote = document.getElementById('submission-note');

  // পাঠক শুধু নতুন লেখা জমা দিতে পারেন, মূল্য ঠিক করা লেখকের এখতিয়ার
  priceFieldEl.style.display = isAuthor ? '' : 'none';
  submissionNote.style.display = (!editingId && !isAuthor) ? '' : 'none';

  if(editingId){
    formHeader.textContent = 'লেখা সম্পাদনা করুন';
    saveBtn.textContent = 'হালনাগাদ করুন';
    titleEl.value = existingPost.title;
    excerptEl.value = existingPost.excerpt;
    priceEl.value = existingPost.price ? existingPost.price : '';
    bodyEl.value = existingPost.body.join('\n\n');
    populateCategorySelects(existingPost.category, existingPost.subcategory);
  } else {
    formHeader.textContent = isAuthor ? 'নতুন লেখা যোগ করুন' : 'লেখা জমা দিন';
    saveBtn.textContent = isAuthor ? 'প্রকাশ করুন' : 'জমা দিন';
    titleEl.value = '';
    excerptEl.value = '';
    priceEl.value = '';
    bodyEl.value = '';
    populateCategorySelects(null, null);
  }
  showView('form');
  if(!editingId && push !== false){
    history.pushState({}, '', '/write'); // যাতে ঠিকানা বারে সঠিক পাতা দেখায়, আগের পাতার URL আটকে না থাকে
  }
}

document.getElementById('save-btn').addEventListener('click', async ()=>{
  if(!isLoggedIn){ showView('admin'); return; }
  const errEl = document.getElementById('form-error');
  const title = document.getElementById('f-title').value.trim();
  const excerpt = document.getElementById('f-excerpt').value.trim();
  const priceRaw = document.getElementById('f-price').value.trim();
  const bodyRaw = document.getElementById('f-body').value.trim();
  const category = document.getElementById('f-category').value || null;
  const subcategory = document.getElementById('f-subcategory').value || null;
  const body = bodyRaw.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);

  if(!title || !body.length){
    errEl.textContent = 'শিরোনাম ও লেখার মূল অংশ আবশ্যক।';
    errEl.style.display = 'block';
    return;
  }
  if(isAuthor && priceRaw && (isNaN(Number(priceRaw)) || Number(priceRaw) < 0)){
    errEl.textContent = 'মূল্য সঠিক নয়।';
    errEl.style.display = 'block';
    return;
  }
  const price = (isAuthor && priceRaw) ? Number(priceRaw) : 0;

  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'সংরক্ষণ হচ্ছে…';

  try{
    if(editingId){
      const payload = { title, excerpt, body, price, category, subcategory };
      await api('/posts/' + encodeURIComponent(editingId), { method: 'PUT', body: JSON.stringify(payload) });
      editingId = null;
      await loadPosts();
      showView('admin');
    } else if(isAuthor){
      const payload = { title, excerpt, body, price, category, subcategory };
      await api('/posts', { method: 'POST', body: JSON.stringify(payload) });
      await loadPosts();
      showView('admin');
    } else {
      const payload = { title, excerpt, body, category, subcategory };
      await api('/submissions', { method: 'POST', body: JSON.stringify(payload) });
      alert('আপনার লেখাটি জমা হয়েছে। লেখক অনুমোদন দিলে প্রকাশিত হবে।');
      showView('list');
    }
  }catch(e){
    errEl.textContent = e.message;
    errEl.style.display = 'block';
    if(e.status === 401){
      isLoggedIn = false;
      isAuthor = false;
      renderCategoryNav();
    }
  }finally{
    saveBtn.disabled = false;
    saveBtn.textContent = editingId ? 'হালনাগাদ করুন' : (isAuthor ? 'প্রকাশ করুন' : 'জমা দিন');
  }
});

document.getElementById('cancel-btn').addEventListener('click', ()=>{
  editingId = null;
  showView(isAuthor ? 'admin' : 'list');
});

// ==================== লগো / স্ট্যাটিক নেভিগেশন ====================

document.getElementById('logo-link').addEventListener('click', ()=> goHome());

// ==================== লগইন / রেজিস্ট্রেশন / এডমিন ড্যাশবোর্ড (/admin) ====================

async function checkSession(){
  try{
    const data = await api('/auth/me');
    isLoggedIn = !!data.loggedIn;
    isAuthor = !!data.isAuthor;
  }catch(e){
    isLoggedIn = false;
    isAuthor = false;
  }
}

function renderAdminView(){
  const loginBox = document.getElementById('login-box');
  const registerBox = document.getElementById('register-box');
  const dashboard = document.getElementById('admin-dashboard');
  [loginBox, registerBox, dashboard].forEach(el => el.style.display = 'none');

  if(!isLoggedIn){
    loginBox.style.display = '';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-phone').value = '';
    document.getElementById('login-password').value = '';
    return;
  }
  if(isAuthor){
    dashboard.style.display = '';
    loadAdminPostList();
    refreshRequestsBadge();
    refreshSubmissionsBadge();
    refreshSubsBadge();
    return;
  }
  // পাঠক লগইন করলে সরাসরি প্রোফাইলে পাঠানো হচ্ছে (showView('profile') নিজেই URL /profile-তে বদলে দেয়)
  showView('profile');
}

document.getElementById('show-register-btn').addEventListener('click', ()=>{
  document.getElementById('login-box').style.display = 'none';
  document.getElementById('register-box').style.display = '';
});
document.getElementById('show-login-btn').addEventListener('click', ()=>{
  document.getElementById('register-box').style.display = 'none';
  document.getElementById('login-box').style.display = '';
});

document.getElementById('login-btn').addEventListener('click', async ()=>{
  const phone = document.getElementById('login-phone').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  try{
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) });
    isLoggedIn = true;
    isAuthor = !!data.isAuthor;
    renderCategoryNav();
    renderAdminView();
    await loadPosts();
  }catch(e){
    errEl.textContent = e.message || 'লগইন করা যায়নি।';
    errEl.style.display = 'block';
  }finally{
    btn.disabled = false;
  }
});
document.getElementById('login-password').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') document.getElementById('login-btn').click();
});

document.getElementById('register-btn').addEventListener('click', async ()=>{
  const phone = document.getElementById('register-phone').value.trim();
  const password = document.getElementById('register-password').value;
  const errEl = document.getElementById('register-error');
  const btn = document.getElementById('register-btn');
  btn.disabled = true;
  try{
    const data = await api('/auth/register', { method: 'POST', body: JSON.stringify({ phone, password }) });
    isLoggedIn = true;
    isAuthor = !!data.isAuthor;
    renderCategoryNav();
    renderAdminView();
    await loadPosts();
  }catch(e){
    errEl.textContent = e.message || 'অ্যাকাউন্ট খোলা যায়নি।';
    errEl.style.display = 'block';
  }finally{
    btn.disabled = false;
  }
});
document.getElementById('register-password').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') document.getElementById('register-btn').click();
});

async function doLogout(){
  try{ await api('/auth/logout', { method: 'POST' }); }catch(e){}
  isLoggedIn = false;
  isAuthor = false;
  renderCategoryNav();
  await loadPosts();
  goHome();
}
document.getElementById('admin-logout-btn').addEventListener('click', doLogout);

document.getElementById('admin-write-btn').addEventListener('click', ()=> openForm(null));
document.getElementById('admin-requests-btn').addEventListener('click', ()=> showView('requests'));
document.getElementById('admin-submissions-btn').addEventListener('click', ()=> showView('submissions'));
document.getElementById('admin-subs-btn').addEventListener('click', ()=> showView('subs-requests'));

async function loadAdminPostList(){
  const el = document.getElementById('admin-post-list');
  el.innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  try{
    const list = await api('/posts');
    if(list.length === 0){
      el.innerHTML = '<div class="empty-state"><p>এখনো কোনো লেখা নেই।</p></div>';
      return;
    }
    el.innerHTML = list.map(p => `
      <div class="admin-post-row" data-id="${p.id}">
        <div>
          <strong>${escapeHtml(p.title)}</strong>
          <div class="post-meta">
            ${p.category ? escapeHtml(p.category) + (p.subcategory ? ' · '+escapeHtml(p.subcategory) : '') : 'ক্যাটাগরি নেই'}
            <span class="dot"></span> ${p.isPaid ? '৳'+toBnDigits(p.price) : 'ফ্রি'}
            <span class="dot"></span> 👁 ${toBnDigits(p.totalViews)} (আজ ${toBnDigits(p.viewsToday)})
          </div>
        </div>
        <button class="stats-toggle admin-open-btn" data-id="${p.id}">দেখুন</button>
      </div>
    `).join('');
    el.querySelectorAll('.admin-open-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> openPost(btn.dataset.id));
    });
  }catch(e){
    el.innerHTML = `<div class="empty-state"><p>লোড করা যায়নি।</p></div>`;
  }
}

async function refreshRequestsBadge(){
  try{
    const list = await api('/payments/manual/requests?status=pending');
    const badge = document.getElementById('requests-badge');
    if(badge) badge.textContent = list.length > 0 ? `(${toBnDigits(list.length)})` : '';
  }catch(e){ /* নীরবে উপেক্ষা */ }
}

async function loadPaymentRequests(){
  const listEl = document.getElementById('requests-list');
  listEl.innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  try{
    const list = await api('/payments/manual/requests?status=pending');
    if(list.length === 0){
      listEl.innerHTML = '<div class="empty-state"><p>এখন কোনো মুলতুবি অনুরোধ নেই।</p></div>';
      return;
    }
    listEl.innerHTML = list.map(r => `
      <div class="request-card" data-id="${r.id}">
        <div class="request-top">
          <strong>${escapeHtml(r.postTitle)}</strong>
          <span class="price-badge">৳${toBnDigits(r.amount)}</span>
        </div>
        <div class="request-meta">
          <span>প্রেরকের নম্বর: ${escapeHtml(r.senderNumber)}</span>
          <span>TrxID: <strong>${escapeHtml(r.trxId)}</strong></span>
        </div>
        <div class="request-actions">
          <button class="approve-btn" data-id="${r.id}">অনুমোদন করুন</button>
          <button class="reject-btn" data-id="${r.id}">বাতিল করুন</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.approve-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> reviewRequest(btn.dataset.id, 'approve'));
    });
    listEl.querySelectorAll('.reject-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> reviewRequest(btn.dataset.id, 'reject'));
    });
  }catch(e){
    listEl.innerHTML = `<div class="empty-state"><p>লোড করা যায়নি: ${escapeHtml(e.message || '')}</p></div>`;
  }
}

async function reviewRequest(id, action){
  if(action === 'reject' && !confirm('এই অনুরোধ বাতিল করতে চান?')) return;
  try{
    await api(`/payments/manual/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    await loadPaymentRequests();
    await refreshRequestsBadge();
  }catch(e){
    alert(e.message || 'প্রক্রিয়া সম্পন্ন করা যায়নি।');
  }
}

// ==================== লেখা জমা (এডমিন রিভিউ) ====================

async function refreshSubmissionsBadge(){
  try{
    const list = await api('/submissions?status=pending');
    const badge = document.getElementById('submissions-badge');
    if(badge) badge.textContent = list.length > 0 ? `(${toBnDigits(list.length)})` : '';
  }catch(e){ /* নীরবে উপেক্ষা */ }
}

async function loadSubmissions(){
  const listEl = document.getElementById('submissions-list');
  listEl.innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  try{
    const list = await api('/submissions?status=pending');
    if(list.length === 0){
      listEl.innerHTML = '<div class="empty-state"><p>এখন কোনো নতুন জমা নেই।</p></div>';
      return;
    }
    listEl.innerHTML = list.map(s => `
      <div class="request-card" data-id="${s.id}">
        <div class="request-top">
          <strong>${escapeHtml(s.title)}</strong>
          ${s.category ? `<span class="cat-tag">${escapeHtml(s.category)}${s.subcategory ? ' · '+escapeHtml(s.subcategory) : ''}</span>` : ''}
        </div>
        <div class="request-meta">
          <span>জমাদাতার নম্বর: ${escapeHtml(s.phone)}</span>
        </div>
        <p class="submission-excerpt">${escapeHtml(s.excerpt)}</p>
        <div class="request-actions">
          <button class="approve-btn" data-id="${s.id}">প্রকাশ করুন</button>
          <button class="reject-btn" data-id="${s.id}">বাতিল করুন</button>
        </div>
      </div>
    `).join('');
    listEl.querySelectorAll('.approve-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> reviewSubmission(btn.dataset.id, 'approve'));
    });
    listEl.querySelectorAll('.reject-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> reviewSubmission(btn.dataset.id, 'reject'));
    });
  }catch(e){
    listEl.innerHTML = `<div class="empty-state"><p>লোড করা যায়নি: ${escapeHtml(e.message || '')}</p></div>`;
  }
}

async function reviewSubmission(id, action){
  if(action === 'reject' && !confirm('এই জমাটি বাতিল করতে চান?')) return;
  try{
    await api(`/submissions/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    await loadSubmissions();
    await refreshSubmissionsBadge();
    if(action === 'approve') await loadPosts();
  }catch(e){
    alert(e.message || 'প্রক্রিয়া সম্পন্ন করা যায়নি।');
  }
}

// ==================== সাবস্ক্রিপশন অনুরোধ (এডমিন রিভিউ) ====================

async function refreshSubsBadge(){
  try{
    const list = await api('/subscriptions/requests?status=pending');
    const badge = document.getElementById('subs-badge');
    if(badge) badge.textContent = list.length > 0 ? `(${toBnDigits(list.length)})` : '';
  }catch(e){ /* নীরবে উপেক্ষা */ }
}

async function loadSubsRequests(){
  const listEl = document.getElementById('subs-requests-list');
  listEl.innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  try{
    const list = await api('/subscriptions/requests?status=pending');
    if(list.length === 0){
      listEl.innerHTML = '<div class="empty-state"><p>এখন কোনো মুলতুবি অনুরোধ নেই।</p></div>';
      return;
    }
    listEl.innerHTML = list.map(r => `
      <div class="request-card" data-id="${r.id}">
        <div class="request-top">
          <strong>${escapeHtml(r.planLabel)} প্ল্যান</strong>
          <span class="price-badge">৳${toBnDigits(r.amount)}</span>
        </div>
        <div class="request-meta">
          <span>অ্যাকাউন্ট: ${escapeHtml(r.phone)}</span>
          <span>প্রেরকের নম্বর: ${escapeHtml(r.senderNumber)}</span>
          <span>TrxID: <strong>${escapeHtml(r.trxId)}</strong></span>
        </div>
        <div class="request-actions">
          <button class="approve-btn" data-id="${r.id}">অনুমোদন করুন</button>
          <button class="reject-btn" data-id="${r.id}">বাতিল করুন</button>
        </div>
      </div>
    `).join('');
    listEl.querySelectorAll('.approve-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> reviewSubsRequest(btn.dataset.id, 'approve'));
    });
    listEl.querySelectorAll('.reject-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> reviewSubsRequest(btn.dataset.id, 'reject'));
    });
  }catch(e){
    listEl.innerHTML = `<div class="empty-state"><p>লোড করা যায়নি: ${escapeHtml(e.message || '')}</p></div>`;
  }
}

async function reviewSubsRequest(id, action){
  if(action === 'reject' && !confirm('এই অনুরোধ বাতিল করতে চান?')) return;
  try{
    await api(`/subscriptions/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    await loadSubsRequests();
    await refreshSubsBadge();
  }catch(e){
    alert(e.message || 'প্রক্রিয়া সম্পন্ন করা যায়নি।');
  }
}

// ==================== পেওয়াল (bKash Send Money) ====================

let cachedSendMoneyNumber = undefined;
async function getSendMoneyNumber(){
  if(cachedSendMoneyNumber !== undefined) return cachedSendMoneyNumber;
  try{
    const data = await api('/payments/manual/config');
    cachedSendMoneyNumber = data.sendMoneyNumber;
  }catch(e){
    cachedSendMoneyNumber = null;
  }
  return cachedSendMoneyNumber;
}

async function renderPaywall(p){
  const number = await getSendMoneyNumber();
  if(!number){
    return `<div class="paywall">
      <p class="price-line">এই লেখাটি পড়তে ৳${toBnDigits(p.price)} দিতে হবে</p>
      <p>পেমেন্ট সিস্টেম এখনো প্রস্তুত হচ্ছে। কিছুক্ষণ পর আবার চেষ্টা করুন।</p>
    </div>`;
  }
  return `<div class="paywall">
    <p class="price-line">এই লেখাটি পড়তে ৳${toBnDigits(p.price)} দিতে হবে</p>
    <p>
      ১. bKash অ্যাপ খুলুন → <strong>Send Money</strong><br>
      ২. এই নম্বরে পাঠান: <strong class="bkash-number">${escapeHtml(number)}</strong><br>
      ৩. পাঠানোর পরিমাণ: <strong>৳${toBnDigits(p.price)}</strong><br>
      ৪. bKash-এর SMS/অ্যাপ থেকে পাওয়া <strong>ট্রানজেকশন আইডি (TrxID)</strong> নিচে দিন
    </p>
    <form id="manual-pay-form" class="paywall-form">
      <input type="tel" id="mp-sender" placeholder="আপনার bKash নম্বর (যেখান থেকে পাঠিয়েছেন)" required>
      <input type="text" id="mp-trx" placeholder="ট্রানজেকশন আইডি (TrxID)" required>
      <button type="submit" class="bkash-btn">যাচাইয়ের জন্য জমা দিন</button>
    </form>
    <p class="paywall-note">জমা দেওয়ার পর লেখক যাচাই করে অনুমোদন দিলেই লেখাটি আনলক হয়ে যাবে। কিছুক্ষণ পর এই পেজে ফিরে "আবার চেক করুন" চাপুন।</p>
    <button class="btn-ghost" id="recheck-btn">আবার চেক করুন</button>
  </div>`;
}

function wirePaywallForm(p){
  const recheckBtn = document.getElementById('recheck-btn');
  if(recheckBtn){
    recheckBtn.addEventListener('click', ()=> openPost(p.id));
  }
  const form = document.getElementById('manual-pay-form');
  if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const senderNumber = document.getElementById('mp-sender').value.trim();
    const trxId = document.getElementById('mp-trx').value.trim();
    submitBtn.disabled = true;
    submitBtn.textContent = 'জমা হচ্ছে…';
    try{
      const data = await api('/payments/manual/submit', {
        method: 'POST',
        body: JSON.stringify({ postId: p.id, senderNumber, trxId }),
      });
      if(data.alreadyPurchased){
        await openPost(p.id);
        return;
      }
      form.innerHTML = '';
      const msg = document.createElement('p');
      msg.className = 'paywall-note';
      msg.textContent = 'অনুরোধ জমা হয়েছে। লেখক যাচাই করে অনুমোদন দিলে লেখাটি আনলক হয়ে যাবে।';
      form.replaceWith(msg);
    }catch(e){
      alert(e.message || 'জমা দেওয়া যায়নি। আবার চেষ্টা করুন।');
      submitBtn.disabled = false;
      submitBtn.textContent = 'যাচাইয়ের জন্য জমা দিন';
    }
  });
}

function showPaymentBanner(status){
  const banner = document.createElement('div');
  banner.className = 'payment-banner ' + (status === 'success' ? 'success' : 'failed');
  banner.textContent = status === 'success'
    ? 'পেমেন্ট সফল হয়েছে — এখন সম্পূর্ণ লেখাটি পড়তে পারবেন।'
    : 'পেমেন্ট সম্পন্ন হয়নি বা বাতিল হয়েছে। আবার চেষ্টা করতে পারেন।';
  document.querySelector('main').prepend(banner);
  setTimeout(()=> banner.remove(), 6000);
}

// ==================== প্রোফাইল (অ্যাকাউন্ট + সাবস্ক্রিপশন + কেনা লেখা) ====================

async function loadProfile(){
  const guard = document.getElementById('profile-guard');
  const content = document.getElementById('profile-content');
  if(!isLoggedIn){
    content.style.display = 'none';
    guard.innerHTML = `<div class="empty-state"><p>প্রোফাইল দেখতে আগে লগইন করুন।</p>
      <button class="btn-primary" id="profile-login-btn">লগইন করুন</button></div>`;
    document.getElementById('profile-login-btn').addEventListener('click', ()=> showView('admin'));
    return;
  }
  guard.innerHTML = '';
  content.style.display = '';

  try{
    const me = await api('/auth/me');
    document.getElementById('profile-phone').textContent = 'ফোন নম্বর: ' + toBnDigits(me.phone);
  }catch(e){ /* ignore */ }

  await loadSubscriptionStatus();
  await loadPurchasesList();
}

async function loadSubscriptionStatus(){
  const statusEl = document.getElementById('subscription-status');
  const cardsEl = document.getElementById('plan-cards');
  statusEl.innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  cardsEl.innerHTML = '';
  document.getElementById('subscribe-form-wrap').style.display = 'none';

  let sub = { active: false };
  try{ sub = await api('/subscriptions/me'); }catch(e){ /* ignore */ }

  if(sub.active){
    const expiryDate = new Date(sub.expiresAt);
    statusEl.innerHTML = `<p class="subscription-active">✓ ${PLANS[sub.plan]?.label || sub.plan} প্ল্যান সক্রিয় — মেয়াদ শেষ: ${toBnDigits(expiryDate.getDate())} ${['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'][expiryDate.getMonth()]} ${toBnDigits(expiryDate.getFullYear())}</p>
      <p class="hint">মেয়াদ শেষ হওয়ার আগে আবার সাবস্ক্রাইব করলে নতুন মেয়াদ এই তারিখের পর থেকে যোগ হবে।</p>`;
  } else {
    statusEl.innerHTML = `<p class="hint">সাবস্ক্রিপশন থাকলে সব পেইড লেখা একসাথে পড়া যাবে, আলাদা করে কিনতে হবে না।</p>`;
  }

  let planData = { sendMoneyNumber: null };
  try{ planData = await api('/subscriptions/plans'); }catch(e){ /* ignore */ }

  cardsEl.innerHTML = Object.entries(PLANS).map(([key, p]) => `
    <div class="plan-card">
      <div class="plan-name">${escapeHtml(p.label)}</div>
      <div class="plan-price">৳${toBnDigits(p.amount)}</div>
      <div class="plan-days">${toBnDigits(p.days)} দিন</div>
      <button class="btn-primary plan-select-btn" data-plan="${key}">${sub.active ? 'নবায়ন করুন' : 'সাবস্ক্রাইব করুন'}</button>
    </div>
  `).join('');

  cardsEl.querySelectorAll('.plan-select-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(!planData.sendMoneyNumber){
        alert('পেমেন্ট সিস্টেম এখনো প্রস্তুত হচ্ছে। কিছুক্ষণ পর আবার চেষ্টা করুন।');
        return;
      }
      document.getElementById('subscribe-plan').value = btn.dataset.plan;
      document.getElementById('subscribe-form-wrap').style.display = '';
      document.getElementById('subscribe-form-wrap').scrollIntoView({behavior:'smooth', block:'center'});
    });
  });
}

document.getElementById('subscribe-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const plan = document.getElementById('subscribe-plan').value;
  const senderNumber = document.getElementById('subscribe-sender').value.trim();
  const trxId = document.getElementById('subscribe-trx').value.trim();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'জমা হচ্ছে…';
  try{
    await api('/subscriptions/submit', {
      method: 'POST',
      body: JSON.stringify({ plan, senderNumber, trxId }),
    });
    alert('আপনার সাবস্ক্রিপশন অনুরোধ জমা হয়েছে। লেখক যাচাই করে অনুমোদন দিলে সক্রিয় হয়ে যাবে।');
    document.getElementById('subscribe-form').reset();
    document.getElementById('subscribe-form-wrap').style.display = 'none';
  }catch(e){
    alert(e.message || 'জমা দেওয়া যায়নি। আবার চেষ্টা করুন।');
  }finally{
    btn.disabled = false;
    btn.textContent = 'যাচাইয়ের জন্য জমা দিন';
  }
});

async function loadPurchasesList(){
  const listEl = document.getElementById('purchases-list');
  listEl.innerHTML = '<div class="loading">লোড হচ্ছে…</div>';
  try{
    const list = await api('/payments/purchases');
    if(list.length === 0){
      listEl.innerHTML = '<div class="empty-state"><p>এখনো কোনো লেখা আলাদা করে কেনা হয়নি।</p></div>';
      return;
    }
    listEl.innerHTML = list.map(pu => `
      <article class="purchase-card" data-id="${pu.postId}">
        <span class="post-meta">${pu.date} · ৳${toBnDigits(pu.amount)} দিয়ে কেনা</span>
        <h3 class="post-title">${escapeHtml(pu.title)}</h3>
      </article>
    `).join('');
    listEl.querySelectorAll('.purchase-card').forEach(el=>{
      el.addEventListener('click', ()=> openPost(el.dataset.id));
    });
  }catch(e){
    listEl.innerHTML = `<div class="empty-state"><p>লোড করা যায়নি।</p></div>`;
  }
}

document.getElementById('restore-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const phoneInput = document.getElementById('restore-phone');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'খোঁজা হচ্ছে…';
  try{
    const data = await api('/payments/restore', {
      method: 'POST',
      body: JSON.stringify({ phone: phoneInput.value.trim() }),
    });
    if(data.totalFound === 0){
      alert('এই নম্বর দিয়ে কোনো অনুমোদিত কেনাকাটা পাওয়া যায়নি।');
    } else if(data.restoredCount === 0){
      alert('এই লেখাগুলো ইতিমধ্যে তালিকায় আছে।');
    } else {
      alert(`${data.restoredCount}টি লেখা মিলিয়ে আনা হয়েছে।`);
    }
    phoneInput.value = '';
    await loadPurchasesList();
  }catch(e){
    alert(e.message || 'মেলানো যায়নি। আবার চেষ্টা করুন।');
  }finally{
    btn.disabled = false;
    btn.textContent = 'মিলিয়ে দেখুন';
  }
});

document.getElementById('profile-logout-btn').addEventListener('click', doLogout);

// ==================== URL রাউটিং ====================

function routeFromLocation(){
  const path = window.location.pathname;

  const postMatch = path.match(/^\/post\/([^/]+)\/?$/);
  if(postMatch){ openPost(decodeURIComponent(postMatch[1]), false); return; }

  const catMatch = path.match(/^\/category\/([^/]+)(?:\/([^/]+))?\/?$/);
  if(catMatch){
    const cat = SLUG_TO_CATEGORY[catMatch[1]];
    const sub = catMatch[2] ? decodeURIComponent(catMatch[2]) : null;
    if(cat){ activeCategory = cat; activeSubcategory = sub; renderCategoryNav(); showView('list', false); return; }
  }

  if(path === '/profile'){ showView('profile', false); return; }
  if(path === '/requests'){ showView('requests', false); return; }
  if(path === '/admin'){ showView('admin', false); return; }
  if(path === '/write'){
    if(!isLoggedIn){ showView('admin', false); history.replaceState({}, '', '/admin'); return; }
    openForm(null, false);
    return;
  }

  goHome(false);
}

window.addEventListener('popstate', routeFromLocation);

async function initialRoute(){
  const params = new URLSearchParams(window.location.search);
  const paramPost = params.get('post');
  const paymentStatus = params.get('payment');
  if(paramPost || paymentStatus){
    history.replaceState({}, '', paramPost ? '/post/' + encodeURIComponent(paramPost) : '/');
    if(paramPost) await openPost(paramPost, false);
    if(paymentStatus) showPaymentBanner(paymentStatus);
    return;
  }
  routeFromLocation();
}

renderCategoryNav();
checkSession().then(() => {
  renderCategoryNav(); // সেশন জানার পর মেনু আবার রেন্ডার করা — না হলে লগইন থাকলেও "লগইন" লেখাই দেখাত
  return loadPosts().then(initialRoute);
});
