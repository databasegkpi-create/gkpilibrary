function extractDriveId(input = '') {
  const trimmed = input.trim();
  const matchD = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD) return matchD[1];
  const matchId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId) return matchId[1];
  return trimmed.replace(/^\/+|\/+$/g, '');
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmails = (process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  try {
    // 1. Verifikasi sesi login user
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceKey
      }
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Sesi login tidak valid.' });
    }
    const user = await userRes.json();

    // 2. Pastikan email terdaftar sebagai Admin
    if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
      return res.status(403).json({ error: 'Akses ditolak: Akun Anda bukan Admin.' });
    }

    const dbHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };

    // GET: Ambil seluruh daftar buku
    if (req.method === 'GET') {
      const listRes = await fetch(`${supabaseUrl}/rest/v1/books?select=*&order=created_at.desc`, {
        headers: dbHeaders
      });
      const books = await listRes.json();
      return res.status(200).json({ status: 'success', email: user.email, books });
    }

    // POST: Tambah buku baru
    if (req.method === 'POST') {
      const { title, author, price, cover_url, description, gdrive_file_id } = req.body;
      if (!title || !price || !gdrive_file_id) {
        return res.status(400).json({ error: 'Judul, harga, dan Link/ID Google Drive wajib diisi.' });
      }

      const payload = {
        title: title.trim(),
        author: (author || 'Tim Penulis').trim(),
        price: Number(price),
        cover_url: (cover_url || '').trim(),
        description: (description || '').trim(),
        gdrive_file_id: extractDriveId(gdrive_file_id)
      };

      const insertRes = await fetch(`${supabaseUrl}/rest/v1/books`, {
        method: 'POST',
        headers: dbHeaders,
        body: JSON.stringify(payload)
      });

      const created = await insertRes.json();
      if (!insertRes.ok) {
        return res.status(500).json({ error: created.message || 'Gagal menambah buku.' });
      }
      return res.status(201).json({ status: 'success', data: created[0] });
    }

    // PATCH: Edit buku yang sudah ada
    if (req.method === 'PATCH') {
      const { id, title, author, price, cover_url, description, gdrive_file_id } = req.body;
      if (!id || !title || !price || !gdrive_file_id) {
        return res.status(400).json({ error: 'Data buku tidak lengkap.' });
      }

      const payload = {
        title: title.trim(),
        author: (author || 'Tim Penulis').trim(),
        price: Number(price),
        cover_url: (cover_url || '').trim(),
        description: (description || '').trim(),
        gdrive_file_id: extractDriveId(gdrive_file_id)
      };

      const updateRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${id}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify(payload)
      });

      const updated = await updateRes.json();
      if (!updateRes.ok) {
        return res.status(500).json({ error: updated.message || 'Gagal memperbarui buku.' });
      }
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

      if (!delRes.ok) {
        return res.status(500).json({ error: 'Gagal menghapus buku (pastikan buku belum terhubung dengan transaksi).' });
      }
      return res.status(200).json({ status: 'success' });
    }

    return res.status(405).json({ error: 'Method tidak diizinkan.' });
  } catch (err) {
    return res.status(500).json({ error: 'Kesalahan server: ' + err.message });
  }
}
