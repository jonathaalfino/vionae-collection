// ==================== api/midtrans-notification.js ====================
// Vercel Serverless Function — menggantikan endpoint POST /api/midtrans-notification
// (webhook) di server Express lama. Otomatis ter-deploy sebagai:
// https://domain-vercel-kamu.vercel.app/api/midtrans-notification
// Daftarkan URL ini di Midtrans Dashboard > Settings > Configuration.
// =========================================================================

const midtransClient = require('midtrans-client');

const core = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function sendTelegramNotification(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diisi.');
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    });
    const data = await res.json();
    if (!data.ok) console.error('[Telegram] Gagal kirim notifikasi:', data.description);
  } catch (err) {
    console.error('[Telegram] Error saat kirim notifikasi:', err.message);
  }
}

// Ambil detail lengkap order (termasuk alamat) dari Supabase pakai order_id.
async function getOrderFromSupabase(orderId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error('[Supabase] Error saat ambil order:', err.message);
    return null;
  }
}

// Update status order + payment_type di Supabase.
async function updateOrderStatus(orderId, status, paymentType) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ status, payment_type: paymentType, updated_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error('[Supabase] Error saat update status:', err.message);
  }
}

// Susun pesan Telegram LENGKAP (nama, telepon, alamat, item) kalau data order
// ketemu di Supabase. Kalau tidak ketemu (misal order lama sebelum fitur ini
// ada, atau ini cuma "Tes URL notifikasi"), fallback ke info dasar saja.
function buildOrderMessage(statusResponse, statusLabel, orderRow) {
  const orderId = statusResponse.order_id;
  const gross = Number(statusResponse.gross_amount || 0).toLocaleString('id-ID');
  const payType = statusResponse.payment_type || '-';

  if (!orderRow) {
    return (
      `🌸 *PESANAN ${statusLabel}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🆔 Order ID: \`${orderId}\`\n` +
      `🏦 Metode: ${payType}\n` +
      `💰 Total: Rp ${gross}\n\n` +
      `⚠️ Detail pelanggan tidak ditemukan di database.`
    );
  }

  const itemLines = (orderRow.items || [])
    .map((it) => `• ${it.name} x${it.quantity || it.qty || 1}`)
    .join('\n') || '-';

  return (
    `🌸 *PESANAN ${statusLabel}*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🆔 Order ID: \`${orderId}\`\n` +
    `🏦 Metode: ${payType}\n` +
    `💰 Total: Rp ${gross}\n\n` +
    `📦 *Item:*\n${itemLines}\n\n` +
    `👤 *Data Pengiriman:*\n` +
    `Nama    : ${orderRow.customer_name || '-'}\n` +
    `Telepon : ${orderRow.customer_phone || '-'}\n` +
    `Email   : ${orderRow.customer_email || '-'}\n` +
    `Alamat  : ${orderRow.customer_address || '-'}, ${orderRow.customer_city || '-'} ${orderRow.customer_postal_code || ''}\n` +
    (orderRow.customer_note ? `Catatan : ${orderRow.customer_note}\n` : '')
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  // Selalu balas 200 ke Midtrans SECEPATNYA, apapun hasil proses internalnya.
  // Ini best practice resmi dari Midtrans: kalau server kita balas error/non-200,
  // Midtrans akan terus retry & fitur "Tes URL notifikasi" di dashboard akan gagal,
  // padahal endpoint-nya sendiri sehat-sehat aja.
  try {
    const statusResponse = await core.transaction.notification(req.body);
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;
    const orderId = statusResponse.order_id;

    console.log(`[Webhook] order_id: ${orderId}, status: ${transactionStatus}, fraud: ${fraudStatus}`);

    const orderRow = await getOrderFromSupabase(orderId);

    if (transactionStatus === 'capture' && fraudStatus === 'accept') {
      await updateOrderStatus(orderId, 'paid', statusResponse.payment_type);
      await sendTelegramNotification(buildOrderMessage(statusResponse, 'BERHASIL ✅', orderRow));
    } else if (transactionStatus === 'settlement') {
      await updateOrderStatus(orderId, 'paid', statusResponse.payment_type);
      await sendTelegramNotification(buildOrderMessage(statusResponse, 'BERHASIL ✅', orderRow));
    } else if (transactionStatus === 'pending') {
      await updateOrderStatus(orderId, 'pending', statusResponse.payment_type);
      await sendTelegramNotification(buildOrderMessage(statusResponse, 'MENUNGGU PEMBAYARAN ⏳', orderRow));
    } else if (
      transactionStatus === 'deny' ||
      transactionStatus === 'cancel' ||
      transactionStatus === 'expire'
    ) {
      await updateOrderStatus(orderId, 'failed', statusResponse.payment_type);
      // Sengaja tidak kirim notif Telegram untuk status gagal/batal, biar tidak spam.
    }
  } catch (err) {
    // Wajar terjadi kalau ini cuma "Tes URL notifikasi" dari dashboard (bukan
    // transaksi order asli) — order_id-nya nggak beneran ada, jadi verifikasi
    // ke Midtrans gagal. Ini tidak masalah, log aja, tetap balas 200 di bawah.
    console.error('[Webhook] Error saat proses notifikasi:', err.message);
  }

  res.status(200).send('OK');
};
