import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import prisma from './src/lib/db';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import bcrypt from 'bcrypt';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUser = process.env.ALLOWED_TELEGRAM_USER_ID;

// Base URL of your Payment API Gateway
const API_URL = 'http://localhost:3000/api';

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is missing in .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log('ðŸ¤– Telegram Client Bot is running...');

const userStates = new Map<number, { mode: string, amount?: string, orderId?: string, dealId?: string }>();

// Helper to interact with API
async function apiCall(endpoint: string, method: string = 'GET', body?: any) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

const isAuthorized = (id: string | undefined) => {
  if (!allowedUser || !id) return false;
  return allowedUser.split(',').map(u => u.trim()).includes(id.toString());
};

const notifyAdmins = async (msg: string, options?: any) => {
  if (!allowedUser) return;
  const admins = allowedUser.split(',').map(u => u.trim());
  for (const adminId of admins) {
    try {
      await bot.sendMessage(adminId, msg, options);
    } catch (e) {
      console.error(`Failed to notify admin ${adminId}`, e);
    }
  }
};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const userId = msg.from?.id.toString();

  const state = userStates.get(chatId) || { mode: 'IDLE' };

  if (state.mode === 'AWAITING_SS' && state.dealId && msg.photo) {
    const dealId = state.dealId;
    const deal = await prisma.escrowDeal.findUnique({ where: { dealId } });
    if (!deal) {
      bot.sendMessage(chatId, 'âŒ Deal not found.');
      userStates.delete(chatId);
      return;
    }

    const fileId = msg.photo[msg.photo.length - 1].file_id;

    await prisma.escrowDeal.update({ where: { dealId }, data: { status: 'COMPLETED' } });
    
    let settings = await prisma.settings.findUnique({ where: { id: 'global' } });
    if (!settings) {
      settings = await prisma.settings.create({ data: { id: 'global', dealCounter: 0, totalFeesCollected: 0 } });
    }
    const newCounter = settings.dealCounter + 1;
    const feeToAdd = deal.feeAmount || 0;
    const newFees = settings.totalFeesCollected + feeToAdd;
    await prisma.settings.update({ where: { id: 'global' }, data: { dealCounter: newCounter, totalFeesCollected: newFees } });
    
    const botInfo = await bot.getMe();
    
    const eCheck = 'âœ…';
    const eMoney = 'ðŸ’°';
    const eUser = 'ðŸ”¹';
    const eTick = 'âœ”ï¸';
    const eShield = 'ðŸ’Ž';

    const successMessage = `âœ¦ GAMERS ESCROW TEAM âœ¦\n#${newCounter} ESCROW COMPLETED ${eCheck}\n\n${eMoney} Deal completed successfully!\n\n${eUser} Escrower: ${botInfo.username}\n\n${eTick} Deal Completed â€¼ï¸\n${eTick} Funds Released Successfully${eCheck}\n${eTick} Safe & Trusted Trade ${eShield}\n\nThank you for choosing âœ¦ âœ¦ GAMERS ESCROW TEAM âœ¦ âœ¦`;

    if (deal.chatId) {
      const sendOpts: any = { parse_mode: 'HTML' };
      if (deal.dealMessageId) {
        sendOpts.reply_to_message_id = deal.dealMessageId;
      }
      try {
        const sentMsg = await bot.sendPhoto(deal.chatId, fileId, {
          caption: successMessage,
          ...sendOpts
        });
        try {
          await bot.pinChatMessage(deal.chatId, sentMsg.message_id);
        } catch (e) { console.error('Pin failed', e); }
      } catch (err) {
        console.error('Failed to send photo to group:', err);
      }
    }
    
    bot.sendMessage(chatId, `âœ… Screenshot successfully posted and pinned in the group for deal \`${dealId}\`!`, { parse_mode: 'Markdown' });
    userStates.delete(chatId);
    return;
  }

  if (msg.photo && state.mode !== 'AWAITING_SS') {
    const pendingDeal = await prisma.escrowDeal.findFirst({
      where: { chatId: chatId.toString(), status: 'WAITING_PAYMENT' }
    });

    if (pendingDeal && pendingDeal.paymentOrderId) {
      await bot.sendMessage(chatId, `ðŸ” Payment screenshot received! Verifying payment instantly...`, { parse_mode: 'Markdown' });
      
      try {
        const response = await apiCall('/verify', 'POST', { orderId: pendingDeal.paymentOrderId });
        if (response.success) {
          await prisma.escrowDeal.update({ where: { dealId: pendingDeal.dealId }, data: { status: 'IN_PROGRESS' } });
          const escapeMd = (str: string) => str ? str.replace(/[_*[\]`]/g, '\\$&') : '';
          const successMsg = await bot.sendMessage(chatId, `ðŸŽ‰ *Payment Successful!*\nâœ… @${escapeMd(pendingDeal.sellerUsername)} Payment received! Continue your deal in private.\nOnce done, buyer should use \`/payment ${pendingDeal.dealId}\``, { parse_mode: 'Markdown' });
          try {
            await bot.pinChatMessage(chatId, successMsg.message_id);
          } catch (e) { console.error('Pin failed', e); }
        } else {
          bot.sendMessage(chatId, `âŒ Verification Failed: We checked the emails but couldn't find the payment yet. If you just paid, please wait a minute and send the screenshot again.`);
        }
      } catch (error) {
        console.error('Instant verification error:', error);
      }
      return;
    }
  }

  if (state.mode === 'SETTING_UPI_ID') {
    await apiCall('/settings', 'POST', { upiId: text });
    bot.sendMessage(chatId, `âœ… UPI ID has been set to: \`${text}\``, { parse_mode: 'Markdown' });
    userStates.delete(chatId);
    return;
  }

  if (state.mode === 'SETTING_MERCHANT') {
    await apiCall('/settings', 'POST', { merchantName: text });
    bot.sendMessage(chatId, `âœ… Merchant Name has been set to: \`${text}\``, { parse_mode: 'Markdown' });
    userStates.delete(chatId);
    return;
  }

  if (state.mode === 'SETTING_GMAIL') {
    await apiCall('/settings', 'POST', { gmailUser: text });
    bot.sendMessage(chatId, `âœ… Gmail Address has been set to: \`${text}\``, { parse_mode: 'Markdown' });
    userStates.delete(chatId);
    return;
  }

  if (state.mode === 'SETTING_APP_PASS') {
    await apiCall('/settings', 'POST', { gmailAppPassword: text });
    bot.sendMessage(chatId, `âœ… Gmail App Password has been saved securely!`, { parse_mode: 'Markdown' });
    userStates.delete(chatId);
    return;
  }

  if (state.mode === 'USER_SETTING_UPI') {
    const username = msg.from?.username;
    if (!username) {
      bot.sendMessage(chatId, 'âŒ You need to have a Telegram username to set your UPI ID.');
      userStates.delete(chatId);
      return;
    }
    await prisma.user.upsert({
      where: { username },
      update: { upiId: text },
      create: { username, upiId: text }
    });
    bot.sendMessage(chatId, `âœ… Your UPI ID has been set to: \`${text}\`\n\nYou are now eligible for deals! Now fill the form again in the group.`, { parse_mode: 'Markdown' });
    userStates.delete(chatId);
    return;
  }

  if (text === '/start setupi') {
    userStates.set(chatId, { mode: 'USER_SETTING_UPI' });
    bot.sendMessage(chatId, 'Please enter your **UPI ID** (e.g., `you@paytm`):', { parse_mode: 'Markdown' });
    return;
  }

  if (text === '/start') {
    bot.sendMessage(chatId, 'âœ¦ *GAMERS ESCROW TEAM* âœ¦\n\nðŸ‘‹ *Welcome to the Premium Escrow Bot!*\n\n*User Commands:*\nðŸ”¹ `/escrow` - Get a blank deal form\nðŸ”¹ `/deal` - Send filled form to create deal\nðŸ”¹ `/payment <deal_id>` - Complete/Refund a deal\n\n*Admin Commands:*\nâš™ï¸ `/admin` - View Dashboard\nðŸ”‘ `/addadmin` - Add Web Admin\n\nUse `/help` for detailed instructions.', { parse_mode: 'Markdown' });
    userStates.delete(chatId);
    return;
  }

  if (text === '/admin') {
    if (!isAuthorized(userId)) {
      bot.sendMessage(chatId, 'âŒ You are not authorized to access the Admin Panel.');
      return;
    }
    try {
      const data = await apiCall('/stats');
      if (!data.success) throw new Error(data.message);

      const recentTx = data.recentTx.map((t: any) =>
        `â€¢ â‚¹${t.amount} - ${t.status === 'PAID' ? 'âœ…' : 'â³'} (ID: \`${t.orderId}\`)`
      ).join('\n');

      const message = `ðŸ“Š *Admin Dashboard*\n\n` +
        `ðŸ’° *Total Revenue:* â‚¹${data.totalRevenue.toLocaleString()}\n` +
        `âœ… *Paid Orders:* ${data.paidCount}\n` +
        `â³ *Pending Orders:* ${data.pendingCount}\n\n` +
        `*Recent Transactions:*\n${recentTx || 'No transactions yet.'}\n\n` +
        `*Settings Configuration:* Use the buttons below to setup your Gateway.`;

      const options = {
        parse_mode: 'Markdown' as const,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'âš™ï¸ Set UPI ID', callback_data: 'set_upi' }, { text: 'ðŸª Set Merchant', callback_data: 'set_merchant' }],
            [{ text: 'ðŸ“§ Set Gmail', callback_data: 'set_gmail' }, { text: 'ðŸ”‘ Set App Pass', callback_data: 'set_app_pass' }],
            [{ text: 'ðŸ” View Current Config', callback_data: 'view_config' }]
          ]
        }
      };

      bot.sendMessage(chatId, message, options);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, 'âŒ Failed to fetch admin stats from API Server.');
    }
    userStates.delete(chatId);
    return;
  }

  if (text.startsWith('/addadmin ')) {
    const masterAdminId = allowedUser?.split(',')[0]?.trim();
    if (userId !== masterAdminId) {
      bot.sendMessage(chatId, 'âŒ Only the Master Admin (Owner) is authorized to add web admins.');
      return;
    }
    const parts = text.split(' ');
    const adminUser = parts[1];
    const adminPass = parts[2];
    if (!adminUser || !adminPass) {
      bot.sendMessage(chatId, 'âš ï¸ Usage: `/addadmin <username> <password>`', { parse_mode: 'Markdown' });
      return;
    }
    try {
      const passwordHash = await bcrypt.hash(adminPass, 10);
      await prisma.webAdmin.create({
        data: { username: adminUser, passwordHash }
      });
      bot.sendMessage(chatId, `âœ… Web Dashboard Admin created successfully!\n\nUsername: \`${adminUser}\`\nPassword: \`${adminPass}\`\nLogin at your Web Dashboard!`, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error('Add Admin error:', err);
      if (err.code === 'P2002') bot.sendMessage(chatId, 'âŒ Admin username already exists.');
      else bot.sendMessage(chatId, 'âŒ Failed to add admin.');
    }
    return;
  }

  if (text === '/escrow') {
    bot.sendMessage(chatId, 'ðŸ“ *Copy and fill this template:*\n\n`/deal\nBUYER : \nSELLER : \nDEAL AMOUNT :\nDEAL INFO :\nTIME TO COMPLETE DEAL : `', { parse_mode: 'Markdown' });
    return;
  }

  if (text.startsWith('/deal')) {
    const lines = text.split('\n');
    let buyer = '', seller = '', amount = 0, desc = '', time = '', adminUsername = 'admin';
    for (const line of lines) {
      if (line.toUpperCase().startsWith('BUYER :')) buyer = line.split(':')[1].trim().replace('@', '');
      if (line.toUpperCase().startsWith('SELLER :')) seller = line.split(':')[1].trim().replace('@', '');
      if (line.toUpperCase().startsWith('DEAL AMOUNT :')) amount = parseFloat(line.split(':')[1].trim());
      if (line.toUpperCase().startsWith('DEAL INFO :')) desc = line.split(':')[1].trim();
      if (line.toUpperCase().startsWith('TIME TO COMPLETE DEAL :')) time = line.split(':')[1].trim();
    }

    if (!buyer || !seller || !amount) {
      bot.sendMessage(chatId, 'âš ï¸ Invalid form. Make sure you provide BUYER, SELLER, and DEAL AMOUNT.');
      return;
    }

    const adminUser = await prisma.webAdmin.findUnique({ where: { username: adminUsername } });
    if (!adminUser || !adminUser.isVerified) {
      bot.sendMessage(chatId, `âš ï¸ Admin \`${adminUsername}\` not found or their Gmail is not verified. Please choose a valid admin.`, { parse_mode: 'Markdown' });
      return;
    }

    if (!adminUser.upiId) {
      bot.sendMessage(chatId, `âš ï¸ Admin \`${adminUsername}\` has not set up their UPI ID yet. Deal cannot proceed.`, { parse_mode: 'Markdown' });
      return;
    }

    const buyerUser = await prisma.user.findUnique({ where: { username: buyer } });
    const sellerUser = await prisma.user.findUnique({ where: { username: seller } });
    if (!buyerUser?.upiId || !sellerUser?.upiId) {
      const escapeMd = (str: string) => str ? str.replace(/[_*[\]`]/g, '\\$&') : '';
      bot.sendMessage(chatId, `âš ï¸ @${escapeMd(buyer)} @${escapeMd(seller)}\nPlease set your UPI ID for payments before creating a deal.`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: 'Set UPI ID', url: 'https://t.me/auto_escrowbot?start=setupi' }]]
        }
      });
      return;
    }

    const dealId = 'deal_' + Date.now();
    await prisma.escrowDeal.create({
      data: { dealId, buyerUsername: buyer, sellerUsername: seller, amount, description: desc, timeToComplete: time, chatId: chatId.toString(), adminUsername }
    });

    const escapeHtml = (str: string) => str ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

    const eDeal = 'ðŸ’Ž';
    const eID = 'ðŸ’ ';
    const eAmount = 'ðŸ’°';
    const eInfo = 'âš ï¸';
    const eTime = 'âŒ›';
    const eUser = 'ðŸ”¹';
    const eAdmin = 'ðŸ›¡';

    const sentMsg = await bot.sendMessage(chatId, `âœ¦ <b>GAMERS ESCROW TEAM</b> âœ¦\n\n${eDeal} <b>NEW ESCROW DEAL CREATED</b>\n\n${eID} <b>Deal ID:</b> <code>${dealId}</code>\n\n${eUser} <b>Buyer:</b> @${escapeHtml(buyer)}\n${eUser} <b>Seller:</b> @${escapeHtml(seller)}\n${eAdmin} <b>Admin:</b> @${escapeHtml(adminUsername)}\n${eAmount} <b>Amount:</b> â‚¹${amount}\n\n${eInfo} <b>Details:</b> ${escapeHtml(desc)}\n${eTime} <b>Time:</b> ${escapeHtml(time)}\n\n<i>âš ï¸ Both parties must agree by clicking below.</i>`, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Buyer Agree âœ…', callback_data: `agree_buyer_${dealId}` }, { text: 'Seller Agree âœ…', callback_data: `agree_seller_${dealId}` }]
        ]
      }
    });
    await prisma.escrowDeal.update({ where: { dealId }, data: { dealMessageId: sentMsg.message_id } });
    return;
  }

  if (text.startsWith('/edit ')) {
    if (!isAuthorized(userId)) {
      bot.sendMessage(chatId, 'âŒ You are not authorized.');
      return;
    }
    const parts = text.split(' ');
    const numStr = parts[1]; // /edit 5 -> parts[1] is 5
    const num = parseInt(numStr);
    if (isNaN(num)) {
      bot.sendMessage(chatId, 'âš ï¸ Please provide a valid number. Usage: `/edit <number>`', { parse_mode: 'Markdown' });
      return;
    }
    await prisma.settings.upsert({
      where: { id: 'global' },
      update: { dealCounter: num },
      create: { id: 'global', dealCounter: num }
    });
    bot.sendMessage(chatId, `âœ… Deal counter updated to ${num}. The next completed deal will be #${num + 1}.`);
    return;
  }

  if (text.startsWith('/payment')) {
    const dealId = text.split(' ')[1];
    if (!dealId) {
      bot.sendMessage(chatId, 'âš ï¸ Provide deal ID: `/payment deal_123`', { parse_mode: 'Markdown' });
      return;
    }
    const deal = await prisma.escrowDeal.findUnique({ where: { dealId } });
    if (!deal) {
      bot.sendMessage(chatId, 'âŒ Deal not found.');
      return;
    }
    if (deal.status !== 'IN_PROGRESS') {
      bot.sendMessage(chatId, `âš ï¸ Deal is not in progress. Current status: ${deal.status}`);
      return;
    }

    const escapeMd = (str: string) => str ? str.replace(/[_*[\]`]/g, '\\$&') : '';

    bot.sendMessage(chatId, `âš–ï¸ *Release or Refund Deal:*\n\`${dealId}\`\n\nBoth Buyer (@${escapeMd(deal.buyerUsername)}) and Seller (@${escapeMd(deal.sellerUsername)}) must choose an option:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Release Funds âœ…', callback_data: `release_${dealId}` }, { text: 'Refund Funds âŒ', callback_data: `refund_${dealId}` }]
        ]
      }
    });
    return;
  }

  if (text === '/help') {
    const helpMsg = `ðŸ¤– *Escrow Bot Commands*\n\n` +
      `ðŸ‘¤ *User Commands:*\n` +
      `ðŸ”¹ \`/escrow\` - Get the blank deal template.\n` +
      `ðŸ”¹ \`/deal\` - Send the filled deal template to start a deal.\n` +
      `ðŸ”¹ \`/payment <deal_id>\` - Release or Refund a deal.\n\n` +
      `ðŸ›¡ *Admin Commands:*\n` +
      `ðŸ”¹ \`/admin\` - View stats and configure API/Gmail settings.\n` +
      `ðŸ”¹ \`/edit <number>\` - Change the deal counter manually.\n\n` +
      `*How to use:*\n` +
      `1. Make sure your UPI is set by clicking 'Set UPI ID' if prompted.\n` +
      `2. Type \`/escrow\` in the group and copy the template.\n` +
      `3. Fill it and send it as \`/deal ...\`\n` +
      `4. Both parties click Agree.\n` +
      `5. Buyer pays via the QR code and clicks Verify.\n` +
      `6. Once deal is done, use \`/payment deal_id\` to complete it.`;
    bot.sendMessage(chatId, helpMsg, { parse_mode: 'Markdown' });
    return;
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat.id;
  const data = query.data;

  if (!chatId) return;

  if (data === 'set_upi') {
    userStates.set(chatId, { mode: 'SETTING_UPI_ID' });
    bot.sendMessage(chatId, 'Please type your **UPI ID** (e.g., `you@paytm`):', { parse_mode: 'Markdown' });
  } else if (data === 'set_merchant') {
    userStates.set(chatId, { mode: 'SETTING_MERCHANT' });
    bot.sendMessage(chatId, 'Please type your **Merchant Name** (e.g., `My Store`):', { parse_mode: 'Markdown' });
  } else if (data === 'set_gmail') {
    userStates.set(chatId, { mode: 'SETTING_GMAIL' });
    bot.sendMessage(chatId, 'Please type your **Gmail Address** (e.g., `you@gmail.com`):', { parse_mode: 'Markdown' });
  } else if (data === 'set_app_pass') {
    userStates.set(chatId, { mode: 'SETTING_APP_PASS' });
    bot.sendMessage(chatId, 'Please type your **Gmail App Password** (16 characters, no spaces):', { parse_mode: 'Markdown' });
  } else if (data === 'view_config') {
    const data = await apiCall('/settings');
    const settings = data.settings || {};
    bot.sendMessage(chatId,
      `ðŸ” *Current API Configuration*\n\n` +
      `*UPI ID:* ${settings.upiId || 'Not Set âŒ'}\n` +
      `*Merchant:* ${settings.merchantName || 'Not Set âŒ'}\n` +
      `*Gmail:* ${settings.gmailUser || 'Not Set âŒ'}\n` +
      `*App Password:* ${settings.gmailAppPassword ? '******** âœ…' : 'Not Set âŒ'}\n`,
      { parse_mode: 'Markdown' }
    );
  } else if (data?.startsWith('agree_')) {
    const parts = data.split('_');
    const role = parts[1]; // buyer or seller
    const dealId = parts.slice(2).join('_');
    const deal = await prisma.escrowDeal.findUnique({ where: { dealId } });
    if (!deal) return bot.answerCallbackQuery(query.id, { text: 'Deal not found.', show_alert: true });

    const username = query.from.username;
    if (role === 'buyer' && username !== deal.buyerUsername) return bot.answerCallbackQuery(query.id, { text: 'You are not the buyer!', show_alert: true });
    if (role === 'seller' && username !== deal.sellerUsername) return bot.answerCallbackQuery(query.id, { text: 'You are not the seller!', show_alert: true });

    await prisma.escrowDeal.update({
      where: { dealId },
      data: role === 'buyer' ? { buyerAgreed: true } : { sellerAgreed: true }
    });

    bot.answerCallbackQuery(query.id, { text: 'You agreed to the deal.' });

    const updatedDeal = await prisma.escrowDeal.findUnique({ where: { dealId } });
    if (updatedDeal?.buyerAgreed && updatedDeal?.sellerAgreed && updatedDeal.status === 'WAITING_AGREEMENT') {
      await prisma.escrowDeal.update({ where: { dealId }, data: { status: 'WAITING_PAYMENT' } });

      bot.sendMessage(chatId, `ðŸ”„ Generating QR Code for Deal \`${dealId}\`...`, { parse_mode: 'Markdown' });

      try {
        const adminUser = await prisma.webAdmin.findUnique({ where: { username: updatedDeal.adminUsername } });
        if (!adminUser || !adminUser.upiId) throw new Error('Admin UPI ID not configured');

        const response = await apiCall('/pay', 'POST', { 
          amount: updatedDeal.amount.toString(),
          upiId: adminUser.upiId,
          merchantName: adminUser.merchantName
        });
        if (!response.success) throw new Error(response.message);

        const { orderId, qrBase64 } = response.data;
        await prisma.escrowDeal.update({ where: { dealId }, data: { paymentOrderId: orderId } });
        const base64Data = qrBase64.replace(/^data:image\/png;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const escapeMd = (str: string) => str ? str.replace(/[_*[\]`]/g, '\\$&') : '';

        await bot.sendPhoto(chatId, imageBuffer, {
          caption: `âœ… *QR Code Generated for Deal*\n\`${dealId}\`\n@${escapeMd(deal.buyerUsername)} Please complete the payment.\n\nðŸ“¡ *Real-time scanning is active.* The bot will verify your payment instantly the moment it is received!\n*(If it takes too long, just REPLY to this message with your payment screenshot to force a check).*`,
          parse_mode: 'Markdown'
        });
      } catch (error: any) {
        console.error('Error generating QR:', error);
        bot.sendMessage(chatId, `âŒ Failed to generate QR code: ${error.message || 'Check Server logs.'}`);
      }
    }
  } else if (data?.startsWith('verify_')) {
    const orderId = data.replace('verify_', '');
    const msgToPin = await bot.sendMessage(chatId, `ðŸ” Verifying payment for Order: \`${orderId}\`...`, { parse_mode: 'Markdown' });

    try {
      const escrowDeal = await prisma.escrowDeal.findFirst({ where: { paymentOrderId: orderId } });
      if (!escrowDeal) throw new Error('Deal not found');

      const response = await apiCall('/verify', 'POST', { orderId, adminUsername: escrowDeal.adminUsername });
      if (response.success) {
        await bot.sendMessage(chatId, `ðŸŽ‰ *Payment Successful!*\nOrder \`${orderId}\` has been verified.`, { parse_mode: 'Markdown' });

        const escapeMd = (str: string) => str ? str.replace(/[_*[\]`]/g, '\\$&') : '';
        if (escrowDeal) {
          await prisma.escrowDeal.update({ where: { dealId: escrowDeal.dealId }, data: { status: 'IN_PROGRESS' } });
          const successMsg = await bot.sendMessage(chatId, `âœ… @${escapeMd(escrowDeal.sellerUsername)} Payment received! Continue your deal in private.\nOnce done, buyer should use \`/payment ${escrowDeal.dealId}\``, { parse_mode: 'Markdown' });
          try {
            await bot.pinChatMessage(chatId, successMsg.message_id);
          } catch (e) { console.error('Pin failed', e); }
        }
      } else {
        bot.sendMessage(chatId, `âŒ Verification Failed: ${response.message || 'Payment Pending/Not Found. Please wait and try again.'}`);
      }
    } catch (error: any) {
      console.error('Verification Error:', error);
      bot.sendMessage(chatId, `âŒ Error calling Verification API.`);
    }
  } else if (data?.startsWith('release_') || data?.startsWith('refund_')) {
    const actionType = data.startsWith('release_') ? 'RELEASE' : 'REFUND';
    const dealId = data.replace('release_', '').replace('refund_', '');
    const deal = await prisma.escrowDeal.findUnique({ where: { dealId } });
    if (!deal) return bot.answerCallbackQuery(query.id, { text: 'Deal not found.', show_alert: true });

    const username = query.from.username;
    if (username !== deal.buyerUsername && username !== deal.sellerUsername) return bot.answerCallbackQuery(query.id, { text: 'You are not part of this deal!', show_alert: true });

    const updateData: any = {};
    if (username === deal.buyerUsername) updateData.buyerReleaseAction = actionType;
    if (username === deal.sellerUsername) updateData.sellerReleaseAction = actionType;

    await prisma.escrowDeal.update({ where: { dealId }, data: updateData });
    bot.answerCallbackQuery(query.id, { text: `You selected ${actionType}` });

    const updatedDeal = await prisma.escrowDeal.findUnique({ where: { dealId } });
    if (updatedDeal?.buyerReleaseAction && updatedDeal?.sellerReleaseAction) {
      if (updatedDeal.buyerReleaseAction === 'RELEASE' && updatedDeal.sellerReleaseAction === 'RELEASE') {
        const feeAmount = deal.amount * 0.01;
        const payoutAmount = deal.amount - feeAmount;

        await prisma.escrowDeal.update({ where: { dealId }, data: { status: 'PAYOUT_PENDING', feeAmount } });
        
        bot.sendMessage(chatId, `â³ *Both parties agreed to release funds.*\n*1% Gateway Fee:* â‚¹${feeAmount.toFixed(2)}\n*Net Payout to Seller:* â‚¹${payoutAmount.toFixed(2)}\nWaiting for Admin to process payout...`, { parse_mode: 'Markdown' });
        
        if (allowedUser) {
          const escapeMd = (str: string) => str ? str.replace(/[_*[\]`]/g, '\\$&') : '';
          const sellerUser = await prisma.user.findUnique({ where: { username: deal.sellerUsername } });
          const upiText = sellerUser?.upiId ? `\nUPI ID: \`${sellerUser.upiId}\`` : '\nUPI ID: `Not Found`';
          notifyAdmins(`ðŸ”” *Payout Required*\nDeal: \`${dealId}\`\nTotal Deal: â‚¹${deal.amount.toFixed(2)}\nGateway Fee (1%): â‚¹${feeAmount.toFixed(2)}\n\nPay â‚¹${payoutAmount.toFixed(2)} to Seller: @${escapeMd(deal.sellerUsername)}${upiText}`, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: 'âœ… Upload Payout SS', callback_data: `admin_upload_ss_${dealId}` }]
              ]
            }
          });
        }
      } else if (updatedDeal.buyerReleaseAction === 'REFUND' && updatedDeal.sellerReleaseAction === 'REFUND') {
        await prisma.escrowDeal.update({ where: { dealId }, data: { status: 'REFUNDED' } });
        bot.sendMessage(chatId, `âŒ *Deal ${dealId} Cancelled*\nFunds will be refunded to buyer. Admins notified.`, { parse_mode: 'Markdown' });
        if (allowedUser) {
          const escapeMd = (str: string) => str ? str.replace(/[_*[\]`]/g, '\\$&') : '';
          const buyerUser = await prisma.user.findUnique({ where: { username: deal.buyerUsername } });
          const upiText = buyerUser?.upiId ? `\nUPI ID: \`${buyerUser.upiId}\`` : '\nUPI ID: `Not Found`';
          notifyAdmins(`ðŸ”” *Refund Required*\nDeal: \`${dealId}\`\nRefund â‚¹${deal.amount} to Buyer: @${escapeMd(deal.buyerUsername)}${upiText}`, { parse_mode: 'Markdown' });
        }
      } else {
        await prisma.escrowDeal.update({ where: { dealId }, data: { buyerReleaseAction: null, sellerReleaseAction: null, status: 'MANUAL_INTERVENTION' } });
        bot.sendMessage(chatId, `âš ï¸ Both are not agree please click button again otherwise deal handled manually.`, { parse_mode: 'Markdown' });
        if (allowedUser) notifyAdmins(`ðŸš¨ *Dispute Alert*\nDeal: ${dealId}\nBuyer and Seller selected different actions!`, { parse_mode: 'Markdown' });
      }
    }
  } else if (data?.startsWith('admin_upload_ss_')) {
    const dealId = data.replace('admin_upload_ss_', '');
    if (!isAuthorized(query.from.id.toString())) {
      return bot.answerCallbackQuery(query.id, { text: 'You are not authorized.', show_alert: true });
    }
    userStates.set(chatId, { mode: 'AWAITING_SS', dealId });
    bot.sendMessage(chatId, `ðŸ“¸ Please send the payment screenshot for Deal: \`${dealId}\``, { parse_mode: 'Markdown' });
  }

  bot.answerCallbackQuery(query.id);
});

bot.on('polling_error', (error) => {
  console.log('Polling Error:', error);
});

process.on('unhandledRejection', (error: any) => {
  console.log('Unhandled Rejection:', error.message);
});

// Auto-cancellation loop (Every 5 minutes)
setInterval(async () => {
  try {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const expiredDeals = await prisma.escrowDeal.findMany({
      where: {
        status: { in: ['WAITING_PAYMENT', 'WAITING_AGREEMENT'] },
        createdAt: { lt: threeHoursAgo }
      }
    });

    for (const deal of expiredDeals) {
      await prisma.escrowDeal.update({ where: { dealId: deal.dealId }, data: { status: 'CANCELLED' } });
      if (deal.chatId) {
        bot.sendMessage(deal.chatId, `â³ *Deal Auto-Cancelled*\nDeal \`${deal.dealId}\` has been automatically cancelled because payment/agreement was not completed within 3 hours.`, { parse_mode: 'Markdown' });
      }
    }
  } catch (err) {
    console.error('Auto-cancel loop error:', err);
  }
}, 5 * 60 * 1000);

// --- REAL TIME IMAP SCANNER ---
async function startRealTimeScanner() {
  try {
    const verifiedAdmins = await prisma.webAdmin.findMany({ where: { isVerified: true } });
    if (verifiedAdmins.length === 0) {
      console.log('âš ï¸ Skipping real-time scanner: No verified admins found.');
      return;
    }

    console.log(`ðŸ“¡ Starting real-time IMAP scanners for ${verifiedAdmins.length} admins...`);

    for (const admin of verifiedAdmins) {
      const user = admin.gmailUser;
      const pass = admin.gmailAppPassword;

      if (!user || !pass) continue;

      const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user, pass },
        logger: false 
      });

      client.on('error', err => {
        console.log(`IMAP Client Error (${admin.username}):`, err.message);
      });

      try {
        await client.connect();
        await client.getMailboxLock('INBOX');
        console.log(`âœ… Listening for instant payments for admin: ${admin.username}`);
      } catch (err) {
        console.error(`âŒ Failed to connect IMAP for ${admin.username}`);
        continue;
      }

      client.on('exists', async (data) => {
        try {
          const pendingDeals = await prisma.escrowDeal.findMany({ 
            where: { status: 'WAITING_PAYMENT', adminUsername: admin.username } 
          });
          if (pendingDeals.length === 0) return;

          const fetchResult = client.fetch({ seq: `${data.count}` }, { source: true });
          for await (let message of fetchResult) {
            if (!message.source) continue;
            const parsed = await simpleParser(message.source);
            const emailContent = `${parsed.subject} ${parsed.text} ${parsed.html}`.toLowerCase();

            for (const deal of pendingDeals) {
               const orderId = deal.paymentOrderId?.toLowerCase();
               if (!orderId) continue;
               const amountRegex = new RegExp(`\\b${deal.amount}\\b`);
               
               if (emailContent.includes(orderId) && amountRegex.test(emailContent)) {
                  // Verified instantly!
                  await prisma.escrowDeal.update({ where: { dealId: deal.dealId }, data: { status: 'IN_PROGRESS' } });
                  await prisma.transaction.update({ where: { orderId: deal.paymentOrderId! }, data: { status: 'PAID' }});

                  const chatId = deal.chatId;
                  const escapeMd = (str: string) => str ? str.replace(/[_*[\]`]/g, '\\$&') : '';
                  if (chatId) {
                     const successMsg = await bot.sendMessage(chatId, `ðŸŽ‰ *Instant Payment Detected (Admin: ${admin.username})!*\nâœ… @${escapeMd(deal.sellerUsername)} Payment received in real-time! Continue your deal in private.\nOnce done, buyer should use \`/payment ${deal.dealId}\``, { parse_mode: 'Markdown' });
                     try { await bot.pinChatMessage(chatId, successMsg.message_id); } catch (e) {}
                  }
               }
            }
          }
        } catch (err) {
          console.error(`Error processing new email for ${admin.username}:`, err);
        }
      });

      client.on('close', () => {
        console.log(`IMAP Connection closed for ${admin.username}. Reconnecting...`);
        setTimeout(startRealTimeScanner, 10000); // Wait 10s then restart all scanners
      });
    }
  } catch (err) {
    console.error('Failed to start real-time scanner:', err);
  }
}

startRealTimeScanner();

