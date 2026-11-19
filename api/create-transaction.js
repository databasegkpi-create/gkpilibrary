export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';

  try {
    // 1. Verifikasi user
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesi login tidak valid.' });
    const user = await userRes.json();

    const { bookId, quantity = 1, shippingMethod, shippingName, shippingPhone, shippingAddress } = req.body;
    if (!bookId) return res.status(400).json({ error: 'ID buku tidak ditemukan.' });

    // 2. Ambil data buku dari Supabase
    const bookRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${bookId}&select=*`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    const books = await bookRes.json();
    const book = books[0];
    if (!book) return res.status(404).json({ error: 'Buku tidak ditemukan.' });

    const isPhysical = book.product_type === 'physical';
    const qty = isPhysical ? Math.max(1, parseInt(quantity, 10) || 1) : 1;

    let shippingCost = 0;
    let finalShippingMethod = null;

    if (isPhysical) {
      if ((book.stock || 0) < qty) {
        return res.status(400).json({ error: `Stok buku tidak mencukupi (tersisa ${book.stock || 0}).` });
      }
      if (!shippingName || !shippingPhone) {
        return res.status(400).json({ error: 'Nama penerima dan nomor WhatsApp wajib diisi.' });
      }
      if (shippingMethod !== 'AMBIL_DI_KANTOR' && !shippingAddress) {
        return res.status(400).json({ error: 'Alamat pengiriman wajib diisi untuk pengiriman kurir.' });
      }

      finalShippingMethod = shippingMethod || 'AMBIL_DI_KANTOR';
      if (finalShippingMethod === 'KURIR_FLAT') {
        shippingCost = 20000; // Tarif flat Rp 20.000
      } else {
        shippingCost = 0; // Ambil di Kantor / Bayar Ongkir di Tujuan (DFOD)
      }
    }

    const grossAmount = (Number(book.price) * qty) + shippingCost;
    const orderId = `${isPhysical ? 'FSK' : 'EBK'}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // 3. Simpan transaksi PENDING ke Supabase
    const txPayload = {
      order_id: orderId,
      user_id: user.id,
      book_id: book.id,
      amount: grossAmount,
      status: 'PENDING',
      product_type: isPhysical ? 'physical' : 'digital',
      quantity: qty,
      shipping_method: finalShippingMethod,
      shipping_cost: shippingCost,
      shipping_name: isPhysical ? shippingName.trim() : null,
      shipping_phone: isPhysical ? shippingPhone.trim() : null,
      shipping_address: isPhysical ? (shippingAddress || 'Ambil di Kantor').trim() : null,
      shipping_status: isPhysical ? 'MENUNGGU_DIKEMAS' : null
    };

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(txPayload)
    });

    if (!insertRes.ok) {
      const errTx = await insertRes.json();
      return res.status(500).json({ error: 'Gagal mencatat transaksi: ' + (errTx.message || '') });
    }

    // 4. Buat tagihan ke Midtrans Snap
    const midtransUrl = isProduction
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

    const authString = Buffer.from(serverKey + ':').toString('base64');
    const snapRes = await fetch(midtransUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${authString}`
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
        customer_details: {
          first_name: isPhysical ? shippingName.trim() : user.email.split('@')[0],
          email: user.email,
          phone: isPhysical ? shippingPhone.trim() : undefined
        }
      })
    });

    const snapData = await snapRes.json();
    if (!snapRes.ok) {
      return res.status(500).json({ error: 'Midtrans Menolak: ' + JSON.stringify(snapData) });
    }

    return res.status(200).json({ token: snapData.token, orderId });
  } catch (err) {
    return res.status(500).json({ error: 'Kesalahan server: ' + err.message });
  }
}
