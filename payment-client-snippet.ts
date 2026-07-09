/**
 * -------------------------------------------------------------
 * Payment Client Snippet for New Telegram Bots
 * -------------------------------------------------------------
 * Instructions:
 * 1. Copy this file into any of your new Telegram bot projects.
 * 2. Change `API_URL` if your payment gateway is hosted elsewhere.
 * 3. Set your `API_KEY` obtained from your Payment Gateway Dashboard.
 * 4. Use `generateQR` and `verifyPayment` in your bot's logic!
 */

const API_URL = 'http://localhost:3000/api/v2';
const API_KEY = 'sk_YOUR_API_KEY_HERE'; // Replace with your actual API Key

/**
 * Generate a Payment QR Code
 * @param amount Amount in INR
 * @returns { orderId, qrBase64, upiUrl }
 */
export async function generateQR(amount: number | string) {
  const res = await fetch(`${API_URL}/pay`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-api-key': API_KEY 
    },
    body: JSON.stringify({ amount: amount.toString() })
  });
  
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to generate QR');
  }
  return data.data; // { orderId, qrBase64, upiUrl }
}

/**
 * Verify a Payment using Order ID
 * @param orderId The Order ID returned from generateQR
 * @returns boolean (true if verified, false otherwise)
 */
export async function verifyPayment(orderId: string) {
  const res = await fetch(`${API_URL}/verify`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-api-key': API_KEY 
    },
    body: JSON.stringify({ orderId })
  });
  
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.message || 'Failed to verify payment');
  }
  return data.success; // true or false
}
