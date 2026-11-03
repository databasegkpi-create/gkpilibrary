/**
 * KONFIGURASI UTAMA
 * Ganti nilai-nilai ini dengan data proyek Anda
 */
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// URL Web App Google Apps Script
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
// Email yang berhak mengakses panel admin
const ADMIN_EMAIL = 'admin@gkpi.org'; 

/**
 * STATE APLIKASI
 */
let currentUser = null;
let catalog = [];         // Array untuk menyimpan data buku dari DB
let userPurchases = [];   // Array ID buku yang sudah dibeli user
let activeItemForPayment = null; 
let pdfDoc = null;
let pageNum = 1;

/**
 * REFERENSI DOM
 */
const views = ['view-library', 'view-mybooks', 'view-profile', 'view-admin'];
const navBtns = ['nav-library', 'nav-mybooks', 'nav-profile', 'nav-admin'];
const spinner = document.getElementById('loading-spinner');

// --- FUNGSI UTILITAS ---
const showLoading = () => spinner.classList.remove('hidden');
const hideLoading = () => spinner.classList.add('hidden');
const formatRupiah = (number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(number);

// --- ROUTING NAVIGASI BAWAH ---
function switchTab(targetView, headerTitle, activeNavId) {
  // Sembunyikan semua view
  views.forEach(id => document.getElementById(id).classList.add('hidden'));
  // Tampilkan view target
  document.getElementById(targetView).classList.remove('hidden');
  document.getElementById('app-header').textContent = headerTitle;
  
  // Reset gaya semua tombol nav
  navBtns.forEach(id => {
    const btn = document.getElementById(id);
    if(btn) {
      btn.classList.remove('text-blue-600', 'font-bold');
      if (id !== 'nav-admin') btn.classList.add('text-gray-500'); // Admin pakai text-gray-800 default
    }
  });

  // Highlight tombol aktif
  const activeBtn = document.getElementById(activeNavId);
  if (activeNavId === 'nav-admin') {
      activeBtn.classList.add('text-gray-800', 'font-bold');
  } else {
      activeBtn.classList.add('text-blue-600', 'font-bold');
      activeBtn.classList.remove('text-gray-500');
  }
}

// Event Listener Navigasi
document.getElementById('nav-library').addEventListener('click', () => { switchTab('view-library', 'Beranda Perpustakaan', 'nav-library'); renderBooks(); });
document.getElementById('nav-mybooks').addEventListener('click', () => { switchTab('view-mybooks', 'Koleksi Saya', 'nav-mybooks'); renderBooks(); });
document.getElementById('nav-profile').addEventListener('click', () => { switchTab('view-profile', 'Profil Pengguna', 'nav-profile'); });
document.getElementById('nav-admin').addEventListener('click', () => { switchTab('view-admin', 'Manajemen Katalog', 'nav-admin'); });

// --- MENGAMBIL DATA (SUPABASE) ---

// 1. Ambil Katalog Buku
async function fetchCatalog() {
  showLoading();
  const { data, error } = await supabase
    .from('books_catalog')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (data) catalog = data;
  hideLoading();
  renderBooks();
}

// 2. Ambil Riwayat Pembelian User
async function fetchPurchases() {
  const { data, error } = await supabase
    .from('user_purchases')
    .select('item_id')
    .eq('user_id', currentUser.id);
    
  if (data) userPurchases = data.map(item => item.item_id);
  renderBooks(); // Re-render UI tombol berdasarkan status beli
}

// --- RENDER ANTARMUKA BUKU ---
function renderBooks() {
  const libraryContainer = document.getElementById('view-library');
  const myBooksContainer = document.getElementById('view-mybooks');
  libraryContainer.innerHTML = ''; 
  myBooksContainer.innerHTML = '';

  if (catalog.length === 0) {
      libraryContainer.innerHTML = '<p class="col-span-full text-center text-gray-500 py-10">Katalog masih kosong.</p>';
  }

  catalog.forEach(book => {
    const isPurchased = userPurchases.includes(book.id);
    const formattedPrice = formatRupiah(book.price);
    
    // Setup Tampilan Tombol
    const actionText = isPurchased ? 'Mulai Baca' : `Beli ${formattedPrice}`;
    const actionBgClass = isPurchased ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700';

    // Desain Kartu Buku
    const bookHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex flex-col h-full transition-transform transform hover:-translate-y-1">
        
        <!-- Cover Placeholder -->
        <div class="w-full aspect-[3/4] ${book.cover_color || 'bg-gray-200'} rounded-lg flex flex-col items-center justify-center text-center p-3 mb-3 border border-gray-200 shadow-inner relative overflow-hidden">
            <span class="text-xs uppercase tracking-widest font-bold opacity-50 mb-2">Edisi</span>
            <span class="font-bold text-gray-800 leading-tight">${book.title}</span>
            ${isPurchased ? '<div class="absolute top-0 right-0 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg">DIMILIKI</div>' : ''}
        </div>
        
        <div class="flex flex-col flex-grow justify-between">
            <div class="mb-3">
                <h3 class="font-bold text-sm text-gray-800 line-clamp-2 leading-snug">${book.title}</h3>
                ${!isPurchased ? `<p class="text-xs font-bold text-blue-600 mt-1">${formattedPrice}</p>` : ''}
            </div>
            <button onclick="handleBookAction('${book.id}', ${isPurchased})" class="w-full ${actionBgClass} text-white text-sm font-semibold py-2 rounded-lg shadow-sm transition-colors mt-auto">
              ${actionText}
            </button>
        </div>
      </div>
    `;

    // Render ke Beranda
    libraryContainer.insertAdjacentHTML('beforeend', bookHTML);
    // Render ke Buku Saya jika sudah dibeli
    if(isPurchased) myBooksContainer.insertAdjacentHTML('beforeend', bookHTML);
  });

  if(userPurchases.length === 0) {
    myBooksContainer.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center text-gray-400 py-16">
            <span class="text-4xl mb-4">📖</span>
            <p>Anda belum memiliki buku.</p>
        </div>`;
  }
}

// --- AKSI BUKU (KLIK TOMBOL) ---
window.handleBookAction = function(bookId, isPurchased) {
  if (isPurchased) {
    // Buka file jika sudah dibeli
    openReader(bookId);
  } else {
    // Tampilkan Modal QRIS jika belum
    activeItemForPayment = catalog.find(b => b.id === bookId);
    document.getElementById('payment-itemName').textContent = activeItemForPayment.title;
    document.getElementById('payment-itemPrice').textContent = formatRupiah(activeItemForPayment.price);
    
    // Tampilkan modal
    const modal = document.getElementById('payment-modal');
    modal.classList.replace('hidden', 'flex');
  }
}

// Tutup Modal Pembayaran
const closeModal = () => document.getElementById('payment-modal').classList.replace('flex', 'hidden');
document.getElementById('btn-cancel-payment').addEventListener('click', closeModal);
document.getElementById('btn-close-payment-x').addEventListener('click', closeModal);

// Eksekusi Pembayaran Sukses (Simulasi)
document.getElementById('btn-confirm-payment').addEventListener('click', async () => {
  showLoading();
  const { error } = await supabase
    .from('user_purchases')
    .insert([{ user_id: currentUser.id, item_id: activeItemForPayment.id }]);
    
  hideLoading();
  
  if (!error) {
    closeModal();
    fetchPurchases(); // Update array lokal dan UI
    alert('Pembayaran Berhasil! Buku telah ditambahkan ke Koleksi Anda.');
  } else {
      alert('Terjadi kesalahan: ' + error.message);
  }
});


// --- FITUR ADMIN: UNGGAH BUKU ---
document.getElementById('form-add-book').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('admin-title').value;
  const price = document.getElementById('admin-price').value;
  const drive_id = document.getElementById('admin-drive').value;
  
  // Random warna cover ringan untuk tampilan UI
  const colors = ['bg-red-50', 'bg-blue-50', 'bg-green-50', 'bg-yellow-50', 'bg-purple-50', 'bg-pink-50'];
  const randomColor = colors[Math.floor(Math.random() * colors.length)];

  showLoading();
  const { error } = await supabase.from('books_catalog').insert([{ 
    title: title, 
    price: parseInt(price), 
    drive_id: drive_id,
    cover_color: randomColor
  }]);
  hideLoading();

  if (!error) {
    alert("Buku berhasil diterbitkan!");
    document.getElementById('form-add-book').reset();
    fetchCatalog(); // Refresh data katalog
    // Pindah ke tab library untuk melihat hasilnya
    switchTab('view-library', 'Beranda Perpustakaan', 'nav-library');
  } else {
    alert("Gagal menambahkan buku: " + error.message);
  }
});


// --- PDF READER TERTUTUP ---
async function openReader(bookId) {
  const activeBook = catalog.find(b => b.id === bookId);
  if(!activeBook) return;

  // Sembunyikan UI utama, buka Reader
  document.getElementById('main-layout').classList.add('hidden');
  const readerView = document.getElementById('reader-view');
  readerView.classList.replace('hidden', 'flex');
  
  // Set teks Watermark (Email + Nama Aplikasi)
  const wmText = `${currentUser.email} • GKPI Digital • `.repeat(20);
  document.getElementById('watermark').textContent = wmText;
  
  const pageInfo = document.getElementById('page-info');
  pageInfo.textContent = "Mengunduh Dokumen...";
  
  try {
    // 1. Fetch ke Apps Script mengirimkan ID Google Drive file tersebut
    const response = await fetch(`${SCRIPT_URL}?driveId=${activeBook.drive_id}`);
    const base64Pdf = await response.text();
    
    if(base64Pdf.startsWith("Error")) throw new Error(base64Pdf);

    // 2. Decode Base64 ke ArrayBuffer
    const binary = atob(base64Pdf);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    
    // 3. Inisialisasi PDF.js
    pageInfo.textContent = "Memproses Halaman...";
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
    
    pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    pageNum = 1;
    renderPage(pageNum);
    
  } catch (e) {
    alert("Gagal memuat dokumen. Pastikan ID Drive valid atau periksa koneksi.");
    console.error(e);
    closeReader();
  }
}

async function renderPage(num) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const canvas = document.getElementById('pdf-canvas');
  const ctx = canvas.getContext('2d');
  
  // Hitung skala berdasarkan lebar layar (Lebih besar untuk desktop/tablet)
  const isMobile = window.innerWidth < 600;
  const scale = isMobile ? 1.0 : 1.5;
  const viewport = page.getViewport({ scale: scale });
  
  canvas.height = viewport.height; 
  canvas.width = viewport.width;

  // Render halaman ke Canvas HTML
  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
  
  // Update status UI Navigasi
  document.getElementById('page-info').textContent = `Hal ${num} dari ${pdfDoc.numPages}`;
  document.getElementById('btn-prev').disabled = num <= 1;
  document.getElementById('btn-next').disabled = num >= pdfDoc.numPages;
  
  // Scroll kembali ke atas saat ganti halaman
  document.getElementById('canvas-container').scrollTop = 0;
}

// Navigasi PDF
document.getElementById('btn-prev').addEventListener('click', () => {
  if (pageNum <= 1) return;
  pageNum--; renderPage(pageNum);
});
document.getElementById('btn-next').addEventListener('click', () => {
  if (pageNum >= pdfDoc.numPages) return;
  pageNum++; renderPage(pageNum);
});

// Tutup Reader
function closeReader() {
  document.getElementById('reader-view').classList.replace('flex', 'hidden');
  document.getElementById('main-layout').classList.remove('hidden');
  pdfDoc = null; 
}
document.getElementById('btn-close-reader').addEventListener('click', closeReader);


// --- OTENTIKASI USER ---
async function checkUser() {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (user) {
    currentUser = user;
    document.getElementById('profile-email').textContent = user.email;
    
    // Tampilkan tombol admin jika emailnya sesuai
    if (user.email === ADMIN_EMAIL) {
      document.getElementById('nav-admin').classList.remove('hidden');
      document.getElementById('nav-admin').classList.add('flex');
    }
    
    // Transisi UI dari form login ke aplikasi utama
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('main-layout').classList.remove('hidden');
    document.getElementById('main-layout').classList.add('flex');
    
    // Load data
    fetchCatalog();
    fetchPurchases();
    
  } else {
    // Kembalikan ke form Login
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('main-layout').classList.add('hidden');
  }
}

// Handle form Login
document.getElementById('btn-login').addEventListener('click', async (e) => {
  e.preventDefault();
  const form = document.getElementById('auth-form');
  if(!form.checkValidity()) return form.reportValidity();

  showLoading();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  hideLoading();
  
  if (error) alert(error.message); 
  else checkUser();
});

// Handle form Register
document.getElementById('btn-register').addEventListener('click', async (e) => {
  e.preventDefault();
  const form = document.getElementById('auth-form');
  if(!form.checkValidity()) return form.reportValidity();

  showLoading();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  // Karena Email Confirmation dimatikan di Supabase, signUp akan langsung login
  const { error } = await supabase.auth.signUp({ email, password });
  hideLoading();
  
  if (error) alert(error.message); 
  else {
      alert('Pendaftaran berhasil! Mengalihkan ke Beranda...');
      checkUser();
  }
});

// Handle Logout
document.getElementById('btn-logout').addEventListener('click', async () => {
  showLoading();
  await supabase.auth.signOut();
  window.location.reload();
});

// INIT APLIKASI
checkUser();

// --- PWA SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}
