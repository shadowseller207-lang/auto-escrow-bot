import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const text = `/deal
BUYER : @ultra_SHAgz
SELLER : @SHADOW_SELLER07
DEAL AMOUNT : 500
DEAL INFO : account
TIME TO COMPLETE DEAL : 1 hr`;

  const lines = text.split('\n');
  let buyer = '', seller = '', amount = 0, desc = '', time = '', adminUsername = 'admin';
  for (const line of lines) {
    if (line.toUpperCase().startsWith('BUYER :')) buyer = line.split(':')[1].trim().replace('@', '');
    if (line.toUpperCase().startsWith('SELLER :')) seller = line.split(':')[1].trim().replace('@', '');
    if (line.toUpperCase().startsWith('DEAL AMOUNT :')) amount = parseFloat(line.split(':')[1].trim());
    if (line.toUpperCase().startsWith('DEAL INFO :')) desc = line.split(':')[1].trim();
    if (line.toUpperCase().startsWith('TIME TO COMPLETE DEAL :')) time = line.split(':')[1].trim();
  }
  console.log({buyer, seller, amount, desc, time, adminUsername});

  const adminUser = await prisma.webAdmin.findUnique({ where: { username: adminUsername } });
  console.log('adminUser', adminUser);

  const buyerUser = await prisma.user.findUnique({ where: { username: buyer } });
  const sellerUser = await prisma.user.findUnique({ where: { username: seller } });
  console.log('buyerUser', buyerUser);
  console.log('sellerUser', sellerUser);

  const dealId = 'deal_' + Date.now();
  try {
    await prisma.escrowDeal.create({
      data: { dealId, buyerUsername: buyer, sellerUsername: seller, amount, description: desc, timeToComplete: time, chatId: "123", adminUsername }
    });
    console.log('Deal created', dealId);
  } catch (err) {
    console.error('Create Deal Error', err);
  }
}
main().catch(console.error).finally(()=>prisma.$disconnect());
