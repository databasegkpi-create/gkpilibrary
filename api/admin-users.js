import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Pastikan yang mengakses sudah login
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Sesi tidak valid' });

    // (Opsional) Jika Anda punya env ADMIN_EMAILS di Vercel, aktifkan filter ini:
    if (process.env.ADMIN_EMAILS) {
      const allowed = process.env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase());
      if (!allowed.includes((user.email || '').toLowerCase())) {
        return res.status(403).json({ error: 'Akses ditolak (Bukan Admin)' });
      }
    }

    // 2. Ambil daftar user dari Supabase Auth (hingga 1.000 user per halaman)
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000
    });
    if (error) throw error;

    const users = (data.users || []).map((u) => ({
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

    // Urutkan dari yang paling baru mendaftar
    users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({ total: users.length, users });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
