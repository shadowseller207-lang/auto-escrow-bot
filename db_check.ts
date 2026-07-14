import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Admins:', await prisma.webAdmin.findMany());
  console.log('Users:', await prisma.user.findMany());
  console.log('Deals:', await prisma.escrowDeal.findMany());
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
