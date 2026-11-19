async function sendAdminWA(message) {
  const token = process.env.FONNTE_TOKEN;
  const target = process.env.ADMIN_WA_NUMBER;
  if (!token || !target) return;

  try {
    await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
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
      items: reqItems,
      paymentMethod = 'MIDTRANS',
      shippingMethod,
      shippingCost: clientShippingCost = 0,
      shippingName,
      shippingPhone,
      shippingAddress
    } = req.body;

    // Normalisasi input: dukung format keranjang (items) maupun beli langsung (bookId)
    const rawItems = Array.isArray(reqItems) && reqItems.length > 0
      ? reqItems
      : (bookId ? [{ bookId, quantity }] : []);

    if (rawItems.length === 0) {
      return res.status(400).json({ error: 'Keranjang belanja kosong.' });
    }

    // Ambil semua data buku dari Supabase sekaligus
    const ids = [...new Set(rawItems.map((i) => i.bookId))];
    const bookRes = await fetch(`${supabaseUrl}/rest/v1/books?id=in.(${ids.join(',')})&select=*`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    const booksData = await bookRes.json();
    const bookMap = Object.fromEntries((booksData || []).map((b) => [b.id, b]));

    let subtotal = 0;
    let totalQty = 0;
    let hasPhysical = false;
    const resolvedItems = [];

    for (const item of rawItems) {
      const book = bookMap[item.bookId];
      if (!book) return res.status(404).json({ error: 'Salah satu buku tidak ditemukan.' });

      const isPhys = book.product_type === 'physical';
      const qty = isPhys ? Math.max(1, parseInt(item.quantity, 10) || 1) : 1;

      if (isPhys) {
        hasPhysical = true;
        if ((book.stock || 0) < qty) {
          return res.status(400).json({ error: `Stok "${book.title}" tidak cukup (tersisa ${book.stock || 0}).` });
        }
      }

      subtotal += Number(book.price) * qty;
      totalQty += qty;
      resolvedItems.push({
        book_id: book.id,
        title: book.title,
        price: Number(book.price),
        quantity: qty,
        product_type: isPhys ? 'physical' : 'digital',
        weight_gram: book.weight_gram || 300
      });
    }

    const isCashOffice = hasPhysical && paymentMethod === 'CASH_KANTOR';
    let shippingCost = 0;
    let finalShippingMethod = null;

    if (hasPhysical) {
      if (!shippingName || !shippingPhone) {
        return res.status(400).json({ error: 'Nama penerima dan nomor WhatsApp wajib diisi.' });
      }
      finalShippingMethod = shippingMethod || 'AMBIL_DI_KANTOR';
      if (finalShippingMethod !== 'AMBIL_DI_KANTOR') {
        if (!shippingAddress) {
          return res.status(400).json({ error: 'Alamat / tujuan pengiriman wajib diisi.' });
        }
        shippingCost = finalShippingMethod.includes('Bus / Travel') ? 0 : Math.max(0, Number(clientShippingCost || 0));
      }
    }

    const grossAmount = subtotal + shippingCost;
    const prefix = isCashOffice ? 'CASH' : (hasPhysical ? 'FSK' : 'EBK');

    // Ambil nomor urut 4 digit (0001, 0002, dst.)
    const seqRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_next_order_number`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
    });
    const orderNumber = seqRes.ok ? await seqRes.json() : `${Date.now()}`;
    const orderId = `${prefix}-${orderNumber}`;

    const txPayload = {
      order_id: orderId,
      user_id: user.id,
      book_id: resolvedItems[0].book_id,
      items: resolvedItems,
      amount: grossAmount,
      status: 'PENDING',
      product_type: hasPhysical ? 'physical' : 'digital',
      quantity: totalQty,
      shipping_method: isCashOffice ? `${finalShippingMethod} (Bayar Tunai)` : finalShippingMethod,
      shipping_cost: shippingCost,
      shipping_name: hasPhysical ? shippingName.trim() : null,
      shipping_phone: hasPhysical ? shippingPhone.trim() : null,
      shipping_address: hasPhysical ? (shippingAddress || 'Ambil di Kantor').trim() : null,
      shipping_status: hasPhysical ? 'MENUNGGU_DIKEMAS' : null
    };

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/transactions`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(txPayload)
    });

    if (!insertRes.ok) {
      const errTx = await insertRes.json();
      return res.status(500).json({ error: 'Gagal mencatat transaksi: ' + (errTx.message || '') });
    }

    // Pesanan Tunai di Kantor
    if (isCashOffice) {
      const itemLines = resolvedItems.map((i) => `- ${i.title} (${i.quantity}x)`).join('\n');
      const waMsg = [
        `*PESANAN TUNAI BARU — GKPI BOOK STORE*`,
        `Order ID: *${orderId}*`,
        `Penerima: ${shippingName.trim()} (${shippingPhone.trim()})`,
        `Pengiriman: ${finalShippingMethod}`,
        `Daftar Buku:\n${itemLines}`,
        `Total Tagihan: *Rp ${grossAmount.toLocaleString('id-ID')}*`,
        ``,
        `Status: Menunggu pembayaran tunai di kantor.`
      ].join('\n');

      await sendAdminWA(waMsg);
      return res.status(200).json({ isManualCash: true, orderId, amount: grossAmount });
    }

    // Pembayaran Online Midtrans
    const midtransUrl = isProduction
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

    const authString = Buffer.from(serverKey + ':').toString('base64');
    const snapRes = await fetch(midtransUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${authString}` },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
        customer_details: {
          first_name: hasPhysical ? shippingName.trim() : user.email.split('@')[0],
          email: user.email,
          phone: hasPhysical ? shippingPhone.trim() : undefined
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
