import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data, error } = await supabase
      .from('books')
      .select('id, title, author, price, cover_url, description, product_type, stock, weight_gram, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Cache di CDN Vercel selama 60 detik, tetap sajikan data lama sambil update di belakang layar selama 5 menit
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
