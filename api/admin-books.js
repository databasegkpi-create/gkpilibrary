function extractDriveId(input = '') {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  const matchD = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD) return matchD[1];
  const matchId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId) return matchId[1];
  return trimmed.replace(/^\/+|\/+$/g, '');
}

async function sendWA(target, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token || !target) return;

  try {
    await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target, message })
    });
  } catch (err) {
    console.error('Gagal kirim WA Fonnte:', err.message);
  }
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmails = (process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  try {
    // Verifikasi user & izin Admin
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesi login tidak valid.' });
    const user = await userRes.json();

    if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
      return res.status(403).json({ error: 'Akses ditolak: Akun Anda bukan Admin.' });
    }

    const dbHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };

    // GET: Ambil buku, transaksi, & statistik ringkasan
    if (req.method === 'GET') {
      const [booksRes, txRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/books?select=*&order=created_at.desc`, { headers: dbHeaders }),
        fetch(`${supabaseUrl}/rest/v1/transactions?select=*,books(title,cover_url,product_type)&order=created_at.desc`, { headers: dbHeaders })
      ]);

      const books = await booksRes.json();
      const transactions = await txRes.json();

      const paidTx = Array.isArray(transactions) ? transactions.filter((t) => t.status === 'PAID') : [];
      const stats = {
        totalRevenue: paidTx.reduce((sum, t) => sum + Number(t.amount || 0), 0),
        totalDigitalSold: paidTx
          .filter((t) => (t.product_type || 'digital') === 'digital')
          .reduce((sum, t) => sum + Number(t.quantity || 1), 0),
        totalPhysicalSold: paidTx
          .filter((t) => t.product_type === 'physical')
          .reduce((sum, t) => sum + Number(t.quantity || 1), 0),
        pendingShipments: paidTx.filter(
          (t) => t.product_type === 'physical' && (t.shipping_status || 'MENUNGGU_DIKEMAS') === 'MENUNGGU_DIKEMAS'
        ).length
      };

      return res.status(200).json({ status: 'success', email: user.email, books, transactions, stats });
    }

    // POST: Tambah buku baru (Digital atau Fisik)
    if (req.method === 'POST') {
      const { title, author, price, cover_url, description, gdrive_file_id, product_type, stock } = req.body;
      const type = product_type === 'physical' ? 'physical' : 'digital';

      if (!title || !price) return res.status(400).json({ error: 'Judul dan harga wajib diisi.' });
      if (type === 'digital' && !gdrive_file_id) {
        return res.status(400).json({ error: 'E-Book wajib menyertakan Link/ID Google Drive.' });
      }

      const payload = {
        title: title.trim(),
        author: (author || 'Tim Penulis').trim(),
        price: Number(price),
        cover_url: (cover_url || '').trim(),
        description: (description || '').trim(),
        product_type: type,
        stock: type === 'physical' ? Math.max(0, Number(stock || 0)) : 0,
        gdrive_file_id: type === 'digital' ? extractDriveId(gdrive_file_id) : null
      };

      const insertRes = await fetch(`${supabaseUrl}/rest/v1/books`, {
        method: 'POST',
        headers: dbHeaders,
        body: JSON.stringify(payload)
      });
      const created = await insertRes.json();
      if (!insertRes.ok) return res.status(500).json({ error: created.message || 'Gagal menambah buku.' });
      return res.status(201).json({ status: 'success', data: created[0] });
    }

    // PATCH: Edit buku, Update Stok Cepat, atau Update Pengiriman/Resi
    if (req.method === 'PATCH') {
      const { action } = req.body;

      // 0. Konfirmasi Pembayaran Tunai di Kantor (Ubah ke PAID & Potong Stok)
      if (action === 'confirm_cash') {
        const { order_id } = req.body;
        if (!order_id) return res.status(400).json({ error: 'Order ID tidak ditemukan.' });

        const txRes = await fetch(`${supabaseUrl}/rest/v1/transactions?order_id=eq.${order_id}&select=*`, { headers: dbHeaders });
        const txList = await txRes.json();
        const tx = txList[0];
        if (!tx) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        if (tx.status === 'PAID') return res.status(200).json({ status: 'already_paid' });

        await fetch(`${supabaseUrl}/rest/v1/transactions?order_id=eq.${order_id}`, {
          method: 'PATCH',
          headers: dbHeaders,
          body: JSON.stringify({ status: 'PAID' })
        });

        if (tx.product_type === 'physical') {
          await fetch(`${supabaseUrl}/rest/v1/rpc/decrement_book_stock`, {
            method: 'POST',
            headers: dbHeaders,
            body: JSON.stringify({ p_book_id: tx.book_id, p_qty: Number(tx.quantity || 1) })
          });
        }

        return res.status(200).json({ status: 'success' });
      }

// 1. Update Status Pengiriman & Nomor Resi + Kirim WA ke Pembeli
      if (action === 'update_shipping') {
        const { order_id, shipping_status, tracking_number } = req.body;
        if (!order_id) return res.status(400).json({ error: 'Order ID tidak ditemukan.' });

        const cleanTracking = (tracking_number || '').trim();
        const finalStatus = shipping_status || 'MENUNGGU_DIKEMAS';

        const updateRes = await fetch(`${supabaseUrl}/rest/v1/transactions?order_id=eq.${order_id}`, {
          method: 'PATCH',
          headers: dbHeaders,
          body: JSON.stringify({
            shipping_status: finalStatus,
            tracking_number: cleanTracking
          })
        });
        const updated = await updateRes.json();
        if (!updateRes.ok) return res.status(500).json({ error: updated.message || 'Gagal memperbarui pengiriman.' });

        // Kirim notifikasi WA otomatis ke pembeli
        const tx = updated?.[0];
        if (tx?.shipping_phone) {
          const statusLabel = finalStatus.replace(/_/g, ' ');
          const resiMsg = [
            `Halo *${tx.shipping_name || 'Pelanggan'}*,`,
            `Update status pesanan Anda di *GKPI Book Store*:`,
            ``,
            `Order ID: *${order_id}*`,
            `Status: *${statusLabel}*`,
            cleanTracking ? `No. Resi / Info: *${cleanTracking}*` : '',
            `Kurir: ${tx.shipping_method || '-'}`,
            ``,
            `Terima kasih telah berbelanja di GKPI Book Store.`
          ].filter(Boolean).join('\n');

          await sendWA(tx.shipping_phone, resiMsg);
        }

        return res.status(200).json({ status: 'success', data: tx });
      }

      // 2. Update Stok Cepat
      if (action === 'update_stock') {
        const { id, stock } = req.body;
        if (!id) return res.status(400).json({ error: 'ID buku tidak ditemukan.' });

        const updateRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${id}`, {
          method: 'PATCH',
          headers: dbHeaders,
          body: JSON.stringify({ stock: Math.max(0, Number(stock || 0)) })
        });
        const updated = await updateRes.json();
        if (!updateRes.ok) return res.status(500).json({ error: updated.message || 'Gagal memperbarui stok.' });
        return res.status(200).json({ status: 'success', data: updated[0] });
      }

      // 3. Edit Data Buku Lengkap
      const { id, title, author, price, cover_url, description, gdrive_file_id, product_type, stock } = req.body;
      const type = product_type === 'physical' ? 'physical' : 'digital';

      if (!id || !title || !price) return res.status(400).json({ error: 'Data buku tidak lengkap.' });
      if (type === 'digital' && !gdrive_file_id) {
        return res.status(400).json({ error: 'E-Book wajib menyertakan Link/ID Google Drive.' });
      }

      const payload = {
        title: title.trim(),
        author: (author || 'Tim Penulis').trim(),
        price: Number(price),
        cover_url: (cover_url || '').trim(),
        description: (description || '').trim(),
        product_type: type,
        stock: type === 'physical' ? Math.max(0, Number(stock || 0)) : 0,
        gdrive_file_id: type === 'digital' ? extractDriveId(gdrive_file_id) : null
      };

      const updateRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${id}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify(payload)
      });
      const updated = await updateRes.json();
      if (!updateRes.ok) return res.status(500).json({ error: updated.message || 'Gagal memperbarui buku.' });
      return res.status(200).json({ status: 'success', data: updated[0] });
    }

    // DELETE: Hapus buku
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID buku tidak ditemukan.' });

      const delRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${id}`, {
        method: 'DELETE',
        headers: dbHeaders
      });
      if (!delRes.ok) return res.status(500).json({ error: 'Gagal menghapus buku (sudah terhubung dengan transaksi).' });
      return res.status(200).json({ status: 'success' });
    }

    return res.status(405).json({ error: 'Method tidak diizinkan.' });
  } catch (err) {
    return res.status(500).json({ error: 'Kesalahan server: ' + err.message });
  }
}
