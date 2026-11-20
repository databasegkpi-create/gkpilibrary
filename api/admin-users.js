module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://hhbghudcjnqzohksebox.supabase.co';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

    if (!serviceKey) {
      return res.status(500).json({
        error: 'Environment Variable SUPABASE_SERVICE_ROLE_KEY belum diatur di Vercel.'
      });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized: Token tidak ditemukan' });

    // 1. Verifikasi sesi login admin langsung ke Supabase Auth API
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${token}`
      }
    });

    if (!userRes.ok) {
      return res.status(401).json({ error: 'Sesi login tidak valid atau sudah kedaluwarsa.' });
    }
    const currentUser = await userRes.json();

    if (process.env.ADMIN_EMAILS) {
      const allowed = process.env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase());
      if (!allowed.includes((currentUser.email || '').toLowerCase())) {
        return res.status(403).json({ error: 'Akses ditolak (Bukan Admin)' });
      }
    }

    // 2. Ambil daftar seluruh user dari Supabase Auth Admin API
    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      }
    });

    const listData = await listRes.json();
    if (!listRes.ok) {
      return res.status(listRes.status).json({
        error: listData.msg || listData.message || 'Gagal mengambil daftar user dari Supabase.'
      });
    }

    const users = (listData.users || []).map((u) => ({
      id: u.id,
      email: u.email || '-',
      full_name: u.user_metadata?.full_name || '-',
      phone: u.user_metadata?.phone || '-',
      address: u.user_metadata?.address || '-',
      avatar_url: u.user_metadata?.avatar_url || u.user_metadata?.picture || '',
      provider: u.app_metadata?.provider || 'email',
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at
    }));

    users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({ total: users.length, users });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
};
