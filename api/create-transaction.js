export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { bookId } = req.body;
  const authHeader = req.headers.authorization;
  if (!authHeader || !bookId) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const midtransServerKey = process.env.MIDTRANS_SERVER_KEY;
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';

  try {
    // 1. Verifikasi akun pembeli
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesi login tidak valid' });
    const user = await userRes.json();

    // 2. Ambil harga ASLI buku langsung dari database (Mencegah manipulasi harga dari browser)
    const bookRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${bookId}&select=id,title,price`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    const books = await bookRes.json();
    if (!books || books.length === 0) return res.status(404).json({ error: 'Buku tidak ditemukan' });
    const book = books[0];

    // 3. Buat Nomor Invoice Unik
    const orderId = `EBK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // 4. Catat pesanan berstatus PENDING ke tabel transactions di Supabase
    await fetch(`${supabaseUrl}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order_id: orderId,
        user_id: user.id,
        book_id: book.id,
        amount: book.price,
        status: 'PENDING'
      })
    });

    // 5. Minta Token Popup Pembayaran Resmi ke Server Midtrans
    const midtransUrl = isProduction
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

    const authString = Buffer.from(midtransServerKey + ':').toString('base64');
    const snapRes = await fetch(midtransUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`
      },
      body: JSON.stringify({
        transaction_details: {
          order_id: orderId,
          gross_amount: Number(book.price)
        },
        item_details: [{
          id: book.id,
          price: Number(book.price),
          quantity: 1,
          name: book.title.substring(0, 45)
        }],
        customer_details: {
          email: user.email
        }
      })
    });

    const snapData = await snapRes.json();
 if (!snapRes.ok) return res.status(500).json({ error: 'Midtrans Menolak: ' + JSON.stringify(snapData) });

    return res.status(200).json({ snapToken: snapData.token, orderId });
  } catch (err) {
    return res.status(500).json({ error: 'Kesalahan server: ' + err.message });
  }
}
