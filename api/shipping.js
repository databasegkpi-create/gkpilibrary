export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.BITESHIP_API_KEY;
  const originPostal = Number(process.env.ORIGIN_POSTAL_CODE || 21111);

  if (!apiKey) {
    return res.status(500).json({ error: 'BITESHIP_API_KEY belum diatur di Vercel.' });
  }

  try {
    const { destinationPostalCode, weightGram = 300, itemValue = 50000, quantity = 1 } = req.body;
    const cleanPostal = String(destinationPostalCode || '').replace(/\D/g, '');

    if (cleanPostal.length !== 5) {
      return res.status(400).json({ error: 'Masukkan 5 digit kode pos tujuan yang valid.' });
    }

    const rateRes = await fetch('https://api.biteship.com/v1/rates/couriers', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        origin_postal_code: originPostal,
        destination_postal_code: Number(cleanPostal),
        couriers: 'jne,sicepat',
        items: [
          {
            name: 'Buku Fisik GKPI',
            value: Number(itemValue),
            weight: Math.max(100, Number(weightGram)),
            quantity: Math.max(1, Number(quantity))
          }
        ]
      })
    });

    const rateData = await rateRes.json();
    if (!rateRes.ok) {
      return res.status(500).json({ error: rateData.error || 'Gagal mengambil tarif ongkir.' });
    }

    const pricing = (rateData.pricing || [])
      .map((p) => ({
        courier_name: p.courier_name,
        courier_service_name: p.courier_service_name,
        duration: p.duration,
        price: Number(p.price || 0)
      }))
      .sort((a, b) => a.price - b.price);

    return res.status(200).json({ pricing });
  } catch (err) {
    return res.status(500).json({ error: 'Kesalahan server ongkir: ' + err.message });
  }
}
