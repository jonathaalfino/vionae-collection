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

function buildOrderMessage(statusResponse, statusLabel) {
  const orderId = statusResponse.order_id;
  const gross = Number(statusResponse.gross_amount || 0).toLocaleString('id-ID');
  const payType = statusResponse.payment_type || '-';

  return (
    `🌸 *PESANAN ${statusLabel}*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🆔 Order ID: \`${orderId}\`\n` +
    `🏦 Metode: ${payType}\n` +
    `💰 Total: Rp ${gross}\n\n` +
    `🔗 Cek detail lengkap di Midtrans Dashboard.`
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

    console.log(`[Webhook] order_id: ${statusResponse.order_id}, status: ${transactionStatus}, fraud: ${fraudStatus}`);

    if (transactionStatus === 'capture' && fraudStatus === 'accept') {
      await sendTelegramNotification(buildOrderMessage(statusResponse, 'BERHASIL ✅'));
    } else if (transactionStatus === 'settlement') {
      await sendTelegramNotification(buildOrderMessage(statusResponse, 'BERHASIL ✅'));
    } else if (transactionStatus === 'pending') {
      await sendTelegramNotification(buildOrderMessage(statusResponse, 'MENUNGGU PEMBAYARAN ⏳'));
    }
    // deny/cancel/expire sengaja tidak kirim notif, biar tidak spam.
  } catch (err) {
    // Wajar terjadi kalau ini cuma "Tes URL notifikasi" dari dashboard (bukan
    // transaksi order asli) — order_id-nya nggak beneran ada, jadi verifikasi
    // ke Midtrans gagal. Ini tidak masalah, log aja, tetap balas 200 di bawah.
    console.error('[Webhook] Error saat proses notifikasi:', err.message);
  }

  res.status(200).send('OK');
};
