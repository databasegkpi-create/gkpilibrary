export default async function handler(req, res) {
  const { bookId } = req.query;
  const authHeader = req.headers.authorization;

  if (!authHeader || !bookId) {
    return res.status(401).json({ error: 'Akses ditolak: Silakan login terlebih dahulu.' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gasUrl = process.env.GAS_WEB_APP_URL;

  try {
    // 1. Cek siapa user yang sedang login ke Supabase
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': serviceKey
      }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesi login tidak valid.' });
    const user = await userRes.json();

    // 2. Cek apakah user ini sudah membeli buku tersebut di tabel user_library
    const libRes = await fetch(
      `${supabaseUrl}/rest/v1/user_library?user_id=eq.${user.id}&book_id=eq.${bookId}&select=id,last_page,books(gdrive_file_id,title)`,
      {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      }
    );
    const libData = await libRes.json();

    if (!libData || libData.length === 0) {
      return res.status(403).json({ error: 'Anda belum membeli buku ini.' });
    }

    const gdriveFileId = libData[0].books.gdrive_file_id;

    // 3. Ambil isi PDF dari Jembatan Google Apps Script Anda
    const gasResponse = await fetch(`${gasUrl}?fileId=${gdriveFileId}&key=RAHASIA_TOKO_BUKU_2026`);
    const gasJson = await gasResponse.json();

    if (gasJson.status !== 'success') {
      return res.status(500).json({ error: 'Gagal memuat file buku dari Google Drive.' });
    }

    return res.status(200).json({
      status: 'success',
      pdfBase64: gasJson.data,
      lastPage: libData[0].last_page || 1,
      userEmail: user.email
    });

  } catch (err) {
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
}
