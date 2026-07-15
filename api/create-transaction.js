// ==================== api/create-transaction.js ====================
// Vercel Serverless Function — menggantikan endpoint POST /api/create-transaction
// di server Express lama. Otomatis ter-deploy sebagai /api/create-transaction.
// =====================================================================

const midtransClient = require('midtrans-client');

const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function generateOrderId() {
  const now = Date.now();
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `VIONAE-${now}-${rand}`;
}

// Simpan detail lengkap order (termasuk alamat) ke Supabase SEBELUM pembayaran,
// supaya nanti waktu webhook masuk, kita bisa ambil detail lengkapnya kembali
// (Midtrans sendiri tidak mengirim balik alamat/nama lengkap lewat webhook).
async function saveOrderToSupabase(orderId, items, customer, subtotal, shippingFee, total) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[Supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi, order tidak disimpan.');
    return;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        order_id: orderId,
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_email: customer.email,
        customer_address: customer.address,
        customer_city: customer.city,
        customer_postal_code: customer.postal_code,
        customer_note: customer.note || '',
        items,
        subtotal,
        shipping_fee: shippingFee,
        total,
        status: 'pending',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[Supabase] Gagal simpan order:', errText);
    }
  } catch (err) {
    console.error('[Supabase] Error saat simpan order:', err.message);
  }
}

module.exports = async (req, res) => {
  // CORS (aman diaktifkan walau frontend & backend sekarang satu domain di Vercel)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { items, customer, shipping_fee } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Keranjang kosong atau tidak valid.' });
    }
    if (!customer || !customer.name || !customer.phone || !customer.email) {
      return res.status(400).json({ error: 'Data pelanggan tidak lengkap.' });
    }

    const SHIPPING_FEE = Number(shipping_fee || 0);

    const item_details = items.map((it) => ({
      id: String(it.id),
      price: Math.round(Number(it.price)),
      quantity: Number(it.qty) || 1,
      name: String(it.name).slice(0, 50),
    }));

    if (SHIPPING_FEE > 0) {
      item_details.push({ id: 'ONGKIR', price: SHIPPING_FEE, quantity: 1, name: 'Ongkos Kirim' });
    }

    const subtotal = item_details
      .filter((it) => it.id !== 'ONGKIR')
      .reduce((sum, it) => sum + it.price * it.quantity, 0);
    const gross_amount = item_details.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const order_id = generateOrderId();

    const parameter = {
      transaction_details: { order_id, gross_amount },
      credit_card: { secure: true },
      item_details,
      customer_details: {
        first_name: customer.first_name || customer.name,
        last_name: customer.last_name || '-',
        email: customer.email,
        phone: customer.phone,
        billing_address: {
          first_name: customer.first_name || customer.name,
          address: customer.address,
          city: customer.city,
          postal_code: customer.postal_code,
          country_code: 'IDN',
        },
        shipping_address: {
          first_name: customer.first_name || customer.name,
          address: customer.address,
          city: customer.city,
          postal_code: customer.postal_code,
          country_code: 'IDN',
        },
      },
      custom_field1: customer.note || '',
    };

    const transaction = await snap.createTransaction(parameter);

    // Simpan detail lengkap ke Supabase (tidak menunggu/blocking respons ke customer
    // kalau gagal — kegagalan simpan tidak boleh menggagalkan proses bayar).
    await saveOrderToSupabase(order_id, item_details.filter(it => it.id !== 'ONGKIR'), customer, subtotal, SHIPPING_FEE, gross_amount);

    return res.status(200).json({
      token: transaction.token,
      redirect_url: transaction.redirect_url,
      order_id,
    });
  } catch (err) {
    console.error('[create-transaction] Error:', err.message);
    return res.status(500).json({ error: 'Gagal membuat transaksi Midtrans', message: err.message });
  }
};

