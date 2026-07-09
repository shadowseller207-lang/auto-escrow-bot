import prisma from './src/lib/db';
import bcrypt from 'bcrypt';

async function seed() {
  const passwordHash = await bcrypt.hash('11183956', 10);
  await prisma.webAdmin.upsert({
    where: { username: 'shadow' },
    update: { passwordHash },
    create: { username: 'shadow', passwordHash }
  });
  console.log('Master admin seeded successfully.');
}

seed();
