import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const notification = req.body;
  const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = notification;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
 const serverKey = process.env.MIDTRANS_SIGNATURE_KEY || process.env.MIDTRANS_SERVER_KEY;

  // 1. CEK SEGEL KEAMANAN SHA-512 (Memastikan laporan ini 100% asli dari Midtrans, bukan hacker)
  const validSignature = crypto
    .createHash('sha512')
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
    .digest('hex');

  if (signature_key !== validSignature) {
    return res.status(403).json({ error: 'Signature palsu ditolak!' });
  }

  // 2. Cek apakah uang benar-benar sudah masuk (settlement / capture)
  const isPaid =
    transaction_status === 'settlement' ||
    (transaction_status === 'capture' && fraud_status === 'accept');

  if (isPaid) {
    // 3. Ubah status transaksi di Supabase menjadi PAID dan ambil data pembeli & bukunya
    const trxRes = await fetch(`${supabaseUrl}/rest/v1/transactions?order_id=eq.${order_id}&select=user_id,book_id,amount`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    const trxList = await trxRes.json();

    if (trxList && trxList.length > 0) {
      const trx = trxList[0];

      // Pastikan jumlah uang yang dibayar sesuai dengan tagihan di database
      if (Number(gross_amount) >= Number(trx.amount)) {
        await fetch(`${supabaseUrl}/rest/v1/transactions?order_id=eq.${order_id}`, {
          method: 'PATCH',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'PAID' })
        });

        // 4. BUKA AKSES BUKU KE AKUN PEMBELI SECARA OTOMATIS
        await fetch(`${supabaseUrl}/rest/v1/user_library`, {
          method: 'POST',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify({
            user_id: trx.user_id,
            book_id: trx.book_id
          })
        });
      }
    }
  }

  return res.status(200).json({ status: 'OK' });
}
