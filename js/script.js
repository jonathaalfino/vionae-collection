/* ==================== CONFIG ==================== */
const SB_URL = 'https://juozlbnwtsquubcvxoyi.supabase.co';
const SB_KEY = 'sb_publishable_cdV0pOUjnyPpffc7Mog-7w_tmzsG2PM';

/* ==================== LAST ORDER (untuk tombol WA opsional) ==================== */
// Diisi saat pembayaran Midtrans selesai (success/pending), dipakai kalau
// customer klik tombol "Konfirmasi via WhatsApp" secara manual di layar sukses.
// lastOrderItems/lastOrderCustomer perlu snapshot karena `cart` dikosongkan
// begitu pembayaran selesai, dan form bisa saja sudah ditutup saat tombol diklik.
let lastOrderId = null;
let lastOrderStatusLabel = '';
let lastOrderPaymentType = '';
let lastOrderItems = [];
let lastOrderCustomer = null;
let lastOrderShipping = { info: '-', fee: 0 };

/* ==================== SHIPPING FEE ==================== */
// State ongkir dinamis — di-update saat user memilih lokasi
let SHIPPING_FEE = 0;
let selectedKabupaten  = '';
let selectedKodePos    = '';
let shippingRatesCache = [];   // cache semua data dari Supabase
let shipActiveIdx      = -1;   // untuk navigasi keyboard

/* ── Fetch semua data shipping_rates sekali saat load ── */
async function fetchShippingRates() {
  try {
    // Supabase default limit 1000 — pakai header Range untuk ambil semua
    const res = await fetch(
      `${SB_URL}/rest/v1/shipping_rates?order=kabupaten.asc&select=kabupaten,kode_pos,tarif`,
      {
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          'Range-Unit': 'items',
          'Range': '0-9999'   // ambil hingga 10.000 baris
        }
      }
    );
    shippingRatesCache = await res.json();

    // ✅ Pulihkan pilihan dari localStorage jika ada
    const saved = localStorage.getItem('vionae_shipping');
    if (saved) {
      try {
        const { kabupaten, kode_pos, tarif } = JSON.parse(saved);
        const match = shippingRatesCache.find(
          r => r.kabupaten === kabupaten && r.kode_pos === kode_pos
        );
        // ✅ silent=true agar tidak double-call, tapi tetap update SHIPPING_FEE
        if (match) {
          SHIPPING_FEE      = Number(match.tarif);
          selectedKabupaten = match.kabupaten;
          selectedKodePos   = match.kode_pos || '';
          applyShippingSelection(match, true);
        }
      } catch(e) { localStorage.removeItem('vionae_shipping'); }
    }

    // ✅ Panggil updateCartUI SETELAH data Supabase & localStorage selesai
    // Ini fix race condition: sebelumnya updateCartUI() dipanggil di DOMContentLoaded
    // sebelum fetchShippingRates() selesai, jadi SHIPPING_FEE masih 0
    updateCartUI();

  } catch(e) {
    console.warn('Gagal memuat shipping rates:', e);
  }
}

/* ── Filter & tampilkan saran saat mengetik ── */
function onShipSearch(query) {
  shipActiveIdx = -1;
  const q = query.trim().toLowerCase();
  const dropdown = document.getElementById('shipDropdown');
  const clearBtn = document.getElementById('shipClearBtn');
  const icon     = document.getElementById('shipSearchIcon');

  clearBtn.style.display = q ? 'block' : 'none';
  icon.style.display     = q ? 'none'  : 'block';

  if (!q) { dropdown.classList.remove('open'); return; }
  if (!shippingRatesCache.length) {
    dropdown.innerHTML = '<div class="ship-loading"><i class="fas fa-circle-notch fa-spin"></i> Memuat data...</div>';
    dropdown.classList.add('open');
    return;
  }

  const results = shippingRatesCache.filter(r =>
    r.kabupaten.toLowerCase().includes(q) ||
    (r.kode_pos && r.kode_pos.includes(q))
  ).slice(0, 40);

  if (!results.length) {
    dropdown.innerHTML = '<div class="ship-no-result">Wilayah tidak ditemukan 🔍</div>';
  } else {
    dropdown.innerHTML = results.map((r, i) => `
      <div class="ship-option" data-idx="${i}"
        onmousedown="applyShippingSelection(${JSON.stringify(r).replace(/"/g,'&quot;')})"
        onmouseover="setShipActive(${i})">
        <div class="ship-option-name">${highlight(r.kabupaten, q)}</div>
        <div class="ship-option-detail">Kode Pos: <b>${highlight(r.kode_pos||'-', q)}</b></div>
        <div class="ship-option-tarif">Rp ${Number(r.tarif).toLocaleString('id-ID')}</div>
      </div>
    `).join('');
  }
  dropdown.classList.add('open');
}

/* ── Highlight teks yang cocok ── */
function highlight(text, query) {
  if (!query) return text;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return text.replace(re, '<mark style="background:var(--rose-light);border-radius:2px;padding:0 2px">$1</mark>');
}

/* ── Navigasi keyboard ── */
function onShipKeydown(e) {
  const dropdown = document.getElementById('shipDropdown');
  const opts = dropdown.querySelectorAll('.ship-option');
  if (!opts.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setShipActive(Math.min(shipActiveIdx + 1, opts.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setShipActive(Math.max(shipActiveIdx - 1, 0));
  } else if (e.key === 'Enter' && shipActiveIdx >= 0) {
    e.preventDefault();
    opts[shipActiveIdx]?.dispatchEvent(new Event('mousedown'));
  } else if (e.key === 'Escape') {
    dropdown.classList.remove('open');
  }
}

function setShipActive(idx) {
  const dropdown = document.getElementById('shipDropdown');
  const opts = dropdown.querySelectorAll('.ship-option');
  opts.forEach(o => o.classList.remove('active'));
  if (opts[idx]) {
    opts[idx].classList.add('active');
    opts[idx].scrollIntoView({ block: 'nearest' });
  }
  shipActiveIdx = idx;
}

function onShipFocus() {
  const q = document.getElementById('shipSearchInput').value.trim();
  if (q) onShipSearch(q);
}

/* ── Terapkan pilihan lokasi ── */
function applyShippingSelection(row, silent = false) {
  SHIPPING_FEE     = Number(row.tarif);
  selectedKabupaten = row.kabupaten;
  selectedKodePos   = row.kode_pos || '';

  // Update input
  const input = document.getElementById('shipSearchInput');
  if (input) {
    input.value = `${row.kabupaten}${row.kode_pos ? ' ('+row.kode_pos+')' : ''}`;
    input.classList.add('selected');
  }

  // Tampilkan badge
  const badge  = document.getElementById('shipSelectedBadge');
  const text   = document.getElementById('shipSelectedText');
  const tarif  = document.getElementById('shipSelectedTarif');
  if (badge && text && tarif) {
    text.textContent  = `${row.kabupaten}${row.kode_pos ? ' · '+row.kode_pos : ''}`;
    tarif.textContent = `Rp ${Number(row.tarif).toLocaleString('id-ID')}`;
    badge.classList.add('show');
  }

  // Tombol clear & icon
  const clearBtn = document.getElementById('shipClearBtn');
  const icon     = document.getElementById('shipSearchIcon');
  if (clearBtn) clearBtn.style.display = 'block';
  if (icon)     icon.style.display     = 'none';

  // Tutup dropdown
  document.getElementById('shipDropdown')?.classList.remove('open');

  // Simpan ke localStorage
  localStorage.setItem('vionae_shipping', JSON.stringify({
    kabupaten: row.kabupaten,
    kode_pos:  row.kode_pos || '',
    tarif:     row.tarif
  }));

  if (!silent) updateCartUI();
}

/* ── Reset pilihan ── */
function clearShipping() {
  SHIPPING_FEE      = 0;
  selectedKabupaten = '';
  selectedKodePos   = '';
  localStorage.removeItem('vionae_shipping');

  const input = document.getElementById('shipSearchInput');
  if (input) { input.value = ''; input.classList.remove('selected'); input.focus(); }

  document.getElementById('shipSelectedBadge')?.classList.remove('show');
  document.getElementById('shipDropdown')?.classList.remove('open');

  const clearBtn = document.getElementById('shipClearBtn');
  const icon     = document.getElementById('shipSearchIcon');
  if (clearBtn) clearBtn.style.display = 'none';
  if (icon)     icon.style.display     = 'block';

  updateCartUI();
}

/* ── Tutup dropdown saat klik di luar ── */
document.addEventListener('click', e => {
  if (!e.target.closest('#shipWidget')) {
    document.getElementById('shipDropdown')?.classList.remove('open');
  }
});
const sb = (path, opts = {}) => fetch(`${SB_URL}/rest/v1/${path}`, {
  headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...opts.headers },
  ...opts
}).then(r => r.json());

// PATCH helper khusus — Supabase butuh header yang tepat
const sbPatch = (path, body) => fetch(`${SB_URL}/rest/v1/${path}`, {
  method: 'PATCH',
  headers: {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  },
  body: JSON.stringify(body)
});

// POST helper khusus
const sbPost = (path, body) => fetch(`${SB_URL}/rest/v1/${path}`, {
  method: 'POST',
  headers: {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  },
  body: JSON.stringify(body)
});

/* ==================== STATE ==================== */
let cart = [];
let allProducts = [];
let currentProduct = null;
let currentPayStep = 1;
let selectedPayMethod = null;
let gachaSpun = false;
let gachaPrize = null;
let gachaPrizes = [];
let proofUploaded = false;

const BANK_INFO = {
  bca:     { name: 'Bank BCA',     num: '1234567890', holder: 'Jonathan Christian Alfino' },
  mandiri: { name: 'Bank Mandiri', num: '9876543210', holder: 'Jonathan Christian Alfino' },
  bni:     { name: 'Bank BNI',     num: '5555666677', holder: 'Jonathan Christian Alfino' },
  qris:    { name: 'QRIS',         scr: 'image/Qris.jpeg',          scr: 'image/Qris.jpeg' },
  dana:    { name: 'DANA',         num: '087848785581', holder: 'Jonathan Christian Alfino' },
};

/* ==================== CART STORAGE HELPERS ==================== */
function saveCart() {
  try { localStorage.setItem('vionae_cart', JSON.stringify(cart)); } catch(e) {}
}

function loadCart() {
  try {
    const saved = localStorage.getItem('vionae_cart');
    if (saved) cart = JSON.parse(saved);
  } catch(e) { cart = []; }
}

/* ==================== NAV ==================== */
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('visible'));
  const sec = document.getElementById('sec-' + id);
  if (sec) sec.classList.add('visible');

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll(`.nav-link`).forEach(l => {
    if (l.getAttribute('onclick') && l.getAttribute('onclick').includes("'" + id + "'")) l.classList.add('active');
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
  closeMobileNav();

  if (id === 'testimonials') { fetchTestimonials(); }
  if (id === 'kebijakan') { showPolicyTab('syarat'); }
}

/* ==================== POLICY TABS ==================== */
function showPolicyTab(tab) {
  // Hide all tabs
  document.querySelectorAll('.policy-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('[id^="tabBtn-"]').forEach(btn => btn.classList.remove('active'));
  // Show selected
  const content = document.getElementById('policyTab-' + tab);
  const btn = document.getElementById('tabBtn-' + tab);
  if (content) content.style.display = 'block';
  if (btn) btn.classList.add('active');
}

function scrollToPolicy(tab) {
  // Called from footer links — show section then open correct tab
  setTimeout(() => showPolicyTab(tab), 100);
}

function toggleMobileNav() {
  document.getElementById('mobileNav').classList.toggle('open');
}

function closeMobileNav() {
  document.getElementById('mobileNav').classList.remove('open');
}

/* ==================== MODAL ==================== */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'paymentModal') resetPayment();
}

window.addEventListener('click', e => {
  ['detailModal','newsModal','paymentModal','gachaModal','preorderModal','tncModal'].forEach(id => {
    const el = document.getElementById(id);
    if (e.target === el) closeModal(id);
  });
});

/* ==================== TOAST ==================== */
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  const i = t.querySelector('i');
  document.getElementById('toastMsg').textContent = msg;
  i.className = type === 'success' ? 'fas fa-check-circle' : 'fas fa-exclamation-circle';
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3500);
}

/* ==================== STATUS ==================== */
function normalizeStatus(s = '') {
  const l = s.toLowerCase().trim();
  if (l.includes('ready') || l.includes('stock')) return 'ready';
  if (l.includes('pre') || l.includes('order')) return 'preorder';
  if (l.includes('sold') || l.includes('habis')) return 'soldout';
  return 'ready';
}

function statusLabel(s) {
  if (s === 'ready') return 'Ready Stock';
  if (s === 'preorder') return 'Pre-order';
  return 'Sold Out';
}

/* ==================== PRODUCT CARD ==================== */
function makeProductCard(p) {
  const st = normalizeStatus(p.status);
  const stClass = `status-${st}`;
  const stText = statusLabel(st);
  const ratingVal = p.rating || 4.9;

  // Pre-order: punya flow sendiri via WA, TIDAK bisa masuk keranjang
  const btnBuy = st === 'soldout'
    ? `<button style="flex:1;padding:9px 0;border-radius:var(--radius-sm);border:none;background:#e2e8f0;color:#94a3b8;font-size:13px;font-weight:600;cursor:not-allowed"><i class="fas fa-ban"></i> Habis</button>`
    : st === 'preorder'
    ? `<button style="flex:1;padding:9px 0;border-radius:var(--radius-sm);border:none;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:white;font-size:13px;font-weight:600" onclick='openPreorderModal(${JSON.stringify(p)})'><i class="fas fa-clock"></i> Pre-order</button>`
    : `<button class="btn-primary" style="flex:1;justify-content:center;padding:9px 0;font-size:13px" onclick='addToCart(${JSON.stringify(p)})'><i class="fas fa-shopping-bag"></i> Tambah</button>`;

  return `
  <div class="product-card">
    <div class="product-img-wrap">
      <img src="${p.image}" alt="${p.name}" loading="lazy" onerror="this.src='https://placehold.co/400x300/fce8f1/d4547a?text=Vionae'">
      <span class="product-status ${stClass}">${stText}</span>
      <div class="product-quick-buy">
        <button onclick='showDetail(${JSON.stringify(p)})'>Lihat Detail →</button>
      </div>
    </div>
    <div class="product-info">
      <div class="product-name">${p.name}</div>
      <div class="product-rating-badge" style="margin:4px 0 8px">
        <span class="star-gold">★</span>
        <span class="rating-val">${ratingVal}</span>
        <span class="rating-denom">/5.0</span>
      </div>
      <div class="product-batch">${p.batch_name ? p.batch_name : `Batch ${p.batch}`}</div>
      <div class="product-bottom">
        <div class="product-price">Rp ${p.price.toLocaleString('id-ID')}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        ${btnBuy}
        <button style="padding:9px 12px;border-radius:var(--radius-sm);border:1.5px solid var(--border);background:white;color:var(--text-mid);font-size:13px;transition:all 0.3s" onmouseover="this.style.borderColor='var(--rose-light)'" onmouseout="this.style.borderColor='var(--border)'" onclick='showDetail(${JSON.stringify(p)})'><i class="fas fa-eye"></i></button>
      </div>
    </div>
  </div>`;
}

/* ==================== FEATURED PRODUCTS ==================== */
async function fetchFeatured() {
  const grid = document.getElementById('featuredGrid');
  grid.innerHTML = '<div class="spinner"><i class="fas fa-circle-notch"></i></div>';
  try {
    const data = await sb('vionae?is_featured=eq.true&is_published=eq.true');
    if (!data.length) { grid.innerHTML = '<p style="text-align:center;color:var(--text-soft);padding:40px">Belum ada produk unggulan.</p>'; return; }
    grid.innerHTML = data.map(makeProductCard).join('');
  } catch(e) {
    grid.innerHTML = '<p style="text-align:center;color:#ef4444;padding:40px">Gagal memuat produk.</p>';
  }
}

/* ==================== ALL PRODUCTS (BATCH) ==================== */
async function fetchAllProducts() {
  const nav = document.getElementById('batchNav');
  const content = document.getElementById('batchContent');
  nav.innerHTML = ''; content.innerHTML = '<div class="spinner"><i class="fas fa-circle-notch"></i></div>';
  try {
    const data = await sb('vionae?is_published=eq.true');
    allProducts = data;
    renderBatchProducts(data);
  } catch(e) {
    content.innerHTML = '<p style="text-align:center;color:#ef4444;padding:40px">Gagal memuat produk.</p>';
  }
}

function renderBatchProducts(products) {
  const nav = document.getElementById('batchNav');
  const content = document.getElementById('batchContent');
  nav.innerHTML = '';
  content.innerHTML = '';

  const batches = {};
  products.forEach(p => {
    const b = p.batch || 'Lainnya';
    if (!batches[b]) batches[b] = { products: [], name: p.batch_name || `Batch ${b}` };
    batches[b].products.push(p);
  });

  const keys = Object.keys(batches).sort();

  // All button
  const allBtn = document.createElement('button');
  allBtn.className = 'batch-btn active';
  allBtn.textContent = `Semua (${products.length})`;
  allBtn.onclick = () => {
    document.querySelectorAll('.batch-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    document.querySelectorAll('.batch-section').forEach(s => s.style.display = 'block');
  };
  nav.appendChild(allBtn);

  keys.forEach(bNum => {
    const { products: bProds, name } = batches[bNum];
    const btn = document.createElement('button');
    btn.className = 'batch-btn';
    // Tampilkan batch_name saja jika ada, jika tidak "Batch N"
    const displayName = (name && name !== `Batch ${bNum}`) ? name : `Batch ${bNum}`;
    btn.textContent = `${displayName} (${bProds.length})`;
    btn.onclick = () => {
      document.querySelectorAll('.batch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.batch-section').forEach(s => s.style.display = 'none');
      document.getElementById('batchSec_' + bNum).style.display = 'block';
    };
    nav.appendChild(btn);

    const sec = document.createElement('div');
    sec.className = 'batch-section';
    sec.id = 'batchSec_' + bNum;
    sec.style.marginBottom = '40px';
    sec.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div>
          <h3 style="font-family:var(--font-display);font-size:22px;color:var(--text-dark)">${displayName}</h3>
          <p style="font-size:13px;color:var(--text-soft);margin-top:2px">${bProds.length} produk tersedia</p>
        </div>
        <span style="background:var(--rose-pale);color:var(--rose-deep);padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid var(--rose-light)">${bProds.length} produk</span>
      </div>
      <div class="products-grid">${bProds.map(makeProductCard).join('')}</div>
    `;
    content.appendChild(sec);
  });
}

function filterProducts() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  if (!q) { renderBatchProducts(allProducts); return; }
  const filtered = allProducts.filter(p => p.name.toLowerCase().includes(q) || String(p.batch).includes(q) || (p.batch_name||'').toLowerCase().includes(q));
  renderBatchProducts(filtered);
}

/* ==================== PRODUCT DETAIL ==================== */
function showDetail(p) {
  currentProduct = p;
  const st = normalizeStatus(p.status);
  document.getElementById('detailTitle').textContent = p.name;
  document.getElementById('detailPrice').textContent = `Rp ${p.price.toLocaleString('id-ID')}`;
  document.getElementById('detailDesc').textContent = p.description || 'Aksesori eksklusif dari Vionae Collection — dibuat dengan perhatian pada detail yang menjadikan setiap momen terasa lebih istimewa.';
  document.getElementById('detailStatus').innerHTML = `<span class="product-status ${`status-${st}`}" style="position:static;display:inline-block">${statusLabel(st)}</span>`;

  const ratingVal = p.rating || 4.9;
  document.getElementById('detailStars').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <span style="font-size:20px;color:#f59e0b">★</span>
      <span style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text-dark)">${ratingVal}</span>
      <span style="font-size:13px;color:var(--text-soft)">/5.0</span>
    </div>`;

  // Build image slider
  const images = [];
  if (p.image) images.push(p.image);
  if (p.image2) images.push(p.image2);
  if (p.image3) images.push(p.image3);
  if (images.length === 0) images.push('https://placehold.co/400x400/fce8f1/d4547a?text=Vionae');

  const sliderContainer = document.getElementById('detailSlider');
  if (images.length > 1) {
    sliderContainer.innerHTML = `
      <div class="slider-track" id="sliderTrack" style="transform:translateX(0%)">
        ${images.map(img => `<img src="${img}" alt="${p.name}" onerror="this.src='https://placehold.co/400x400/fce8f1/d4547a?text=Vionae'" style="min-width:100%;max-height:420px;object-fit:cover;">`).join('')}
      </div>
      <button class="slider-btn prev" onclick="slideDetail(-1)"><i class="fas fa-chevron-left"></i></button>
      <button class="slider-btn next" onclick="slideDetail(1)"><i class="fas fa-chevron-right"></i></button>
      <div class="slider-dots">
        ${images.map((_,i) => `<div class="slider-dot ${i===0?'active':''}" onclick="goSlide(${i})"></div>`).join('')}
      </div>`;
    window._sliderIdx = 0;
    window._sliderTotal = images.length;
  } else {
    sliderContainer.innerHTML = `<img src="${images[0]}" alt="${p.name}" onerror="this.src='https://placehold.co/400x400/fce8f1/d4547a?text=Vionae'" style="width:100%;min-height:300px;max-height:420px;object-fit:cover;">`;
  }

  let actions = '';
  if (st === 'soldout') {
    actions = `<button style="padding:14px;border-radius:var(--radius-sm);border:none;background:#e2e8f0;color:#94a3b8;font-weight:600;cursor:not-allowed;width:100%"><i class="fas fa-ban"></i> Stok Habis</button>`;
  } else if (st === 'preorder') {
    actions = `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--radius-sm);padding:12px;margin-bottom:12px;font-size:13px;color:#92400e;line-height:1.6">
        <i class="fas fa-info-circle" style="color:#f59e0b"></i> Produk ini adalah <strong>Pre-order</strong>. Estimasi pengiriman akan dikonfirmasi via WhatsApp setelah pembayaran DP.
      </div>
      <button style="padding:14px;border-radius:var(--radius-sm);border:none;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:white;font-weight:600;width:100%;font-size:14px;display:flex;align-items:center;justify-content:center;gap:8px" onclick="openPreorderModal(currentProduct);closeModal('detailModal')">
        <i class="fas fa-clock"></i> Lakukan Pre-order
      </button>
      <button class="btn-secondary" style="justify-content:center;margin-top:10px" onclick="directBuyWA(currentProduct)"><i class="fab fa-whatsapp"></i> Tanya via WhatsApp</button>
    `;
  } else {
    actions = `
      <button class="btn-primary" style="justify-content:center" onclick="addToCart(currentProduct);closeModal('detailModal')"><i class="fas fa-shopping-bag"></i> Tambah ke Keranjang</button>
      <button class="btn-secondary" style="justify-content:center" onclick="directBuyWA(currentProduct)"><i class="fab fa-whatsapp"></i> Pesan via WhatsApp</button>
    `;
  }
  document.getElementById('detailActions').innerHTML = actions;
  openModal('detailModal');
}

function slideDetail(dir) {
  const total = window._sliderTotal || 1;
  window._sliderIdx = ((window._sliderIdx || 0) + dir + total) % total;
  goSlide(window._sliderIdx);
}

function goSlide(idx) {
  window._sliderIdx = idx;
  const track = document.getElementById('sliderTrack');
  if (track) track.style.transform = `translateX(-${idx * 100}%)`;
  document.querySelectorAll('.slider-dot').forEach((d, i) => {
    d.classList.toggle('active', i === idx);
  });
}

/* ==================== CART ==================== */
function addToCart(p) {
  const found = cart.find(c => c.id === p.id);
  if (found) found.qty = (found.qty||1) + 1;
  else cart.push({...p, qty: 1});
  saveCart();
  updateCartUI();
  showToast(`${p.name} ditambahkan ke keranjang! 🛍️`);
}

function removeFromCart(id) {
  cart = cart.filter(c => c.id !== id);
  saveCart();
  updateCartUI();
}

function changeQty(id, delta) {
  const item = cart.find(c => c.id === id);
  if (!item) return;
  item.qty = (item.qty||1) + delta;
  if (item.qty <= 0) removeFromCart(id);
  else { saveCart(); updateCartUI(); }
}

function cartSubtotal() { return cart.reduce((s, c) => s + c.price * (c.qty||1), 0); }
function cartTotal() { return cartSubtotal() + SHIPPING_FEE; } // termasuk ongkir

function updateCartUI() {
  const totalQty = cart.reduce((s,c) => s + (c.qty||1), 0);
  document.getElementById('cartBadge').textContent = totalQty;

  const body   = document.getElementById('cartBody');
  const footer = document.getElementById('cartFooter');

  if (!cart.length) {
    body.innerHTML = `<div class="cart-empty"><i class="fas fa-shopping-bag"></i><p>Keranjang masih kosong</p><button class="btn-secondary" style="margin-top:8px" onclick="showSection('products');toggleCart()">Lihat Produk</button></div>`;
    footer.style.display = 'none';
    return;
  }

  body.innerHTML = cart.map(c => `
    <div class="cart-item">
      <img src="${c.image}" onerror="this.src='https://placehold.co/70x70/fce8f1/d4547a?text=V'">
      <div style="flex:1">
        <div class="cart-item-name">${c.name}</div>
        <div class="cart-item-price">Rp ${c.price.toLocaleString('id-ID')}</div>
        <div class="cart-item-actions">
          <button class="qty-btn" onclick="changeQty(${c.id},-1)">−</button>
          <span class="qty-val">${c.qty||1}</span>
          <button class="qty-btn" onclick="changeQty(${c.id},1)">+</button>
          <button class="cart-rm" onclick="removeFromCart(${c.id})">Hapus</button>
        </div>
      </div>
    </div>
  `).join('');

  const sub        = cartSubtotal();
  const totalAkhir = sub + SHIPPING_FEE;   // ✅ subtotal + ongkir dari Supabase

  const breakdownEl = document.getElementById('cartBreakdown');
  if (breakdownEl) {
    const shipLabel = selectedKabupaten
      ? `${selectedKabupaten}${selectedKodePos ? ' · ' + selectedKodePos : ''}`
      : null;

    const ongkirDisplay = SHIPPING_FEE > 0
      ? `<span style="font-weight:600;color:var(--text-dark)">Rp ${SHIPPING_FEE.toLocaleString('id-ID')}</span>`
      : `<span style="color:#f59e0b;font-size:12px;font-weight:500">⚠ Pilih wilayah dulu</span>`;

    breakdownEl.innerHTML = `
      <div style="background:var(--rose-pale);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:14px">

        <!-- Subtotal Produk -->
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--text-mid);margin-bottom:10px">
          <span style="display:flex;align-items:center;gap:6px">
            <i class="fas fa-box" style="font-size:11px;color:var(--rose)"></i>
            Subtotal Produk
          </span>
          <span style="font-weight:600;color:var(--text-dark)">Rp ${sub.toLocaleString('id-ID')}</span>
        </div>

        <!-- Ongkos Kirim -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:13px;color:var(--text-mid);padding-bottom:12px;border-bottom:1px dashed var(--border)">
          <span>
            <span style="display:flex;align-items:center;gap:6px;margin-bottom:${shipLabel ? '3px' : '0'}">
              <i class="fas fa-truck" style="font-size:11px;color:var(--rose)"></i>
              Ongkos Kirim
            </span>
            ${shipLabel ? `<span style="font-size:11px;color:var(--rose-deep);font-weight:600;padding-left:17px">${shipLabel}</span>` : ''}
          </span>
          ${ongkirDisplay}
        </div>

        <!-- Total Bayar -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <span style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;color:var(--rose-deep)">
            <i class="fas fa-receipt" style="font-size:12px"></i>
            Total Bayar
          </span>
          <span style="font-size:16px;font-weight:800;color:var(--rose-deep)">
            Rp ${totalAkhir.toLocaleString('id-ID')}
          </span>
        </div>

      </div>
    `;
  }

  footer.style.display = 'block';

  // ✅ Re-enforce tombol state setelah UI dirender ulang
  toggleCheckoutBtn();
}

function toggleCart() {
  const panel = document.getElementById('cartPanel');
  const overlay = document.getElementById('cartOverlay');
  const isOpening = !panel.classList.contains('open');
  panel.classList.toggle('open');
  overlay.classList.toggle('open');
  // Reset checkbox when closing cart
  if (!isOpening) {
    const cb = document.getElementById('tncCheckbox');
    if (cb) { cb.checked = false; toggleCheckoutBtn(); }
  }
}

function toggleCheckoutBtn() {
  const checked = document.getElementById('tncCheckbox')?.checked;

  // ✅ Tombol Bayar Sekarang (Midtrans)
  const btnPay = document.getElementById('checkoutBtn');
  if (btnPay) {
    if (checked) {
      btnPay.disabled = false;
      btnPay.style.opacity = '1';
      btnPay.style.cursor = 'pointer';
      btnPay.style.pointerEvents = 'auto';
    } else {
      btnPay.disabled = true;
      btnPay.style.opacity = '0.45';
      btnPay.style.cursor = 'not-allowed';
      btnPay.style.pointerEvents = 'none';
    }
  }

  // ✅ Tombol Order via WhatsApp juga ikut disabled
  const btnWA = document.getElementById('checkoutWABtn');
  if (btnWA) {
    if (checked) {
      btnWA.disabled = false;
      btnWA.style.opacity = '1';
      btnWA.style.cursor = 'pointer';
      btnWA.style.pointerEvents = 'auto';
    } else {
      btnWA.disabled = true;
      btnWA.style.opacity = '0.45';
      btnWA.style.cursor = 'not-allowed';
      btnWA.style.pointerEvents = 'none';
    }
  }
}


/* ==================== MIDTRANS CONFIG ==================== */
// ⚠️  GANTI dengan Client Key Anda dari Midtrans Dashboard
// Dapatkan di: Settings → Access Keys
const MIDTRANS_CLIENT_KEY = 'SB-Mid-client-GANTI_DENGAN_CLIENT_KEY_ANDA';

// URL backend Node.js Anda
// Untuk testing lokal: 'http://localhost:3001'
// Untuk production: 'https://api.namadomain.com' atau URL Railway/Render Anda
const BACKEND_URL = ''; // Kosong = pakai domain yang sama (Vercel serverless functions di /api/...)

/* ==================== PAYMENT ==================== */
function openPayment() {
  if (!cart.length) { showToast('Keranjang masih kosong!', 'error'); return; }
  toggleCart();
  resetPayment();
  renderOrderItems();
  openModal('paymentModal');
}

function renderOrderItems() {
  const sub = cartSubtotal();
  const total = sub + SHIPPING_FEE;
  document.getElementById('payOrderItems').innerHTML = cart.map(c => `
    <div class="pay-product-row">
      <img src="${c.image}" onerror="this.src='https://placehold.co/64x64/fce8f1/d4547a?text=V'">
      <div style="flex:1">
        <div class="pay-product-name">${c.name}</div>
        <div class="pay-product-price">Rp ${c.price.toLocaleString('id-ID')}</div>
        <div class="pay-qty-ctrl">
          <button class="qty-btn" onclick="changeQty(${c.id},-1);renderOrderItems()">−</button>
          <span class="qty-val">${c.qty||1}</span>
          <button class="qty-btn" onclick="changeQty(${c.id},1);renderOrderItems()">+</button>
        </div>
      </div>
    </div>
  `).join('');
  document.getElementById('paySub').textContent = `Rp ${sub.toLocaleString('id-ID')}`;

  // ✅ Sync ongkir dari variabel SHIPPING_FEE (dari Supabase)
  const payShippingEl = document.getElementById('payShipping');
  if (payShippingEl) {
    if (!selectedKabupaten) {
      payShippingEl.innerHTML = `<span style="color:#f59e0b;font-size:12px;font-weight:500">⚠ Wilayah belum dipilih</span>`;
    } else {
      payShippingEl.innerHTML = `<span style="font-weight:600;color:var(--text-dark)">Rp ${SHIPPING_FEE.toLocaleString('id-ID')}</span>`;
    }
  }

  document.getElementById('payTotal').textContent = `Rp ${total.toLocaleString('id-ID')}`;
  // Update total di panel 3
  const snapTotal = document.getElementById('snapPayTotal');
  if (snapTotal) snapTotal.textContent = `Rp ${total.toLocaleString('id-ID')}`;
}

function goPayStep(step) {
  // Validasi step 2 → 3
  if (step === 3) {
    const name     = document.getElementById('pName').value.trim();
    const phone    = document.getElementById('pPhone').value.trim();
    const email    = document.getElementById('pEmail').value.trim();
    const addr     = document.getElementById('pAddress').value.trim();
    const city     = document.getElementById('pCity').value.trim();
    const postCode = document.getElementById('pPostCode').value.trim();
    if (!name || !phone || !email || !addr || !city || !postCode) {
      showToast('Lengkapi semua data pengiriman yang wajib (*) ya!', 'error');
      return;
    }
    // Validasi format email sederhana
    if (!/\S+@\S+\.\S+/.test(email)) {
      showToast('Format email tidak valid!', 'error');
      return;
    }
    // Update total di panel 3 saat masuk
    const snapTotal = document.getElementById('snapPayTotal');
    if (snapTotal) snapTotal.textContent = `Rp ${(cartSubtotal()+SHIPPING_FEE).toLocaleString('id-ID')}`;
  }

  currentPayStep = step;
  document.querySelectorAll('.payment-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('payPanel' + step).classList.add('active');

  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('pStep' + i);
    el.classList.remove('active', 'done');
    if (i < step) el.classList.add('done');
    if (i === step) el.classList.add('active');
  }
}

/* ── Midtrans Snap: Fungsi Utama Pembayaran ─────────────────── */
async function startMidtransPayment() {
  const btn = document.getElementById('snapPayBtn');
  const overlay = document.getElementById('midtransLoadingOverlay');

  // Tampilkan loading
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menyiapkan...';
  if (overlay) overlay.style.display = 'flex';

  try {
    // Request token ke backend
    const response = await fetch(`${BACKEND_URL}/api/create-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(c => ({
          id:    String(c.id),
          name:  c.name,
          price: c.price,
          qty:   c.qty || 1,
        })),
        customer: {
          first_name: (document.getElementById('pName')?.value.trim() || '').split(' ')[0],
          last_name:  (document.getElementById('pName')?.value.trim() || '').split(' ').slice(1).join(' ') || '-',
          name:       document.getElementById('pName')?.value.trim() || '',
          phone:      document.getElementById('pPhone')?.value.trim() || '',
          email:      document.getElementById('pEmail')?.value.trim() || '',
          address:    document.getElementById('pAddress')?.value.trim() || '',
          city:       document.getElementById('pCity')?.value.trim() || '',
          postal_code: document.getElementById('pPostCode')?.value.trim() || '',
          country_code: 'IDN',
          note:       document.getElementById('pNote')?.value.trim() || '',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || 'Gagal memproses pembayaran');

    if (overlay) overlay.style.display = 'none';

    // Buka Snap pop-up
    window.snap.pay(data.token, {

      onSuccess: function(result) {
        // Catatan: notifikasi WA TIDAK dikirim otomatis lagi.
        // Snapshot data order disimpan agar tombol "Konfirmasi via WhatsApp"
        // di layar sukses masih bisa dipakai customer walau `cart` sudah dikosongkan.
        snapshotLastOrder(data.order_id, 'BERHASIL ✅', result.payment_type);
        cart = []; saveCart(); updateCartUI();
        showPayResult('success', data.order_id, result.payment_type);
        showToast('Pembayaran berhasil! Terima kasih 💗');
      },

      onPending: function(result) {
        snapshotLastOrder(data.order_id, 'MENUNGGU PEMBAYARAN ⏳', result.payment_type);
        cart = []; saveCart(); updateCartUI();
        showPayResult('pending', data.order_id, result.payment_type);
        showToast('Instruksi pembayaran sudah dikirim!');
      },

      onError: function(result) {
        showToast('Pembayaran gagal. Coba lagi atau pilih metode lain.', 'error');
        resetSnapBtn();
        console.error('Midtrans error:', result);
      },

      onClose: function() {
        showToast('Pop-up ditutup. Keranjang masih tersimpan.', 'error');
        resetSnapBtn();
      },
    });

  } catch (err) {
    console.error('[startMidtransPayment]', err);
    if (overlay) overlay.style.display = 'none';
    showToast(`Gagal: ${err.message}`, 'error');
    resetSnapBtn();
  }
}

function resetSnapBtn() {
  const btn = document.getElementById('snapPayBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-lock"></i> Bayar Sekarang ';
  }
}

function showPayResult(type, orderId, paymentType) {
  currentPayStep = 4;
  document.querySelectorAll('.payment-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('payPanel4').classList.add('active');
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('pStep' + i);
    el.classList.remove('active', 'done');
    if (i < 4) el.classList.add('done');
    if (i === 4) el.classList.add('active');
  }

  const configs = {
    success: {
      icon:  '🎉',
      title: 'Pembayaran Berhasil!',
      msg:   `Pembayaran via ${formatPaymentType(paymentType)} telah terkonfirmasi. Order ID: ${orderId}. Tim Vionae Collection akan segera memproses pesananmu. 💗`,
      detail: `<i class="fas fa-check-circle" style="color:#10b981;margin-right:6px"></i> Pembayaran terkonfirmasi otomatis<br><i class="fas fa-clock" style="color:var(--rose);margin-right:6px"></i> Tim Vionae akan konfirmasi via WA kamu<br><i class="fas fa-truck" style="color:#2563eb;margin-right:6px"></i> Pesanan akan segera diproses`,
    },
    pending: {
      icon:  '⏳',
      title: 'Selesaikan Pembayaran',
      msg:   `Instruksi pembayaran ${formatPaymentType(paymentType)} sudah dikirimkan. Order ID: ${orderId}. Pesanan akan diproses setelah pembayaran terkonfirmasi.`,
      detail: `<i class="fas fa-info-circle" style="color:#f59e0b;margin-right:6px"></i> Selesaikan pembayaran sesuai instruksi<br><i class="fas fa-clock" style="color:var(--rose);margin-right:6px"></i> Pesanan diproses setelah konfirmasi<br><i class="fab fa-whatsapp" style="color:#25d366;margin-right:6px"></i> Tim Vionae siap bantu via WhatsApp`,
    },
  };

  const cfg = configs[type] || configs.pending;
  const iconEl   = document.getElementById('payResultIcon');
  const titleEl  = document.getElementById('payResultTitle');
  const msgEl    = document.getElementById('payResultMsg');
  const detailEl = document.getElementById('payResultDetail');
  if (iconEl)   iconEl.textContent  = cfg.icon;
  if (titleEl)  titleEl.textContent = cfg.title;
  if (msgEl)    msgEl.textContent   = cfg.msg;
  if (detailEl) detailEl.innerHTML  = cfg.detail;
}

/* ── WA Backup Notification ────────────────────────────────── */
// Ambil snapshot cart + data pelanggan SEBELUM cart dikosongkan, supaya tombol
// WA opsional di layar sukses masih punya data lengkap untuk ditampilkan.
function snapshotLastOrder(orderId, statusLabel, paymentType) {
  lastOrderId = orderId;
  lastOrderStatusLabel = statusLabel;
  lastOrderPaymentType = paymentType;
  lastOrderItems = cart.map(c => ({ name: c.name, qty: c.qty || 1, price: c.price }));
  lastOrderCustomer = {
    name:     document.getElementById('pName')?.value.trim()     || '-',
    phone:    document.getElementById('pPhone')?.value.trim()    || '-',
    email:    document.getElementById('pEmail')?.value.trim()    || '-',
    address:  document.getElementById('pAddress')?.value.trim()  || '-',
    city:     document.getElementById('pCity')?.value.trim()     || '-',
    postCode: document.getElementById('pPostCode')?.value.trim() || '-',
    note:     document.getElementById('pNote')?.value.trim()     || '',
  };
  lastOrderShipping = {
    info: selectedKabupaten ? `${selectedKabupaten}${selectedKodePos ? ' (' + selectedKodePos + ')' : ''}` : '-',
    fee: SHIPPING_FEE,
  };
}

// Dipanggil MANUAL oleh customer lewat tombol "Konfirmasi via WhatsApp" di layar
// sukses/pending — tidak lagi terpanggil otomatis setelah pembayaran selesai.
function sendOrderNotificationToWA(orderId, statusLabel, paymentType) {
  if (!orderId) { showToast('Data pesanan tidak ditemukan.', 'error'); return; }

  const c = lastOrderCustomer || {};
  const sub = lastOrderItems.reduce((s, it) => s + it.price * it.qty, 0);
  const total = sub + (lastOrderShipping.fee || 0);

  let msg = `🌸 *PESANAN BARU — Vionae Collection*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🆔 *Order ID:* ${orderId}\n`;
  msg += `💳 *Status:* ${statusLabel}\n`;
  msg += `🏦 *Metode:* ${formatPaymentType(paymentType)}\n\n`;
  msg += `📦 *Detail Pesanan:*\n`;
  lastOrderItems.forEach(it => {
    msg += `• ${it.name} x${it.qty} — Rp ${(it.price * it.qty).toLocaleString('id-ID')}\n`;
  });
  msg += `\n💵 Subtotal  : Rp ${sub.toLocaleString('id-ID')}\n`;
  msg += `📍 Pengiriman: ${lastOrderShipping.info} | Ongkir: Rp ${(lastOrderShipping.fee || 0).toLocaleString('id-ID')}\n`;
  msg += `💰 *Total Akhir: Rp ${total.toLocaleString('id-ID')}*\n`;
  msg += `\n👤 *Data Pengiriman:*\n`;
  msg += `Nama    : ${c.name || '-'}\nWA/Telp : ${c.phone || '-'}\nEmail   : ${c.email || '-'}\nAlamat  : ${c.address || '-'}, ${c.city || '-'} ${c.postCode || ''}\n`;
  if (c.note) msg += `Catatan : ${c.note}\n`;
  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Pembayaran otomatis via Midtrans Snap_ 🛍️`;

  window.open(`https://wa.me/6287848785581?text=${encodeURIComponent(msg)}`, '_blank');
}

/* ── Fallback: langsung ke WA jika Midtrans bermasalah ─────── */
function fallbackToWA() {
  const name     = document.getElementById('pName')?.value.trim()     || '';
  const phone    = document.getElementById('pPhone')?.value.trim()    || '';
  const email    = document.getElementById('pEmail')?.value.trim()    || '';
  const addr     = document.getElementById('pAddress')?.value.trim()  || '';
  const city     = document.getElementById('pCity')?.value.trim()     || '';
  const postCode = document.getElementById('pPostCode')?.value.trim() || '';
  const note     = document.getElementById('pNote')?.value.trim()     || '';
  const sub      = cartSubtotal();
  const total    = sub + SHIPPING_FEE;
  const shipInfo = selectedKabupaten
    ? `${selectedKabupaten}${selectedKodePos ? ' ('+selectedKodePos+')' : ''}`
    : '-';

  let msg = `🌸 *PESANAN BARU - Vionae Collection*\n━━━━━━━━━━━━━━━━━━━━\n\n📦 *Detail Pesanan:*\n`;
  cart.forEach(c => { msg += `• ${c.name} x${c.qty||1} — Rp ${(c.price*(c.qty||1)).toLocaleString('id-ID')}\n`; });
  msg += `\n💵 Subtotal  : Rp ${sub.toLocaleString('id-ID')}\n`;
  msg += `📍 Pengiriman: ${shipInfo} | Ongkir: Rp ${SHIPPING_FEE.toLocaleString('id-ID')}\n`;
  msg += `💰 *Total Akhir: Rp ${total.toLocaleString('id-ID')}*\n`;
  msg += `\n👤 *Data Pengiriman:*\nNama: ${name}\nWA/Telp: ${phone}\nEmail: ${email}\nAlamat: ${addr}, ${city} ${postCode}\n`;
  if (note) msg += `Catatan: ${note}\n`;
  msg += `\nMohon info rekening/QRIS untuk pembayaran ya! 🙏`;

  window.open(`https://wa.me/6287848785581?text=${encodeURIComponent(msg)}`, '_blank');
  cart = []; saveCart(); updateCartUI();
  showPayResult('pending', 'Via-WA', 'whatsapp');
  closeModal('paymentModal');
  showToast('Pesanan dikirim ke WhatsApp! 💗');
}

function formatPaymentType(type) {
  const map = {
    'qris':'QRIS','gopay':'GoPay','shopeepay':'ShopeePay',
    'bca_va':'Virtual Account BCA','bni_va':'Virtual Account BNI',
    'bri_va':'Virtual Account BRI','mandiri_bill':'Virtual Account Mandiri',
    'permata_va':'Virtual Account Permata','other_va':'Virtual Account',
    'whatsapp':'WhatsApp',
  };
  return map[type] || (type ? type.toUpperCase() : '-');
}

function copyText(txt) {
  navigator.clipboard.writeText(txt).then(() => showToast('Disalin ke clipboard!'));
}

function resetPayment() {
  currentPayStep = 1;
  selectedPayMethod = null;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('pStep' + i);
    el.classList.remove('active', 'done');
    if (i === 1) el.classList.add('active');
  }
  document.querySelectorAll('.payment-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('payPanel1').classList.add('active');
  resetSnapBtn();
  const overlay = document.getElementById('midtransLoadingOverlay');
  if (overlay) overlay.style.display = 'none';
}

function checkoutWA() {
  // ✅ Validasi keranjang
  if (!cart.length) { showToast('Keranjang masih kosong!', 'error'); return; }

  // ✅ Validasi S&K checkbox
  const tncChecked = document.getElementById('tncCheckbox')?.checked;
  if (!tncChecked) {
    showToast('Centang Syarat & Ketentuan dulu ya! ✅', 'error');
    document.getElementById('tncCheckbox')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // ✅ Validasi lokasi pengiriman
  if (!selectedKabupaten) { showToast('Pilih wilayah pengiriman dulu ya! 📍', 'error'); return; }

  toggleCart();

  const sub        = cartSubtotal();
  const totalAkhir = sub + SHIPPING_FEE;   // ✅ pakai totalAkhir yang benar
  const shipInfo   = `${selectedKabupaten}${selectedKodePos ? ' (' + selectedKodePos + ')' : ''}`;

  let msg = `🌸 *PESANAN BARU - Vionae Collection*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📦 *Detail Pesanan:*\n`;
  cart.forEach(c => {
    const lineTotal = c.price * (c.qty||1);
    msg += `• ${c.name}\n`;
    msg += `  ${c.qty||1} pcs × Rp ${c.price.toLocaleString('id-ID')} = Rp ${lineTotal.toLocaleString('id-ID')}\n`;
  });
  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💵 Subtotal Produk : Rp ${sub.toLocaleString('id-ID')}\n`;
  msg += `🚚 Ongkos Kirim    : Rp ${SHIPPING_FEE.toLocaleString('id-ID')}\n`;
  msg += `📍 Lokasi Pengiriman: ${shipInfo}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💰 *Total Bayar: Rp ${totalAkhir.toLocaleString('id-ID')}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Mohon bantu konfirmasi ketersediaan dan info rekening/QRIS untuk pembayaran ya! 🙏`;

  window.open(`https://wa.me/6287848785581?text=${encodeURIComponent(msg)}`, '_blank');
  cart = []; saveCart(); updateCartUI();
  showToast('Pesanan dikirim ke WhatsApp! 💗');
}

/* ==================== TESTIMONIALS ==================== */
async function fetchTestimonials() {
  const grid = document.getElementById('testimonialsGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="spinner"><i class="fas fa-circle-notch"></i></div>';
  try {
    const data = await sb('ulasan');
    if (!data.length) { grid.innerHTML = '<p style="text-align:center;color:var(--text-soft);padding:40px">Belum ada testimoni.</p>'; return; }
    grid.innerHTML = data.map(t => `
      <div class="testimonial-card">
        <div class="testimonial-quote">"</div>
        <p class="testimonial-text">${t.testimonial}</p>
        <div class="testimonial-author">
          <div class="testimonial-avatar">${t.name.charAt(0).toUpperCase()}</div>
          <div>
            <div class="testimonial-name">${t.name}</div>
            <div class="testimonial-stars">${Array.from({length:5},(_,i)=> i<t.rating?'★':'☆').join('')}</div>
          </div>
        </div>
      </div>
    `).join('');
  } catch(e) {
    grid.innerHTML = '<p style="text-align:center;color:#ef4444;padding:40px">Gagal memuat testimoni.</p>';
  }
}

/* ==================== NEWS ==================== */
async function fetchNews() {
  const homeGrid = document.getElementById('homeNewsGrid');
  if (homeGrid) homeGrid.innerHTML = '<div class="spinner"><i class="fas fa-circle-notch"></i></div>';
  try {
    const data = await sb('berita');
    const makeCard = n => `
      <div class="news-card" onclick='showNewsModal(${JSON.stringify(n)})'>
        <img src="${n.images||'https://placehold.co/400x200/fce8f1/d4547a?text=Vionae+News'}" alt="${n.title}" loading="lazy">
        <div class="news-card-body">
          <h3>${n.title}</h3>
          <p>${(n.description||'').substring(0,100)}${(n.description||'').length>100?'...':''}</p>
          <div class="news-read-more">Baca Selengkapnya <i class="fas fa-arrow-right"></i></div>
        </div>
      </div>
    `;
    if (homeGrid) homeGrid.innerHTML = data.slice(0,3).map(makeCard).join('');
  } catch(e) {
    if (homeGrid) homeGrid.innerHTML = '<p style="text-align:center;color:#ef4444;padding:40px">Gagal memuat berita.</p>';
  }
}

function showNewsModal(n) {
  document.getElementById('newsModalTitle').textContent = n.title;
  document.getElementById('newsModalImg').src = n.images || 'https://placehold.co/800x400/fce8f1/d4547a?text=Vionae';
  document.getElementById('newsModalContent').textContent = n.description || '';
  openModal('newsModal');
}

/* ==================== PRE-ORDER ==================== */
let currentPreorderProduct = null;

function openPreorderModal(p) {
  currentPreorderProduct = p;
  document.getElementById('poImg').src = p.image || 'https://placehold.co/70x70/fce8f1/d4547a?text=V';
  document.getElementById('poName').textContent = p.name;
  document.getElementById('poPrice').textContent = `Rp ${p.price.toLocaleString('id-ID')}`;
  document.getElementById('poBatch').textContent = p.batch_name ? p.batch_name : `Batch ${p.batch}`;
  // Reset form
  ['poFormName','poFormPhone','poFormAddress','poFormNote'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('poFormQty').value = '1';
  openModal('preorderModal');
}

function submitPreorder() {
  const p = currentPreorderProduct;
  if (!p) return;
  const name = document.getElementById('poFormName').value.trim();
  const phone = document.getElementById('poFormPhone').value.trim();
  const address = document.getElementById('poFormAddress').value.trim();
  const qty = parseInt(document.getElementById('poFormQty').value) || 1;
  const note = document.getElementById('poFormNote').value.trim();

  if (!name || !phone || !address) {
    showToast('Lengkapi nama, nomor WA, dan alamat dulu ya!', 'error');
    return;
  }

  const batchLabel = p.batch_name ? p.batch_name : `Batch ${p.batch}`;
  const totalDP = Math.ceil(p.price * qty * 0.5);

  let msg = `🌸 *Halo Vionae! Saya ingin Pre-Order:*\n\n`;
  msg += `📦 *Produk:* ${p.name}\n`;
  msg += `🏷️ *Batch:* ${batchLabel}\n`;
  msg += `💰 *Harga/pcs:* Rp ${p.price.toLocaleString('id-ID')}\n`;
  msg += `🔢 *Jumlah:* ${qty} pcs\n`;
  msg += `💵 *Total:* Rp ${(p.price * qty).toLocaleString('id-ID')}\n`;
  msg += `💳 *Estimasi DP (50%):* Rp ${totalDP.toLocaleString('id-ID')}\n\n`;
  msg += `👤 *Data Pemesan:*\n`;
  msg += `Nama: ${name}\n`;
  msg += `WA: ${phone}\n`;
  msg += `Alamat: ${address}\n`;
  if (note) msg += `Catatan: ${note}\n`;
  msg += `\nMohon konfirmasi ketersediaan, estimasi pengiriman, dan info pembayaran DP ya! 🙏`;

  window.open(`https://wa.me/6287848785581?text=${encodeURIComponent(msg)}`, '_blank');
  closeModal('preorderModal');
  showToast('Pre-order dikirim! Tim kami akan segera menghubungi 💗');
}

/* ==================== GACHA ==================== */
async function openGacha() {
  gachaSpun = false;
  gachaPrize = null;
  document.getElementById('gachaCodeInput').value = '';
  document.getElementById('gachaResult').textContent = 'Masukkan kode promo untuk mulai';
  document.getElementById('gachaResult').style.color = 'var(--rose-deep)';
  document.getElementById('gachaScreen').textContent = '🎁 MASUKKAN KODE PROMO';
  document.getElementById('gachaSpinBtn').disabled = true;
  document.getElementById('gachaClaimRow').style.display = 'none';
  openModal('gachaModal');

  try {
    const prizes = await sb('prizes?is_active=eq.true');
    gachaPrizes = prizes.length ? prizes : [
      {id:1,name:'Diskon 10%'},{id:2,name:'Bonus Aksesoris Random'},
      {id:3,name:'Free Ongkir'},{id:4,name:'Buy 1 Get 1'},{id:5,name:'Diskon 50%'}
    ];
  } catch { gachaPrizes = [{id:1,name:'Diskon 10%'},{id:2,name:'Free Ongkir'}]; }
}

async function verifyGachaCode() {
  const code = document.getElementById('gachaCodeInput').value.trim().toUpperCase();
  document.getElementById('gachaCodeInput').value = code;
  const res = document.getElementById('gachaResult');
  const screen = document.getElementById('gachaScreen');
  if (!code) { res.textContent = '❌ Masukkan kode dulu ya!'; return; }

  res.textContent = '🔍 Memverifikasi...';
  res.style.color = 'var(--text-mid)';
  screen.textContent = 'MEMVERIFIKASI...';
  document.getElementById('gachaSpinBtn').disabled = true;

  try {
    // Ambil kode tanpa filter is_active agar bisa beri pesan error spesifik
    const data = await sb(`promo_codes?code=eq.${encodeURIComponent(code)}`);

    if (!data.length) {
      throw new Error('Kode tidak ditemukan');
    }
    const c = data[0];

    if (!c.is_active) {
      throw new Error('Kode sudah pernah dipakai atau tidak aktif');
    }
    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      throw new Error('Kode sudah kadaluarsa');
    }
    const used = c.used_count === null ? 0 : parseInt(c.used_count);
    if (used >= parseInt(c.max_uses)) {
      throw new Error('Kode sudah mencapai batas pemakaian');
    }

    res.textContent = '✅ Kode valid! Siap spin!';
    res.style.color = '#10b981';
    screen.textContent = 'KODE VALID! SPIN!';
    document.getElementById('gachaSpinBtn').disabled = false;
  } catch(e) {
    res.textContent = `❌ ${e.message}`;
    res.style.color = '#ef4444';
    screen.textContent = 'VERIFIKASI GAGAL';
    document.getElementById('gachaSpinBtn').disabled = true;
  }
}

async function doSpin() {
  if (gachaSpun) return;

  const code = document.getElementById('gachaCodeInput').value.trim().toUpperCase();
  const screen = document.getElementById('gachaScreen');
  const res = document.getElementById('gachaResult');

  // ⚠️ LANGKAH 1: Nonaktifkan kode di Supabase DULU sebelum spin
  // Ini mencegah race condition — kode langsung tidak bisa dipakai lagi
  try {
    const codes = await sb(`promo_codes?code=eq.${encodeURIComponent(code)}&is_active=eq.true`);
    if (!codes.length) {
      res.textContent = '❌ Kode sudah tidak valid atau sudah dipakai!';
      res.style.color = '#ef4444';
      return;
    }

    const c = codes[0];
    const used = c.used_count === null ? 0 : parseInt(c.used_count);

    // Nonaktifkan kode SEGERA — pakai sbPatch yang benar
    const patchRes = await sbPatch(`promo_codes?id=eq.${c.id}`, {
      used_count: used + 1,
      is_active: false
    });

    if (!patchRes.ok) {
      throw new Error('Gagal memproses kode');
    }

    // ⚠️ LANGKAH 2: Baru mulai spin setelah kode berhasil dinonaktifkan
    gachaSpun = true;
    document.getElementById('gachaSpinBtn').disabled = true;
    screen.textContent = '🎰 SPINNING...';

    let tick = 0;
    const anim = setInterval(() => {
      const p = gachaPrizes[tick % gachaPrizes.length];
      screen.textContent = p?.name || '...';
      tick++;
    }, 100);

    await new Promise(r => setTimeout(r, 2000));
    clearInterval(anim);

    gachaPrize = gachaPrizes[Math.floor(Math.random() * gachaPrizes.length)];
    screen.innerHTML = `🎉 ${gachaPrize.name}`;
    res.textContent = `🎉 Selamat! Kamu dapat: ${gachaPrize.name}`;
    res.style.color = 'var(--rose-deep)';
    document.getElementById('gachaClaimRow').style.display = 'flex';

    // Catat ke tabel spins
    await sbPost(`spins`, { promo_code_id: c.id, prize_id: gachaPrize.id });

  } catch(e) {
    console.error('Spin error:', e);
    res.textContent = `❌ Error: ${e.message}`;
    res.style.color = '#ef4444';
    gachaSpun = false;
    document.getElementById('gachaSpinBtn').disabled = false;
  }
}

function claimGachaPrize() {
  if (!gachaPrize) return;
  const msg = `Halo Vionae! 🎉 Saya baru dapat hadiah dari Lucky Spin:\n\n*${gachaPrize.name}*\n\nMohon bantu proses klaim hadiah ini ya! Terima kasih 🙏`;
  window.open(`https://wa.me/6287848785581?text=${encodeURIComponent(msg)}`, '_blank');
  closeModal('gachaModal');
}

/* ==================== FAQ ==================== */
function toggleFaq(btn) {
  const item = btn.closest('.faq-item');
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(f => f.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

/* ==================== CONTACT ==================== */

/** Tampilkan pesan error di bawah field secara elegan */
function setFieldError(fieldId, errorId, message) {
  const field = document.getElementById(fieldId);
  let errEl = document.getElementById(errorId);

  // Buat elemen error jika belum ada
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = errorId;
    errEl.className = 'field-error-msg';
    errEl.innerHTML = `<i class="fas fa-exclamation-circle"></i><span></span>`;
    field.parentNode.appendChild(errEl);
  }

  if (message) {
    field.classList.add('is-error');
    errEl.querySelector('span').textContent = message;
    // force reflow agar transisi bekerja
    errEl.offsetHeight;
    errEl.classList.add('show');
  } else {
    field.classList.remove('is-error');
    errEl.classList.remove('show');
  }
}

/** Bersihkan semua error di form kontak */
function clearContactErrors() {
  ['cName', 'cType', 'cMessage'].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.classList.remove('is-error');
  });
  ['err-cName', 'err-cType', 'err-cMessage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });
}

function sendContact() {
  const nameEl    = document.getElementById('cName');
  const typeEl    = document.getElementById('cType');
  const contactEl = document.getElementById('cContact');
  const msgEl     = document.getElementById('cMessage');

  const name    = nameEl.value.trim();
  const type    = typeEl.value;
  const contact = contactEl.value.trim();
  const msg     = msgEl.value.trim();

  // Reset semua error dulu
  clearContactErrors();

  let hasError = false;

  if (!name) {
    setFieldError('cName', 'err-cName', 'Nama wajib diisi');
    hasError = true;
  }
  if (!type) {
    setFieldError('cType', 'err-cType', 'Pilih jenis permintaan terlebih dahulu');
    hasError = true;
  }
  if (!msg) {
    setFieldError('cMessage', 'err-cMessage', 'Pesan tidak boleh kosong');
    hasError = true;
  }

  if (hasError) {
    // Scroll ke field pertama yang error
    const firstError = document.querySelector('.form-input.is-error, .form-select.is-error, .form-textarea.is-error');
    if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Hapus error setelah user mulai mengetik
  [nameEl, typeEl, msgEl].forEach(el => {
    el.addEventListener('input', () => {
      el.classList.remove('is-error');
      const errId = 'err-' + el.id;
      const errEl = document.getElementById(errId);
      if (errEl) errEl.classList.remove('show');
    }, { once: true });
  });

  const text = `Halo Vionae! 🌸\n\nNama: ${name}\nJenis: ${type}\nKontak: ${contact || '-'}\n\n${msg}`;
  window.open(`https://wa.me/6287848785581?text=${encodeURIComponent(text)}`, '_blank');
}

/* ==================== SCROLL REVEAL ==================== */
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target); // animasi hanya sekali
      }
    });
  }, {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  // Pasang ke semua section headers, cards, grids
  document.querySelectorAll(
    '.section-header, .product-card, .promo-card, .service-card, ' +
    '.testimonial-card, .news-card, .step-card, .stat-item, ' +
    '.contact-info-card, .form-card, .vm-card, .founder-card, ' +
    '.stats-bar, .faq-item, .hero-pill'
  ).forEach(el => {
    el.classList.add('reveal');
    observer.observe(el);
  });
}

/* ==================== INIT ==================== */
document.addEventListener('DOMContentLoaded', () => {
  loadCart();
  fetchFeatured();
  fetchAllProducts();
  fetchNews();
  // ✅ fetchShippingRates() sudah memanggil updateCartUI() di dalamnya
  // setelah data Supabase selesai dimuat — ini fix race condition ongkir
  fetchShippingRates();

  // Scroll Reveal
  initScrollReveal();

  // Re-init reveal saat section berganti (karena display:none)
  // MutationObserver untuk memantau perubahan kelas .visible
  const secObserver = new MutationObserver(() => {
    document.querySelectorAll('.section.visible .reveal:not(.revealed)').forEach(el => {
      el.classList.add('revealed');
    });
  });
  document.querySelectorAll('.section').forEach(sec => {
    secObserver.observe(sec, { attributes: true, attributeFilter: ['class'] });
  });

  // Hash nav
  const hash = window.location.hash.replace('#','');
  const valid = ['home','products','services','testimonials','contact','about','kebijakan'];
  if (valid.includes(hash)) showSection(hash);
  else showSection('home');
});
