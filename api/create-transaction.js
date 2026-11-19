
async function sendAdminWA(message) {
  const token = process.env.FONNTE_TOKEN;
  const target = process.env.ADMIN_WA_NUMBER;
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sesi login tidak valid.' });
    const user = await userRes.json();

    const {
      bookId,
      quantity = 1,
      paymentMethod = 'MIDTRANS',
      shippingMethod,
      shippingCost: clientShippingCost = 0,
      shippingName,
      shippingPhone,
      shippingAddress
    } = req.body;
    if (!bookId) return res.status(400).json({ error: 'ID buku tidak ditemukan.' });

    const bookRes = await fetch(`${supabaseUrl}/rest/v1/books?id=eq.${bookId}&select=*`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    const books = await bookRes.json();
    const book = books[0];
    if (!book) return res.status(404).json({ error: 'Buku tidak ditemukan.' });

    const isPhysical = book.product_type === 'physical';
    const isCashOffice = isPhysical && paymentMethod === 'CASH_KANTOR';
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

      finalShippingMethod = shippingMethod || 'AMBIL_DI_KANTOR';
      if (finalShippingMethod !== 'AMBIL_DI_KANTOR') {
        if (!shippingAddress) {
          return res.status(400).json({ error: 'Alamat / tujuan pengiriman wajib diisi.' });
        }
        // Jika Bus/Travel, ongkir di web Rp 0 (manual). Jika Kurir Biteship, pakai tarifnya.
        shippingCost = finalShippingMethod.includes('Bus / Travel') ? 0 : Math.max(0, Number(clientShippingCost || 0));
      }
    }

    const grossAmount = (Number(book.price) * qty) + shippingCost;
   const prefix = isCashOffice ? 'CASH' : (isPhysical ? 'FSK' : 'EBK');

    // Ambil nomor urut otomatis 4 digit dari Supabase (0001, 0002, dst.)
    const seqRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_next_order_number`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      }
    });
    const orderNumber = seqRes.ok ? await seqRes.json() : `${Date.now()}`;
    const orderId = `${prefix}-${orderNumber}`;
    const txPayload = {
      order_id: orderId,
      user_id: user.id,
      book_id: book.id,
      amount: grossAmount,
      status: 'PENDING',
      product_type: isPhysical ? 'physical' : 'digital',
      quantity: qty,
      shipping_method: isCashOffice ? `${finalShippingMethod} (Bayar Tunai)` : finalShippingMethod,
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

   // Jika Bayar Tunai di Kantor, kirim WA ke Admin & kembalikan sukses
    if (isCashOffice) {
      const waMsg = [
        `*PESANAN TUNAI BARU — GKPI BOOK STORE*`,
        `Order ID: ${orderId}`,
        `Produk: ${book.title} (${qty}x)`,
        `Penerima: ${shippingName.trim()} (${shippingPhone.trim()})`,
        `Pengiriman: ${finalShippingMethod}`,
        `Total Tagihan: Rp ${grossAmount.toLocaleString('id-ID')}`,
        ``,
        `Status: Menunggu pembayaran tunai di kantor.`
      ].join('\n');

      await sendAdminWA(waMsg);
      return res.status(200).json({ isManualCash: true, orderId, amount: grossAmount });
    }

    // Jika Bayar Online, buat tagihan ke Midtrans Snap
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
