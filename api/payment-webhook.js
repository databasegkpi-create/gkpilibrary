import crypto from 'crypto';


async function sendWA(target, message) {
  const token = process.env.FONNTE_TOKEN;
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

  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = req.body;
  const serverKey = process.env.MIDTRANS_SIGNATURE_KEY || process.env.MIDTRANS_SERVER_KEY;

  // 1. Verifikasi segel SHA-512 Midtrans
  const expectedSignature = crypto
    .createHash('sha512')
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
    .digest('hex');

  if (signature_key !== expectedSignature) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  try {
    const isPaid =
      (transaction_status === 'capture' && fraud_status === 'accept') ||
      transaction_status === 'settlement';

    if (!isPaid) {
      // Kirim notifikasi WA ke Admin saat pembayaran Midtrans LUNAS
    const tipeProduk = tx.product_type === 'physical' ? 'Buku Fisik' : 'E-Book Digital';
    const waMsg = [
      `*PESANAN LUNAS (PAID) — GKPI BOOK STORE*`,
      `Order ID: ${order_id}`,
      `Tipe: ${tipeProduk} (${tx.quantity || 1}x)`,
      `Total Bayar: Rp ${Number(tx.amount || 0).toLocaleString('id-ID')}`,
      tx.product_type === 'physical' ? `Penerima: ${tx.shipping_name || '-'} (${tx.shipping_phone || '-'})` : '',
      tx.product_type === 'physical' ? `Pengiriman: ${tx.shipping_method || '-'}` : '',
      tx.product_type === 'physical' ? `Alamat: ${tx.shipping_address || '-'}` : ''
    ].filter(Boolean).join('\n');

   // Kirim WA ke Admin
    await sendWA(process.env.ADMIN_WA_NUMBER, waMsg);

    // Kirim WA ke Pembeli (khusus buku fisik yang memiliki nomor WA)
    if (tx.shipping_phone) {
      const buyerMsg = [
        `Halo *${tx.shipping_name || 'Pelanggan'}*,`,
        `Pembayaran Anda di *GKPI Book Store* telah kami terima (*LUNAS*).`,
        ``,
        `Order ID: *${order_id}*`,
        `Total: *Rp ${Number(tx.amount || 0).toLocaleString('id-ID')}*`,
        `Pengiriman: ${tx.shipping_method || '-'}`,
        ``,
        `Pesanan Anda segera kami kemas. Nomor resi akan kami kirimkan otomatis melalui WhatsApp ini. Terima kasih!`
      ].join('\n');

      await sendWA(tx.shipping_phone, buyerMsg);
    }

    // 2. Cek transaksi di Supabase
    const txRes = await fetch(`${supabaseUrl}/rest/v1/transactions?order_id=eq.${order_id}&select=*`, {
      headers: dbHeaders
    });
    const txList = await txRes.json();
    const tx = txList[0];

    if (!tx) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });

    // Jika sudah PAID sebelumnya, hentikan agar stok tidak terpotong dua kali
    if (tx.status === 'PAID') {
      return res.status(200).json({ status: 'already_processed' });
    }

    // 3. Ubah status transaksi menjadi PAID
    await fetch(`${supabaseUrl}/rest/v1/transactions?order_id=eq.${order_id}`, {
      method: 'PATCH',
      headers: dbHeaders,
      body: JSON.stringify({ status: 'PAID' })
    });

    // 4. Jalankan aksi sesuai tipe produk
    if (tx.product_type === 'physical') {
      // Buku Fisik: Potong stok otomatis
      await fetch(`${supabaseUrl}/rest/v1/rpc/decrement_book_stock`, {
        method: 'POST',
        headers: dbHeaders,
        body: JSON.stringify({
          p_book_id: tx.book_id,
          p_qty: Number(tx.quantity || 1)
        })
      });
    } else {
      // E-Book: Masukkan ke Koleksi Saya (user_library)
      await fetch(`${supabaseUrl}/rest/v1/user_library`, {
        method: 'POST',
        headers: { ...dbHeaders, Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({ user_id: tx.user_id, book_id: tx.book_id })
      });
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: 'Webhook error: ' + err.message });
  }
}
