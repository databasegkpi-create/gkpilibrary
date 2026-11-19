export default async function handler(req, res) {
  const apiKey = process.env.BITESHIP_API_KEY;
  const originPostal = Number(process.env.ORIGIN_POSTAL_CODE || 21111);

  if (!apiKey) {
    return res.status(500).json({ error: 'BITESHIP_API_KEY belum diatur di Vercel.' });
  }

  try {
    // 1. GET: Cari Kecamatan / Kota
    if (req.method === 'GET') {
      const q = (req.query.q || '').trim();
      if (q.length < 3) return res.status(200).json({ areas: [] });

      const mapRes = await fetch(
        `https://api.biteship.com/v1/maps/areas?countries=ID&input=${encodeURIComponent(q)}&type=single`,
        { headers: { Authorization: apiKey } }
      );
      const mapData = await mapRes.json();
      if (!mapRes.ok) return res.status(500).json({ error: mapData.error || 'Gagal mencari wilayah.' });

      return res.status(200).json({ areas: mapData.areas || [] });
    }

    // 2. POST: Cek Ongkir Otomatis (JNE & SiCepat) berdasarkan Area ID
    if (req.method === 'POST') {
      const { destinationAreaId, weightGram = 300, itemValue = 50000, quantity = 1 } = req.body;
      if (!destinationAreaId) {
        return res.status(400).json({ error: 'Wilayah tujuan belum dipilih.' });
      }

      const rateRes = await fetch('https://api.biteship.com/v1/rates/couriers', {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          origin_postal_code: originPostal,
          destination_area_id: destinationAreaId,
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
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Kesalahan server ongkir: ' + err.message });
  }
}
