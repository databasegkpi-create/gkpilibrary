
    const SUPABASE_URL = 'https://hhbghudcjnqzohksebox.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_b8BjVmh_WoFus_3QDpksNg_2ipxO4Gf';
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    let currentSession = null;
    let allBooks = [];
    let ownedBookIds = new Set();
    let userPhysicalOrders = [];
    let activeTab = 'store';
    let librarySubtab = 'ebooks';
    let typeFilter = 'all';
    let searchQuery = '';
    let isRegisterMode = false;
    let activeCheckoutBook = null;

    let selectedArea = null;
    let availableRates = [];
    let areaSearchTimer = null;

    let cart = JSON.parse(localStorage.getItem('gkpi_cart') || '[]');
    let isCartCheckoutMode = false;

    function saveCart() {
      localStorage.setItem('gkpi_cart', JSON.stringify(cart));
      updateCartBadge();
    }

    function updateCartBadge() {
      const badge = document.getElementById('cart-badge');
      if (!badge) return;
      const total = cart.reduce((sum, i) => sum + i.quantity, 0);
      if (total > 0) {
        badge.textContent = total;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    function addToCart(bookId) {
      const book = allBooks.find((b) => b.id === bookId);
      if (!book) return;
      const isPhys = book.product_type === 'physical';
      if (isPhys && (book.stock || 0) <= 0) return Swal.fire('Stok Habis', 'Buku ini sedang habis.', 'warning');

      const existing = cart.find((i) => i.bookId === bookId);
      if (existing) {
        if (!isPhys) {
          return Swal.fire({ icon: 'info', title: 'E-Book sudah di keranjang', timer: 1200, showConfirmButton: false });
        }
        if (existing.quantity >= book.stock) {
          return Swal.fire('Maksimal Stok', `Stok tersisa ${book.stock} pcs.`, 'warning');
        }
        existing.quantity += 1;
      } else {
        cart.push({ bookId, quantity: 1 });
      }
      saveCart();
      Swal.fire({ icon: 'success', title: 'Masuk Keranjang', text: book.title, timer: 1100, showConfirmButton: false });
    }

    function updateCartQty(bookId, delta) {
      const item = cart.find((i) => i.bookId === bookId);
      const book = allBooks.find((b) => b.id === bookId);
      if (!item || !book) return;

      const nextQty = item.quantity + delta;
      if (nextQty <= 0) {
        cart = cart.filter((i) => i.bookId !== bookId);
      } else if (book.product_type === 'physical' && nextQty > book.stock) {
        return Swal.fire('Maksimal Stok', `Stok tersisa ${book.stock} pcs.`, 'warning');
      } else {
        item.quantity = book.product_type === 'physical' ? nextQty : 1;
      }
      saveCart();
      renderCartModal();
    }

    function openCartModal() {
      renderCartModal();
      document.getElementById('cart-modal').classList.remove('hidden');
    }

    function closeCartModal() {
      document.getElementById('cart-modal').classList.add('hidden');
    }

    function renderCartModal() {
      const container = document.getElementById('cart-items-container');
      const btn = document.getElementById('btn-cart-checkout');
      let subtotal = 0;

      if (cart.length === 0) {
        container.innerHTML = `<div class="text-center py-12 text-slate-400 text-xs">Keranjang masih kosong.</div>`;
        document.getElementById('cart-subtotal').textContent = formatRupiah(0);
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        return;
      }

      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');

      container.innerHTML = cart.map((item) => {
        const b = allBooks.find((x) => x.id === item.bookId);
        if (!b) return '';
        const isPhys = b.product_type === 'physical';
        subtotal += Number(b.price) * item.quantity;
        return `
          <div class="flex gap-3 p-3 rounded-xl border border-slate-200 bg-white">
            <img src="${b.cover_url || 'https://placehold.co/60x80?text=Buku'}" class="w-12 h-16 object-cover rounded-lg border border-slate-100 shrink-0">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-bold text-slate-900 truncate">${b.title}</p>
              <p class="text-[11px] text-slate-400">${isPhys ? 'Buku Fisik' : 'E-Book'}</p>
              <p class="text-xs font-extrabold text-blue-600 mt-1">${formatRupiah(b.price)}</p>
            </div>
            <div class="flex flex-col items-end justify-between">
              <button onclick="updateCartQty('${b.id}', -999)" class="text-slate-400 hover:text-red-500 text-xs"><i class="fa-solid fa-trash"></i></button>
              ${isPhys ? `
                <div class="flex items-center gap-1.5 bg-slate-100 rounded-lg px-1.5 py-0.5 text-xs font-bold">
                  <button onclick="updateCartQty('${b.id}', -1)" class="px-1">-</button>
                  <span>${item.quantity}</span>
                  <button onclick="updateCartQty('${b.id}', 1)" class="px-1">+</button>
                </div>` : `<span class="text-[11px] text-slate-400">1x</span>`}
            </div>
          </div>`;
      }).join('');

      document.getElementById('cart-subtotal').textContent = formatRupiah(subtotal);
    }

    async function proceedCartCheckout() {
      if (!currentSession) { closeCartModal(); return openAuthModal(); }
      if (cart.length === 0) return;

      const resolved = cart.map((i) => ({ ...i, book: allBooks.find((b) => b.id === i.bookId) })).filter((i) => i.book);
      const hasPhysical = resolved.some((i) => i.book.product_type === 'physical');

      closeCartModal();

      // Jika hanya E-Book, langsung bayar ke Midtrans tanpa form alamat
      if (!hasPhysical) {
        const itemsPayload = resolved.map((i) => ({ bookId: i.bookId, quantity: 1 }));
        cart = [];
        saveCart();
        return triggerMidtransPayment({ items: itemsPayload }, false);
      }

      // Jika ada Buku Fisik, buka modal checkout dengan ringkasan keranjang
      isCartCheckoutMode = true;
      const totalQty = resolved.reduce((s, i) => s + i.quantity, 0);
      const totalPrice = resolved.reduce((s, i) => s + (Number(i.book.price) * i.quantity), 0);
      const totalWeight = resolved.reduce((s, i) => s + ((i.book.product_type === 'physical' ? (i.book.weight_gram || 300) : 0) * i.quantity), 0);

      activeCheckoutBook = {
        id: resolved[0].book.id,
        title: `${resolved.length} Judul Buku (${totalQty} pcs)`,
        price: totalPrice,
        stock: 999,
        weight_gram: totalWeight,
        cover_url: resolved[0].book.cover_url
      };

      selectedArea = null;
      availableRates = [];
      document.getElementById('co-cover').src = activeCheckoutBook.cover_url || 'https://placehold.co/80x100?text=Buku';
      document.getElementById('co-title').textContent = activeCheckoutBook.title;
      document.getElementById('co-unit-price').textContent = `Total Berat: ${(totalWeight / 1000).toFixed(2)} kg`;
      document.getElementById('co-stock-label').textContent = 'Checkout Keranjang (1x Ongkir)';
      document.getElementById('co-qty').value = 1;
      document.getElementById('co-qty').disabled = true;

      document.getElementById('co-area-search').value = '';
      document.getElementById('co-area-results').classList.add('hidden');
      document.getElementById('co-rates-wrapper').classList.add('hidden');
      document.getElementById('co-shipping-mode').value = 'KURIR';
      document.getElementById('co-payment-method').value = 'MIDTRANS';
      handleShippingModeChange();
      document.getElementById('checkout-modal').classList.remove('hidden');
    }

    function formatRupiah(amount) {
      return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount || 0);
    }

    function formatDate(iso) {
      if (!iso) return '-';
      return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    async function initApp() {
      const { data: { session } } = await supabaseClient.auth.getSession();
      setSessionUI(session);

   supabaseClient.auth.onAuthStateChange((event, session) => {
        setSessionUI(session);
        if (event === 'PASSWORD_RECOVERY') {
          openResetPasswordPrompt();
        }
        Promise.all([loadUserLibrary(), loadUserPhysicalOrders()]).then(() => {
          renderView();
          renderQuickLibrary();
        });
      });

      await Promise.all([loadBooks(), loadUserLibrary(), loadUserPhysicalOrders()]);
      document.getElementById('loading-state').classList.add('hidden');
      renderAuthorsSidebar();
      updateCartBadge();
      renderView();
      renderQuickLibrary();
    }

    function setSessionUI(session) {
      currentSession = session;
      const loginBtn = document.getElementById('btn-login-nav');
      const userMenu = document.getElementById('user-menu-nav');
      const emailBadge = document.getElementById('user-email-badge');
      const avatar = document.getElementById('user-avatar-initial');

      if (session) {
        loginBtn.classList.add('hidden');
        userMenu.classList.remove('hidden');
        userMenu.classList.add('flex');
        emailBadge.textContent = session.user.email;
        avatar.textContent = (session.user.email || 'U')[0].toUpperCase();
      } else {
        loginBtn.classList.remove('hidden');
        userMenu.classList.add('hidden');
        userMenu.classList.remove('flex');
        ownedBookIds.clear();
        userPhysicalOrders = [];
      }
    }

 async function loadBooks() {
      try {
        const res = await fetch('/api/books');
        if (res.ok) {
          allBooks = await res.json();
          return;
        }
      } catch (e) {
        console.warn('Fallback ke Supabase langsung:', e);
      }

      const { data, error } = await supabaseClient
        .from('books')
        .select('id, title, author, price, cover_url, description, product_type, stock, weight_gram, created_at')
        .order('created_at', { ascending: false });
      if (!error && data) allBooks = data;
    }

    async function loadUserLibrary() {
      if (!currentSession) { ownedBookIds = new Set(); return; }
      const { data, error } = await supabaseClient
        .from('user_library')
        .select('book_id')
        .eq('user_id', currentSession.user.id);
      if (!error && data) ownedBookIds = new Set(data.map((i) => i.book_id));
    }

    async function loadUserPhysicalOrders() {
      if (!currentSession) { userPhysicalOrders = []; return; }
      const { data, error } = await supabaseClient
        .from('transactions')
        .select('*, books(title, cover_url)')
        .eq('user_id', currentSession.user.id)
        .eq('product_type', 'physical')
        .order('created_at', { ascending: false });
      if (!error && data) userPhysicalOrders = data;
    }

    function goHome() {
      document.getElementById('search-input').value = '';
      searchQuery = '';
      navSelect('store', 'all');
    }

    function navSelect(tab, sub) {
      if (tab === 'library' && !currentSession) return openAuthModal();
      activeTab = tab;

      if (tab === 'store') {
        typeFilter = sub || 'all';
        document.getElementById('store-controls').classList.remove('hidden');
        document.getElementById('library-controls').classList.add('hidden');
        updateFilterPills();
      } else {
        librarySubtab = sub || 'ebooks';
        document.getElementById('store-controls').classList.add('hidden');
        document.getElementById('library-controls').classList.remove('hidden');
        updateLibrarySubtabUI();
      }

    updateSidebarActive(tab, sub);
      renderView();
      renderQuickLibrary();
      updateActiveNav(tab, sub); // <-- ubah 'view' menjadi 'tab'
    }

   function updateActiveNav(view, sub) {
      let activeKey = 'home';
      if (view === 'library') {
        activeKey = sub === 'orders' ? 'orders' : 'ebooks';
      } else {
        if (sub === 'digital') activeKey = 'digital';
        else if (sub === 'physical') activeKey = 'physical';
        else activeKey = 'home';
      }

      ['home', 'digital', 'physical', 'ebooks', 'orders'].forEach((k) => {
        const isActive = k === activeKey;

        // Tab Bawah (HP)
        const mobBtn = document.getElementById(`mob-${k}`);
        if (mobBtn) {
          mobBtn.classList.remove('text-blue-600', 'bg-blue-50', 'font-bold', 'text-slate-500', 'font-medium');
          if (isActive) {
            mobBtn.classList.add('text-blue-600', 'bg-blue-50', 'font-bold');
          } else {
            mobBtn.classList.add('text-slate-500', 'font-medium');
          }
        }

        // Sidebar (Desktop)
        const sideBtn = document.getElementById(`side-${k}`);
        if (sideBtn) {
          sideBtn.classList.remove('text-blue-600', 'bg-blue-50', 'font-semibold', 'bg-slate-100', 'text-slate-900', 'text-slate-500', 'font-medium');
          if (isActive) {
            sideBtn.classList.add('text-blue-600', 'bg-blue-50', 'font-semibold');
          } else {
            sideBtn.classList.add('text-slate-500', 'font-medium');
          }
        }
      });
    }

    function updateSidebarActive(tab, sub) {
      const ids = ['side-home', 'side-digital', 'side-physical', 'side-ebooks', 'side-orders'];
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.className = 'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition';
      });
      let activeId = 'side-home';
      if (tab === 'store' && sub === 'digital') activeId = 'side-digital';
      else if (tab === 'store' && sub === 'physical') activeId = 'side-physical';
      else if (tab === 'library' && sub === 'ebooks') activeId = 'side-ebooks';
      else if (tab === 'library' && sub === 'orders') activeId = 'side-orders';

      const activeEl = document.getElementById(activeId);
      if (activeEl) activeEl.className = 'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-900 transition';
    }

    function setTypeFilter(type) {
      typeFilter = type;
      updateFilterPills();
      updateSidebarActive('store', type);
      renderView();
      updateActiveNav('store', type);
    }

    function updateFilterPills() {
      ['all', 'digital', 'physical'].forEach((t) => {
        const btn = document.getElementById(`filter-${t}`);
        btn.className = t === typeFilter
          ? 'px-4 py-1.5 text-xs font-semibold rounded-full bg-slate-900 text-white transition whitespace-nowrap'
          : 'px-4 py-1.5 text-xs font-semibold rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition whitespace-nowrap';
      });
    }

    function switchLibrarySubtab(subtab) {
      librarySubtab = subtab;
      updateLibrarySubtabUI();
      updateSidebarActive('library', subtab);
      renderView();
      updateActiveNav('library', subtab);
    }

    function updateLibrarySubtabUI() {
      const btnEbooks = document.getElementById('subtab-ebooks');
      const btnOrders = document.getElementById('subtab-orders');
      document.getElementById('library-heading').textContent =
        librarySubtab === 'ebooks' ? 'Koleksi E-Book Saya' : 'Pesanan Buku Fisik';

      if (librarySubtab === 'ebooks') {
        btnEbooks.className = 'px-3.5 py-1.5 text-xs font-semibold rounded-full bg-slate-900 text-white transition';
        btnOrders.className = 'px-3.5 py-1.5 text-xs font-semibold rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition';
      } else {
        btnOrders.className = 'px-3.5 py-1.5 text-xs font-semibold rounded-full bg-slate-900 text-white transition';
        btnEbooks.className = 'px-3.5 py-1.5 text-xs font-semibold rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition';
      }
    }

 let searchTimer = null;
    function handleSearch(val) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = val.trim().toLowerCase();
        renderView();
      }, 250);
    }

    function filterByAuthor(authorName) {
      document.getElementById('search-input').value = authorName;
      searchQuery = authorName.toLowerCase();
      navSelect('store', 'all');
    }

    function renderAuthorsSidebar() {
      const container = document.getElementById('authors-list');
      const authorCounts = {};
      allBooks.forEach((b) => {
        const name = (b.author || 'Tim Penulis').trim();
        authorCounts[name] = (authorCounts[name] || 0) + 1;
      });
      const sorted = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

      if (sorted.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-400">Belum ada penulis.</p>`;
        return;
      }

      container.innerHTML = sorted.map(([name, count]) => `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
              ${name[0].toUpperCase()}
            </div>
            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-800 truncate">${name}</p>
              <p class="text-[11px] text-slate-400">${count} Publikasi</p>
            </div>
          </div>
          <button onclick="filterByAuthor('${name.replace(/'/g, "\\'")}')"
            class="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-700 rounded-lg transition shrink-0">
            Lihat
          </button>
        </div>
      `).join('');
    }

    function renderQuickLibrary() {
      const strip = document.getElementById('quick-library-strip');
      const listEl = document.getElementById('quick-library-list');

      if (activeTab !== 'store' || !currentSession || ownedBookIds.size === 0) {
        strip.classList.add('hidden');
        return;
      }

      const owned = allBooks.filter((b) => ownedBookIds.has(b.id) && (b.product_type || 'digital') === 'digital').slice(0, 3);
      if (owned.length === 0) {
        strip.classList.add('hidden');
        return;
      }

      strip.classList.remove('hidden');
      listEl.innerHTML = owned.map((b) => `
        <div class="bg-white rounded-xl border border-slate-200/80 p-2.5 flex items-center justify-between gap-3 hover:shadow-xs transition">
          <div class="flex items-center gap-3 min-w-0">
            <img src="${b.cover_url || 'https://placehold.co/60x80?text=Buku'}" class="w-9 h-12 object-cover rounded-md border border-slate-100 shrink-0">
            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-900 truncate">${b.title}</p>
              <p class="text-[11px] text-slate-400 truncate">${b.author || 'Tim Penulis'}</p>
            </div>
          </div>
          <button onclick="openReader('${b.id}')"
            class="px-3.5 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition shrink-0">
            <i class="fa-solid fa-book-open-reader mr-1"></i>Baca
          </button>
        </div>
      `).join('');
    }

    function renderView() {
      if (activeTab === 'library' && librarySubtab === 'orders') {
        document.getElementById('books-grid').classList.add('hidden');
        renderPhysicalOrders();
      } else {
        document.getElementById('physical-orders-list').classList.add('hidden');
        renderBooks();
      }
    }

    function renderBooks() {
      const grid = document.getElementById('books-grid');
      const empty = document.getElementById('empty-state');
      const emptyAction = document.getElementById('empty-action-btn');

      let list = activeTab === 'library'
        ? allBooks.filter((b) => ownedBookIds.has(b.id) && (b.product_type || 'digital') === 'digital')
        : [...allBooks];

      if (activeTab === 'store' && typeFilter !== 'all') {
        list = list.filter((b) => (b.product_type || 'digital') === typeFilter);
      }

      if (searchQuery) {
        list = list.filter((b) =>
          (b.title || '').toLowerCase().includes(searchQuery) ||
          (b.author || '').toLowerCase().includes(searchQuery)
        );
      }

      const sortVal = document.getElementById('sort-select').value;
      if (activeTab === 'store') {
        if (sortVal === 'price-asc') list.sort((a, b) => a.price - b.price);
        if (sortVal === 'price-desc') list.sort((a, b) => b.price - a.price);
      }

      if (list.length === 0) {
        grid.classList.add('hidden');
        empty.classList.remove('hidden');
        if (activeTab === 'library') {
          document.getElementById('empty-title').textContent = 'Koleksi E-Book masih kosong';
          document.getElementById('empty-desc').textContent = 'E-book yang Anda beli akan otomatis muncul di sini.';
          emptyAction.classList.remove('hidden');
        } else {
          document.getElementById('empty-title').textContent = 'Produk tidak ditemukan';
          document.getElementById('empty-desc').textContent = 'Coba kata kunci atau filter lain.';
          emptyAction.classList.add('hidden');
        }
        return;
      }

      empty.classList.add('hidden');
      grid.classList.remove('hidden');

      grid.innerHTML = list.map((book) => {
        const isPhysical = book.product_type === 'physical';
        const isOwned = !isPhysical && ownedBookIds.has(book.id);
        const outOfStock = isPhysical && (book.stock || 0) <= 0;
        const cover = book.cover_url || 'https://placehold.co/300x400?text=Buku';

        const badge = isOwned
          ? `<span class="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white shadow-xs">Dimiliki</span>`
          : isPhysical
            ? `<span class="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-white shadow-xs">Fisik</span>`
            : `<span class="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-600 text-white shadow-xs">E-Book</span>`;

        return `
          <article class="group flex flex-col">
            <div onclick="openDetailModal('${book.id}')" class="relative aspect-[3/4] rounded-2xl overflow-hidden bg-slate-100 shadow-xs group-hover:shadow-md transition-all cursor-pointer mb-2.5 border border-slate-200/60">
              <img src="${cover}" alt="${book.title}" loading="lazy"
                class="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300 ${outOfStock ? 'grayscale opacity-60' : ''}">
              ${badge}
            </div>
            <h3 onclick="openDetailModal('${book.id}')" class="font-bold text-slate-900 text-xs sm:text-sm line-clamp-1 cursor-pointer group-hover:text-blue-600 transition">
              ${book.title}
            </h3>
            <p class="text-[11px] text-slate-400 truncate mb-2">${book.author || 'Tim Penulis'}</p>
          <div class="mt-auto flex items-center justify-between gap-1.5">
              <span class="text-xs font-extrabold text-slate-900">${isOwned ? 'Lunas' : formatRupiah(book.price)}</span>
              ${isOwned
                ? `<button onclick="openReader('${book.id}')" class="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition">Baca</button>`
                : outOfStock
                  ? `<span class="text-[10px] font-bold text-red-500">Habis</span>`
                  : `<div class="flex items-center gap-1">
                       <button onclick="addToCart('${book.id}')" title="Tambah ke Keranjang"
                         class="w-7 h-7 flex items-center justify-center text-xs bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 rounded-lg transition">
                         <i class="fa-solid fa-cart-plus"></i>
                       </button>
                       ${isPhysical
                         ? `<button onclick="openCheckoutModal('${book.id}')" class="px-2.5 py-1 text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition">Pesan</button>`
                         : `<button onclick="buyEbook('${book.id}')" class="px-2.5 py-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">Beli</button>`
                       }
                     </div>`
              }
            </div>
          </article>
        `;
      }).join('');
    }

    function renderPhysicalOrders() {
      const container = document.getElementById('physical-orders-list');
      const empty = document.getElementById('empty-state');
      const emptyAction = document.getElementById('empty-action-btn');

      if (userPhysicalOrders.length === 0) {
        container.classList.add('hidden');
        empty.classList.remove('hidden');
        document.getElementById('empty-title').textContent = 'Belum ada pesanan buku fisik';
        document.getElementById('empty-desc').textContent = 'Pesanan buku cetak Anda akan tampil di sini beserta resinya.';
        emptyAction.classList.remove('hidden');
        return;
      }

      empty.classList.add('hidden');
      container.classList.remove('hidden');

      container.innerHTML = userPhysicalOrders.map((tx) => {
        const isPaid = tx.status === 'PAID';
        const shipStatus = tx.shipping_status || 'MENUNGGU_DIKEMAS';
        const cover = tx.books?.cover_url || 'https://placehold.co/80x100?text=Buku';

        return `
          <div class="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-4 justify-between">
            <div class="flex gap-3.5">
              <img src="${cover}" class="w-14 h-18 object-cover rounded-lg border border-slate-200 shrink-0 bg-slate-100">
              <div>
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="font-mono text-[11px] font-bold text-slate-500">${tx.order_id}</span>
                  <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${isPaid ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
                    ${isPaid ? 'LUNAS' : tx.status}
                  </span>
                </div>
                <h4 class="font-bold text-sm text-slate-900">${tx.books?.title || 'Buku Fisik'} <span class="text-blue-600">(${tx.quantity || 1}x)</span></h4>
                <p class="text-xs text-slate-500 mt-0.5">${formatDate(tx.created_at)} &bull; ${tx.shipping_method || '-'}</p>
                <p class="text-xs text-slate-600 mt-1">Penerima: <b>${tx.shipping_name || '-'}</b> (${tx.shipping_phone || '-'})</p>
              </div>
            </div>
            <div class="sm:text-right flex flex-col justify-between border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
              <div>
                <span class="text-[11px] text-slate-400 block">Total</span>
                <span class="font-extrabold text-slate-900 text-sm">${formatRupiah(tx.amount)}</span>
              </div>
              ${isPaid ? `
                <div class="mt-2">
                  <span class="inline-block px-2.5 py-1 text-[11px] font-bold rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                    <i class="fa-solid fa-truck mr-1"></i>${shipStatus.replace(/_/g, ' ')}
                  </span>
                  ${tx.tracking_number ? `<p class="text-xs font-mono text-slate-700 mt-1">Resi: <b>${tx.tracking_number}</b></p>` : ''}
                </div>
              ` : ''}
            </div>
          </div>`;
      }).join('');
    }

    // DETAIL MODAL
    function openDetailModal(bookId) {
      const book = allBooks.find((b) => b.id === bookId);
      if (!book) return;
      const isPhysical = book.product_type === 'physical';
      const isOwned = !isPhysical && ownedBookIds.has(book.id);
      const outOfStock = isPhysical && (book.stock || 0) <= 0;

      document.getElementById('detail-cover').src = book.cover_url || 'https://placehold.co/300x400?text=Buku';
      document.getElementById('detail-title').textContent = book.title;
      document.getElementById('detail-author').textContent = `Oleh ${book.author || 'Tim Penulis'}`;
      document.getElementById('detail-desc').textContent = book.description || 'Tidak ada deskripsi tambahan.';
      document.getElementById('detail-price').textContent = formatRupiah(book.price);

      const badges = document.getElementById('detail-badges');
      badges.innerHTML = isPhysical
        ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">Buku Fisik</span>
           <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">Stok: ${book.stock || 0}</span>`
        : `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">E-Book Digital</span>` +
          (isOwned ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Sudah Dimiliki</span>` : '');

      const actionBtn = document.getElementById('detail-action-btn');
      actionBtn.disabled = false;

      const cartBtn = document.getElementById('detail-cart-btn');
      if (!isOwned && !outOfStock) {
        cartBtn.classList.remove('hidden');
        cartBtn.onclick = () => { addToCart(book.id); closeDetailModal(); };
      } else {
        cartBtn.classList.add('hidden');
      }

      if (isOwned) {
        actionBtn.className = 'px-6 py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm transition';
        actionBtn.innerHTML = '<i class="fa-solid fa-book-open-reader mr-1.5"></i>Baca Sekarang';
        actionBtn.onclick = () => { closeDetailModal(); openReader(book.id); };
      } else if (outOfStock) {
        actionBtn.disabled = true;
        actionBtn.className = 'px-6 py-2.5 text-sm font-semibold bg-slate-200 text-slate-500 rounded-xl cursor-not-allowed';
        actionBtn.innerHTML = 'Stok Habis';
      } else if (isPhysical) {
        actionBtn.className = 'px-6 py-2.5 text-sm font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-sm transition';
        actionBtn.innerHTML = '<i class="fa-solid fa-bag-shopping mr-1.5"></i>Pesan Buku Fisik';
        actionBtn.onclick = () => { closeDetailModal(); openCheckoutModal(book.id); };
      } else {
        actionBtn.className = 'px-6 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition';
        actionBtn.innerHTML = '<i class="fa-solid fa-cart-shopping mr-1.5"></i>Beli E-Book';
        actionBtn.onclick = () => { closeDetailModal(); buyEbook(book.id); };
      }

      document.getElementById('detail-modal').classList.remove('hidden');
    }

    function closeDetailModal() { document.getElementById('detail-modal').classList.add('hidden'); }

    // CHECKOUT FISIK
    function openCheckoutModal(bookId) {
      if (!currentSession) return openAuthModal();
      const book = allBooks.find((b) => b.id === bookId);
      if (!book) return;

      activeCheckoutBook = book;
      selectedArea = null;
      availableRates = [];

      document.getElementById('co-book-id').value = book.id;
      document.getElementById('co-cover').src = book.cover_url || 'https://placehold.co/80x100?text=Buku';
      document.getElementById('co-title').textContent = book.title;
      document.getElementById('co-unit-price').textContent = `${formatRupiah(book.price)} / pcs`;
      document.getElementById('co-stock-label').textContent = `Tersedia ${book.stock} pcs`;

      const qtyInput = document.getElementById('co-qty');
      qtyInput.value = 1;
      qtyInput.max = book.stock || 1;

      document.getElementById('co-area-search').value = '';
      document.getElementById('co-area-results').classList.add('hidden');
      document.getElementById('co-rates-wrapper').classList.add('hidden');
      document.getElementById('co-shipping-mode').value = 'KURIR';
      document.getElementById('co-payment-method').value = 'MIDTRANS';
      handleShippingModeChange();
      document.getElementById('checkout-modal').classList.remove('hidden');
    }

    function closeCheckoutModal() {
      document.getElementById('checkout-modal').classList.add('hidden');
      activeCheckoutBook = null;
    }

    function handleShippingModeChange() {
      const mode = document.getElementById('co-shipping-mode').value;
      const courierSec = document.getElementById('co-courier-section');
      const addrWrap = document.getElementById('co-address-wrapper');
      const addrInput = document.getElementById('co-address');

      if (mode === 'AMBIL_DI_KANTOR') {
        courierSec.classList.add('hidden');
        addrWrap.classList.add('hidden');
        addrInput.required = false;
      } else if (mode === 'BUS_TRAVEL') {
        courierSec.classList.add('hidden');
        addrWrap.classList.remove('hidden');
        addrInput.required = true;
        addrInput.placeholder = 'Tulis kota tujuan, alamat, & nama PO Bus/Travel (misal: Medan - PO Intra)';
      } else {
        courierSec.classList.remove('hidden');
        addrWrap.classList.remove('hidden');
        addrInput.required = true;
        addrInput.placeholder = 'Contoh: Jl. Merdeka No. 12, RT 02/03';
      }
      recalcCheckoutTotal();
    }

    function handleQtyChange() {
      recalcCheckoutTotal();
      if (selectedArea) fetchShippingRates();
    }

    function searchDestinationArea(query) {
      clearTimeout(areaSearchTimer);
      const box = document.getElementById('co-area-results');
      if (query.trim().length < 3) { box.classList.add('hidden'); return; }

      areaSearchTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/shipping?q=${encodeURIComponent(query.trim())}`);
          const data = await res.json();
          const areas = data.areas || [];
          box.innerHTML = areas.length === 0
            ? `<div class="p-3 text-slate-400">Wilayah tidak ditemukan.</div>`
            : areas.map((a) => `
                <button type="button" onclick='selectArea(${JSON.stringify({ id: a.id, name: a.name })})'
                  class="w-full text-left px-3 py-2.5 hover:bg-blue-50 text-slate-700 transition">
                  ${a.name}
                </button>`).join('');
          box.classList.remove('hidden');
        } catch (err) { box.classList.add('hidden'); }
      }, 400);
    }

    function selectArea(area) {
      selectedArea = area;
      document.getElementById('co-area-search').value = area.name;
      document.getElementById('co-area-results').classList.add('hidden');
      fetchShippingRates();
    }

    async function fetchShippingRates() {
      if (!selectedArea || !activeCheckoutBook) return;
      const loading = document.getElementById('co-rates-loading');
      const wrapper = document.getElementById('co-rates-wrapper');
      const select = document.getElementById('co-courier-select');

      loading.classList.remove('hidden');
      wrapper.classList.add('hidden');

      try {
        const qty = parseInt(document.getElementById('co-qty').value, 10) || 1;
        const res = await fetch('/api/shipping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destinationAreaId: selectedArea.id,
            weightGram: activeCheckoutBook.weight_gram || 300,
            itemValue: activeCheckoutBook.price,
            quantity: qty
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal mengambil tarif ongkir.');

        availableRates = data.pricing || [];
        select.innerHTML = availableRates.length === 0
          ? `<option value="">Kurir tidak tersedia untuk wilayah ini</option>`
          : availableRates.map((r, idx) => `<option value="${idx}">${r.courier_name} - ${r.courier_service_name} (${r.duration}) — ${formatRupiah(r.price)}</option>`).join('');
        wrapper.classList.remove('hidden');
        recalcCheckoutTotal();
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        loading.classList.add('hidden');
      }
    }

    function recalcCheckoutTotal() {
      if (!activeCheckoutBook) return;
      const qtyInput = document.getElementById('co-qty');
      let qty = parseInt(qtyInput.value, 10) || 1;
      if (qty < 1) qty = 1;
      if (qty > activeCheckoutBook.stock) { qty = activeCheckoutBook.stock; qtyInput.value = qty; }

      const mode = document.getElementById('co-shipping-mode').value;
      let shippingCost = 0;
      if (mode === 'KURIR' && availableRates.length > 0) {
        const idx = document.getElementById('co-courier-select').value;
        if (availableRates[idx]) shippingCost = Number(availableRates[idx].price || 0);
      }

      const subtotal = Number(activeCheckoutBook.price) * qty;
      document.getElementById('co-subtotal').textContent = formatRupiah(subtotal);
      document.getElementById('co-shipping-cost').textContent = mode === 'BUS_TRAVEL' ? 'Manual (Bus/Travel)' : formatRupiah(shippingCost);
      document.getElementById('co-total').textContent = formatRupiah(subtotal + shippingCost);
    }

    async function submitPhysicalOrder(e) {
      e.preventDefault();
      if (!currentSession || !activeCheckoutBook) return;

      const mode = document.getElementById('co-shipping-mode').value;
      const paymentMethod = document.getElementById('co-payment-method').value;
      let shippingMethod = 'AMBIL_DI_KANTOR';
      let shippingCost = 0;
      let fullAddress = 'Ambil di Kantor';

      if (mode === 'KURIR') {
        const idx = document.getElementById('co-courier-select').value;
        const chosen = availableRates[idx];
        if (!selectedArea || !chosen) {
          return Swal.fire('Pilih Wilayah & Kurir', 'Silakan cari kecamatan tujuan dan pilih layanan kurir terlebih dahulu.', 'warning');
        }
        shippingMethod = `${chosen.courier_name} - ${chosen.courier_service_name} (${chosen.duration})`;
        shippingCost = Number(chosen.price || 0);
        fullAddress = `${document.getElementById('co-address').value.trim()} | ${selectedArea.name}`;
      } else if (mode === 'BUS_TRAVEL') {
        shippingMethod = 'Kirim via Bus / Travel (Ongkir Manual)';
        shippingCost = 0;
        fullAddress = document.getElementById('co-address').value.trim();
      }

   const payload = {
        ...(isCartCheckoutMode
          ? { items: cart }
          : {
              bookId: activeCheckoutBook.id,
              quantity: parseInt(document.getElementById('co-qty').value, 10) || 1
            }),
        paymentMethod,
        shippingMethod,
        shippingCost,
        shippingName: document.getElementById('co-name').value.trim(),
        shippingPhone: document.getElementById('co-phone').value.trim(),
        shippingAddress: fullAddress
      };

      if (isCartCheckoutMode) {
        cart = [];
        saveCart();
        isCartCheckoutMode = false;
        document.getElementById('co-qty').disabled = false;
      }

      closeCheckoutModal();
      await triggerMidtransPayment(payload, true);
    }

    // PEMBAYARAN
    async function buyEbook(bookId) {
      if (!currentSession) return openAuthModal();
      await triggerMidtransPayment({ bookId }, false);
    }

    async function triggerMidtransPayment(payload, isPhysical) {
      Swal.fire({ title: 'Menyiapkan Pembayaran...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      try {
        const res = await fetch('/api/create-transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentSession.access_token}` },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        Swal.close();

        if (!res.ok) return Swal.fire('Gagal', data.error || 'Gagal membuat tagihan pembayaran.', 'error');

        if (data.isManualCash) {
          Swal.fire(
            'Pesanan Tunai Dicatat!',
            `Kode Pesanan: ${data.orderId}. Silakan datang ke kantor untuk melakukan pembayaran tunai sebesar ${formatRupiah(data.amount)}.`,
            'success'
          );
          await loadUserPhysicalOrders();
          navSelect('library', 'orders');
          return;
        }

        window.snap.pay(data.token, {
          onSuccess: async () => {
            Swal.fire(
              'Pembayaran Berhasil!',
              isPhysical
                ? 'Pesanan buku fisik Anda telah masuk antrean pengemasan.'
                : 'E-Book otomatis ditambahkan ke Koleksi Anda.',
              'success'
            );
            await Promise.all([loadBooks(), loadUserLibrary(), loadUserPhysicalOrders()]);
            navSelect('library', isPhysical ? 'orders' : 'ebooks');
          },
          onPending: async () => {
            Swal.fire('Menunggu Pembayaran', 'Selesaikan pembayaran Anda agar pesanan segera diproses.', 'info');
            if (isPhysical) await loadUserPhysicalOrders();
          },
          onError: () => Swal.fire('Pembayaran Gagal', 'Silakan coba kembali.', 'error')
        });
      } catch (err) {
        Swal.close();
        Swal.fire('Error', 'Gagal menghubungi server pembayaran.', 'error');
      }
    }

    // AUTH
    function openAuthModal() { document.getElementById('auth-modal').classList.remove('hidden'); }
    function closeAuthModal() { document.getElementById('auth-modal').classList.add('hidden'); }

    function toggleAuthMode() {
      isRegisterMode = !isRegisterMode;
      document.getElementById('auth-title').textContent = isRegisterMode ? 'Buat Akun Baru' : 'Masuk ke Akun';
      document.getElementById('auth-submit-btn').textContent = isRegisterMode ? 'Daftar' : 'Masuk';
      document.getElementById('auth-switch-text').textContent = isRegisterMode ? 'Sudah punya akun?' : 'Belum punya akun?';
      document.getElementById('auth-switch-btn').textContent = isRegisterMode ? 'Masuk di sini' : 'Daftar di sini';
    }

    async function handleAuthSubmit(e) {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const btn = document.getElementById('auth-submit-btn');
      btn.disabled = true;

      try {
        const res = isRegisterMode
          ? await supabaseClient.auth.signUp({ email, password })
          : await supabaseClient.auth.signInWithPassword({ email, password });
        if (res.error) throw res.error;
        closeAuthModal();
        Swal.fire({ icon: 'success', title: isRegisterMode ? 'Pendaftaran Berhasil' : 'Berhasil Masuk', timer: 1500, showConfirmButton: false });
      } catch (err) {
        Swal.fire('Gagal', err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }

    async function loginWithFacebook() {
      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'facebook',
        options: { redirectTo: window.location.origin }
      });
      if (error) Swal.fire('Gagal', error.message, 'error');
    }

    async function logout() {
      await supabaseClient.auth.signOut();
      navSelect('store', 'all');
    }

    async function handleForgotPassword() {
      const currentEmail = document.getElementById('auth-email').value.trim();
      const { value: email } = await Swal.fire({
        title: 'Reset Kata Sandi',
        text: 'Masukkan email akun Anda. Kami akan mengirimkan tautan untuk mengatur ulang kata sandi.',
        input: 'email',
        inputValue: currentEmail,
        inputPlaceholder: 'nama@email.com',
        showCancelButton: true,
        confirmButtonColor: '#0f172a',
        confirmButtonText: 'Kirim Tautan',
        cancelButtonText: 'Batal'
      });

      if (!email) return;

      Swal.fire({ title: 'Mengirim Email...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin
      });
      Swal.close();

      if (error) {
        Swal.fire('Gagal', error.message, 'error');
      } else {
        closeAuthModal();
        Swal.fire(
          'Tautan Terkirim!',
          `Silakan periksa kotak masuk (atau folder Spam) pada email ${email} untuk mengatur kata sandi baru.`,
          'success'
        );
      }
    }

    async function openResetPasswordPrompt() {
      const { value: newPassword } = await Swal.fire({
        title: 'Buat Kata Sandi Baru',
        text: 'Masukkan kata sandi baru untuk akun Anda (minimal 6 karakter).',
        input: 'password',
        inputAttributes: { minlength: 6, autocapitalize: 'off', autocorrect: 'off' },
        inputPlaceholder: 'Kata sandi baru...',
        allowOutsideClick: false,
        showCancelButton: true,
        confirmButtonColor: '#0f172a',
        confirmButtonText: 'Simpan Kata Sandi',
        cancelButtonText: 'Batal',
        inputValidator: (val) => {
          if (!val || val.length < 6) return 'Kata sandi minimal 6 karakter!';
        }
      });

      if (!newPassword) return;

      Swal.fire({ title: 'Menyimpan...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
      Swal.close();

      if (error) {
        Swal.fire('Gagal', error.message, 'error');
      } else {
        Swal.fire('Berhasil!', 'Kata sandi Anda telah diperbarui dan Anda sudah masuk ke akun.', 'success');
      }
    }

    // READER E-BOOK
    async function openReader(bookId) {
      if (!currentSession) return openAuthModal();
      Swal.fire({ title: 'Membuka E-Book...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      try {
        const res = await fetch(`/api/read-book?bookId=${bookId}`, {
          headers: { Authorization: `Bearer ${currentSession.access_token}` }
        });
        const data = await res.json();
        Swal.close();

        if (!res.ok) return Swal.fire('Gagal Membuka Buku', data.error || 'Terjadi kesalahan.', 'error');

        document.getElementById('reader-title').textContent = data.title || 'E-Book';
        document.getElementById('reader-watermark-text').textContent = `${data.userEmail} • GKPI DIGITAL`;
        document.getElementById('reader-iframe').src = data.streamUrl;
        document.getElementById('reader-modal').classList.remove('hidden');
      } catch (err) {
        Swal.close();
        Swal.fire('Gagal Membuka Buku', err.message, 'error');
      }
    }

    function closeReader() {
      document.getElementById('reader-modal').classList.add('hidden');
      document.getElementById('reader-iframe').src = '';
    }

    initApp();


    // Registrasi PWA Service Worker & Tombol Instal
    let deferredPrompt = null;

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => console.error('SW gagal:', err));
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const btn = document.getElementById('btn-install-pwa');
      if (btn) {
        btn.classList.remove('hidden');
        btn.classList.add('flex');
      }
    });

    async function installPWA() {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        const btn = document.getElementById('btn-install-pwa');
        if (btn) btn.classList.add('hidden');
      }
      deferredPrompt = null;
    }
