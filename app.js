// Konfigurasi Supabase (Dapatkan dari Project Settings > API)
const SUPABASE_URL = 'https://XXXX.supabase.co';
const SUPABASE_KEY = 'eyJhbG...'; // Masukkan anon public key Anda
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// URL Google Apps Script Web App (Proxy PDF)
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfyc.../exec';
const ITEM_ID = 'suara-gkpi-nov-26';

// State Global
let currentUser = null;
let hasPurchased = false;
let pdfDoc = null;
let pageNum = 1;

// Referensi DOM
const views = {
  auth: document.getElementById('auth-view'),
  dashboard: document.getElementById('dashboard-view'),
  reader: document.getElementById('reader-view')
};
const modalPayment = document.getElementById('payment-modal');
const btnAction = document.getElementById('btn-action');
const watermark = document.getElementById('watermark');

// --- MANAJEMEN TAMPILAN ---
function showView(viewName) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  if(viewName !== 'reader') views[viewName].classList.remove('hidden');
  else views[viewName].classList.remove('hidden', 'flex-col');
  
  if(viewName === 'reader') views[viewName].classList.add('flex', 'flex-col');
}

// --- OTENTIKASI ---
async function checkUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    currentUser = user;
    checkPurchase();
    showView('dashboard');
  } else {
    showView('auth');
  }
}

document.getElementById('btn-login').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) alert(error.message); else checkUser();
});

document.getElementById('btn-register').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) alert(error.message); else {
    alert('Registrasi berhasil! Silakan masuk.');
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentUser = null;
  hasPurchased = false;
  showView('auth');
});

// --- PEMBELIAN ---
async function checkPurchase() {
  const { data, error } = await supabase
    .from('user_purchases')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('item_id', ITEM_ID);

  if (data && data.length > 0) {
    hasPurchased = true;
    btnAction.textContent = "Baca Sekarang";
    btnAction.classList.replace('bg-blue-600', 'bg-green-600');
  } else {
    btnAction.textContent = "Beli Edisi Ini";
  }
}

btnAction.addEventListener('click', () => {
  if (hasPurchased) openReader();
  else modalPayment.classList.replace('hidden', 'flex');
});

document.getElementById('btn-cancel-payment').addEventListener('click', () => {
  modalPayment.classList.replace('flex', 'hidden');
});

// Simulasi Konfirmasi Pembayaran
document.getElementById('btn-confirm-payment').addEventListener('click', async () => {
  const { error } = await supabase
    .from('user_purchases')
    .insert([{ user_id: currentUser.id, item_id: ITEM_ID }]);
  
  if (!error) {
    modalPayment.classList.replace('flex', 'hidden');
    checkPurchase(); // Update UI tombol
    alert('Pembayaran Berhasil!');
  } else {
    alert('Gagal mencatat transaksi.');
  }
});

// --- PDF READER TERTUTUP ---
async function openReader() {
  showView('reader');
  // Atur Watermark berulang
  const wmText = `${currentUser.email} | GKPI Digital | `.repeat(20);
  watermark.textContent = wmText;

  if (pdfDoc) return; // Jangan fetch ulang jika sudah diload
  
  btnAction.textContent = "Memuat...";
  try {
    // Ambil string Base64 dari Apps Script
    const response = await fetch(SCRIPT_URL);
    const base64Pdf = await response.text();
    
    // Convert Base64 ke Uint8Array
    const binary = atob(base64Pdf);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    
    // Render menggunakan PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    btnAction.textContent = "Baca Sekarang";
    renderPage(pageNum);
  } catch (error) {
    alert("Gagal memuat dokumen.");
    showView('dashboard');
  }
}

async function renderPage(num) {
  const page = await pdfDoc.getPage(num);
  const canvas = document.getElementById('pdf-canvas');
  const ctx = canvas.getContext('2d');
  
  // Sesuaikan skala dengan lebar layar HP
  const viewport = page.getViewport({ scale: window.innerWidth > 600 ? 1.5 : 1.0 });
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
  
  document.getElementById('page-info').textContent = `Halaman ${num} / ${pdfDoc.numPages}`;
  document.getElementById('btn-prev').disabled = num <= 1;
  document.getElementById('btn-next').disabled = num >= pdfDoc.numPages;
}

document.getElementById('btn-prev').addEventListener('click', () => {
  if (pageNum <= 1) return;
  pageNum--; renderPage(pageNum);
});

document.getElementById('btn-next').addEventListener('click', () => {
  if (pageNum >= pdfDoc.numPages) return;
  pageNum++; renderPage(pageNum);
});

document.getElementById('btn-close-reader').addEventListener('click', () => {
  showView('dashboard');
});

// Init
checkUser();

// --- PWA SERVICE WORKER ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}
