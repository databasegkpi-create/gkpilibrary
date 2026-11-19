export default async function handler(req, res) {
  const { bookId } = req.query;
  const authHeader = req.headers.authorization;

  if (!authHeader || !bookId) {
    return res.status(401).json({ error: 'Akses ditolak: Silakan login terlebih dahulu.' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // 1. Verifikasi akun user yang sedang login
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceKey
      }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesi login tidak valid.' });
    const user = await userRes.json();

    // 2. Cek apakah user sudah membeli buku ini di tabel user_library
    const libRes = await fetch(
      `${supabaseUrl}/rest/v1/user_library?user_id=eq.${user.id}&book_id=eq.${bookId}&select=id,books(gdrive_file_id,title)`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      }
    );
    const libData = await libRes.json();

    if (!libData || libData.length === 0) {
      return res.status(403).json({ error: 'Anda belum membeli buku ini.' });
    }

    const gdriveFileId = libData[0]?.books?.gdrive_file_id?.trim();
    if (!gdriveFileId) {
      return res.status(404).json({ error: 'ID file Google Drive belum diatur untuk buku ini.' });
    }

    // 3. Unduh file biner PDF langsung dari Google Drive (lewati halaman konfirmasi)
    const driveUrl = `https://drive.usercontent.google.com/download?id=${gdriveFileId}&export=download&confirm=t`;
    const pdfRes = await fetch(driveUrl, { redirect: 'follow' });

    if (!pdfRes.ok) {
      return res.status(502).json({ error: 'Gagal mengambil file PDF dari Google Drive.' });
    }

    const contentType = pdfRes.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return res.status(403).json({
        error: 'File PDF tidak bisa dibaca. Pastikan akses Google Drive diset ke: Siapa saja yang memiliki link (Pelihat).'
      });
    }

    // 4. Kirim biner PDF ke PDF.js di browser
    const arrayBuffer = await pdfRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(buffer);

  } catch (err) {
    return res.status(500).json({ error: 'Terjadi kesalahan server: ' + err.message });
  }
}
