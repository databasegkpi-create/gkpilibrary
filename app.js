// 1. KUNCI GUDANG SUPABASE
const SUPABASE_URL = 'https://hcibhradypvcyewmtiyo.supabase.co'; // Ganti dengan URL Anda
const SUPABASE_KEY = 'sb_publishable_xCOzbxS01j29G5gk2Dw5-w_-3Ju33ZU'; // Ganti dengan Kunci anon Anda
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. STATE (Ingatan Jangka Pendek Aplikasi)
let currentUser = null;
let userPurchases = []; // Daftar ID buku yang sudah dibeli
let activeItemForPayment = null; 

// DATA BUKU SEMENTARA (Sebelum kita buat halaman Admin)
const catalog = [
  { id: '1111-2222', title: 'Suara GKPI - Nov 2026', price: 10000 },
  { id: '3333-4444', title: 'Suara GKPI - Des 2026', price: 10000 }
];

// 3. FUNGSI CEK STATUS LOGIN
async function checkUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    // Jika sudah login
    currentUser = user;
    document.getElementById('profile-email').textContent = user.email;
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('main-layout').classList.remove('hidden');
    document.getElementById('main-layout').classList.add('flex');
    
    fetchPurchases(); // Ambil riwayat belanjaan dia
  } else {
    // Jika belum login, tampilkan pintu masuk
    document.getElementById('auth-view').classList.remove('hidden');
    document.getElementById('main-layout').classList.add('hidden');
  }
}

// 4. FUNGSI MENDAFTAR (REGISTER)
document.getElementById('btn-register').addEventListener('click', async (e) => {
  e.preventDefault(); // Mencegah halaman reload
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) alert(error.message); 
  else {
    alert('Pendaftaran berhasil! Mengalihkan ke dalam...');
    checkUser(); // Langsung bawa masuk
  }
});

// 5. FUNGSI MASUK (LOGIN)
document.getElementById('btn-login').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) alert("Email atau Sandi salah!"); 
  else checkUser();
});

// 6. FUNGSI KELUAR (LOGOUT)
document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.reload(); // Segarkan halaman
});

// 7. MENGAMBIL CATATAN BELANJA DARI BUKU KAS
async function fetchPurchases() {
  // Tanya Supabase: "Buku apa saja yang sudah dibeli user ini?"
  const { data, error } = await supabase
    .from('user_purchases')
    .select('item_id')
    .eq('user_id', currentUser.id);
    
  if (data) {
    // Simpan hasilnya ke memori
    userPurchases = data.map(item => item.item_id);
  }
  renderBooks(); // Tampilkan rak buku setelah tahu dia punya buku apa
}

// 8. MENAMPILKAN RAK BUKU
function renderBooks() {
  const library = document.getElementById('view-library');
  const myBooks = document.getElementById('view-mybooks');
  library.innerHTML = ''; myBooks.innerHTML = '';

  catalog.forEach(book => {
    // Cek apakah ID buku ini ada di keranjang belanjaan jemaat
    const isPurchased = userPurchases.includes(book.id);
    
    // Atur tulisan dan warna tombol
    const actionText = isPurchased ? 'Mulai Baca' : `Beli Rp ${book.price}`;
    const actionClass = isPurchased ? 'bg-green-600' : 'bg-blue-600';

    const bookHTML = `
      <div class="bg-white rounded-lg shadow border p-3 flex flex-col justify-between">
        <div class="h-32 bg-blue-50 border-2 border-dashed border-blue-200 rounded flex items-center justify-center text-center font-bold text-sm mb-2 px-2">
          ${book.title}
        </div>
        <button onclick="handleBookAction('${book.id}', ${isPurchased})" class="w-full ${actionClass} text-white text-sm font-bold py-2 rounded mt-2">
          ${actionText}
        </button>
      </div>
    `;

    // Masukkan ke rak depan (Beranda)
    library.innerHTML += bookHTML;
    // Jika sudah lunas, masukkan juga ke rak pribadi (Buku Saya)
    if(isPurchased) myBooks.innerHTML += bookHTML;
  });
}

// 9. AKSI SAAT BUKU DIKLIK
window.handleBookAction = function(bookId, isPurchased) {
  if (isPurchased) {
    alert("Ruang Baca (Fase 4) akan dipasang nanti!");
  } else {
    // Panggil Kasir (Tampilkan Modal QRIS)
    activeItemForPayment = catalog.find(b => b.id === bookId);
    document.getElementById('payment-itemName').textContent = activeItemForPayment.title;
    document.getElementById('payment-itemPrice').textContent = `Rp ${activeItemForPayment.price}`;
    document.getElementById('payment-modal').classList.replace('hidden', 'flex');
  }
}

// 10. SIMULASI KASIR: BAYAR BERHASIL
document.getElementById('btn-confirm-payment').addEventListener('click', async () => {
  // Catat ke Buku Kas di Supabase
  const { error } = await supabase.from('user_purchases').insert([
    { user_id: currentUser.id, item_id: activeItemForPayment.id }
  ]);
  
  if (!error) {
    document.getElementById('payment-modal').classList.replace('flex', 'hidden'); // Tutup kasir
    fetchPurchases(); // Update tampilan tombol
    alert('Pembayaran Berhasil! Buku ditambahkan ke Koleksi Anda.');
  } else {
    alert('Gagal mencatat transaksi: ' + error.message);
  }
});

document.getElementById('btn-cancel-payment').addEventListener('click', () => {
  document.getElementById('payment-modal').classList.replace('flex', 'hidden');
});

// 11. NAVIGASI BAWAH (Pindah Antar Ruangan)
const views = ['view-library', 'view-mybooks', 'view-profile'];
function switchTab(targetId, headerTitle) {
  views.forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(targetId).classList.remove('hidden');
  document.getElementById('app-header').textContent = headerTitle;
}
document.getElementById('nav-library').addEventListener('click', () => switchTab('view-library', 'Katalog Buku'));
document.getElementById('nav-mybooks').addEventListener('click', () => switchTab('view-mybooks', 'Buku Saya'));
document.getElementById('nav-profile').addEventListener('click', () => switchTab('view-profile', 'Profil Pengguna'));

// NYALAKAN LISTRIK!
checkUser();
