/* ==================== উন্নয়ন: সার্চ + ডার্ক মোড + ফন্ট + প্রগ্রেস + শেয়ার + SEO ==================== */
(function(){
'use strict';

// ==================== ডার্ক মোড ====================
const html = document.documentElement;
const themeBtn = document.getElementById('theme-toggle');
const saved = localStorage.getItem('paipatro-theme');
if(saved) html.setAttribute('data-theme', saved);

themeBtn.classList.add('theme-toggle');
themeBtn.addEventListener('click', ()=>{
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('paipatro-theme', next);
});

// ==================== ফন্ট সাইজ কন্ট্রোল ====================
const FONT_KEY = 'paipatro-font-size';
const BASE = 16;
let fontSize = parseInt(localStorage.getItem(FONT_KEY)) || BASE;
function applyFontSize(){ document.body.style.fontSize = fontSize + 'px'; }
applyFontSize();

document.getElementById('font-inc').addEventListener('click', ()=>{
  if(fontSize < 22){ fontSize += 1; localStorage.setItem(FONT_KEY, fontSize); applyFontSize(); }
});
document.getElementById('font-dec').addEventListener('click', ()=>{
  if(fontSize > 13){ fontSize -= 1; localStorage.setItem(FONT_KEY, fontSize); applyFontSize(); }
});

// ==================== রিডিং প্রগ্রেস বার ====================
const bar = document.getElementById('progress-bar');
window.addEventListener('scroll', ()=>{
  const h = document.documentElement;
  const pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
  bar.style.width = Math.min(pct, 100) + '%';
}, {passive:true});

// ==================== সার্চ ====================
const searchInput = document.getElementById('search-input');
const searchClose = document.getElementById('search-close');
const searchResults = document.getElementById('search-results');
const searchForm = document.getElementById('search-form');
let searchTimer = null;

searchForm.addEventListener('submit', e=> e.preventDefault());

searchInput.addEventListener('input', ()=>{
  const q = searchInput.value.trim();
  searchClose.style.display = q ? 'block' : 'none';
  clearTimeout(searchTimer);
  if(!q){ searchResults.style.display = 'none'; return; }
  searchTimer = setTimeout(()=> doSearch(q), 300);
});

searchClose.addEventListener('click', ()=>{
  searchInput.value = '';
  searchClose.style.display = 'none';
  searchResults.style.display = 'none';
});

document.addEventListener('click', e=>{
  if(!searchResults.contains(e.target) && !searchForm.contains(e.target)){
    searchResults.style.display = 'none';
  }
});

async function doSearch(q){
  try{
    const results = await api('/posts/search?q=' + encodeURIComponent(q));
    if(!results.length){
      searchResults.innerHTML = '<div class="search-empty">কোনো লেখা পাওয়া যায়নি।</div>';
    } else {
      searchResults.innerHTML = results.map(r=>`
        <div class="search-result-item" data-id="${escapeHtml(r.id)}">
          <div class="sr-title">${escapeHtml(r.title)}</div>
          <div class="sr-excerpt">${escapeHtml(r.excerpt)}</div>
          <div class="sr-meta">${escapeHtml(r.date)} · ${escapeHtml(r.readTime)}${r.isPaid ? ' · ৳'+r.price : ''}</div>
        </div>`
      ).join('');
      searchResults.querySelectorAll('.search-result-item').forEach(item=>{
        item.addEventListener('click', ()=>{
          searchResults.style.display = 'none';
          searchInput.value = '';
          searchClose.style.display = 'none';
          openPost(item.dataset.id);
        });
      });
    }
    searchResults.style.display = 'block';
  }catch(e){
    searchResults.innerHTML = '<div class="search-empty">সার্চ ব্যর্থ হয়েছে।</div>';
    searchResults.style.display = 'block';
  }
}

// ==================== SEO + শেয়ার: openPost wrap ====================
function setMeta(key, val, attr='name'){
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if(!el){ el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', val);
}

function addShareButtons(postId, title){
  const detailEl = document.getElementById('post-detail');
  if(detailEl.querySelector('.share-buttons')) return;
  const url = window.location.origin + '/post/' + postId;
  const actionsEl = detailEl.querySelector('.post-actions');
  if(!actionsEl) return;
  const shareDiv = document.createElement('div');
  shareDiv.className = 'share-buttons';
  shareDiv.innerHTML = `
    <a class="share-btn fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>Facebook
    </a>
    <a class="share-btn wa" href="https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.387 0-4.607-.798-6.383-2.148l-.446-.344-2.856.957.957-2.856-.344-.446A9.935 9.935 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>WhatsApp
    </a>
    <a class="share-btn tg" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789-.027-.017-.052-.051-.043-.087.009-.036.04-.055.083-.055h.002z"/></svg>Telegram
    </a>
    <a class="share-btn tw" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>X
    </a>`;
  actionsEl.after(shareDiv);
}

// openPost কে wrap করা: মূল ফাংশন চালানোর পর SEO ও শেয়ার যোগ করবে
const _origOpenPost = window.openPost;
window.openPost = async function(id, push){
  // মূল ফাংশন কল
  await _origOpenPost(id, push);

  // পোস্ট ডেটা ফেচ করে SEO আপডেট
  try{
    const p = await api('/posts/' + encodeURIComponent(id));
    if(!p) return;
    const title = p.title || 'পাইপত্র';
    const desc = p.excerpt || '';
    const url = window.location.origin + '/post/' + id;
    document.title = title + ' — পাইপত্র';
    setMeta('description', desc);
    setMeta('og:title', title, 'property');
    setMeta('og:description', desc, 'property');
    setMeta('og:url', url, 'property');
    setMeta('og:type', 'article', 'property');
    setMeta('twitter:title', title, 'name');
    setMeta('twitter:description', desc, 'name');
    // শেয়ার বাটন যোগ
    setTimeout(()=> addShareButtons(id, title), 100);
  }catch(e){}
};

// হোম পেজে ফিরে গেলে meta রিসেট
const logoLink = document.getElementById('logo-link');
if(logoLink){
  logoLink.addEventListener('click', ()=>{
    setTimeout(()=>{
      document.title = 'পাইপত্র — ইতিহাস, অর্থনীতি ও শিক্ষা নিয়ে লেখালেখির একটি খাতা';
      setMeta('og:type', 'website', 'property');
      setMeta('og:url', window.location.origin, 'property');
    }, 50);
  });
}

// ==================== কীবোর্ড শর্টকাট ====================
document.addEventListener('keydown', e=>{
  if((e.ctrlKey && e.key === 'k') || (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))){
    e.preventDefault();
    searchInput.focus();
  }
  if(e.key === 'Escape'){
    searchResults.style.display = 'none';
    searchInput.blur();
  }
});

})();
