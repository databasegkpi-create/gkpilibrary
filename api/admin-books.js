function extractDriveId(input = '') {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  const matchD = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD) return matchD[1];
  const matchId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId) return matchId[1];
  return trimmed.replace(/^\/+|\/+$/g, '');
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

      // 1. Update Status Pengiriman & Nomor Resi
      if (action === 'update_shipping') {
        const { order_id, shipping_status, tracking_number } = req.body;
        if (!order_id) return res.status(400).json({ error: 'Order ID tidak ditemukan.' });

        const updateRes = await fetch(`${supabaseUrl}/rest/v1/transactions?order_id=eq.${order_id}`, {
          method: 'PATCH',
          headers: dbHeaders,
          body: JSON.stringify({
            shipping_status: shipping_status || 'MENUNGGU_DIKEMAS',
            tracking_number: (tracking_number || '').trim()
          })
        });
        const updated = await updateRes.json();
        if (!updateRes.ok) return res.status(500).json({ error: updated.message || 'Gagal memperbarui pengiriman.' });
        return res.status(200).json({ status: 'success', data: updated[0] });
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
