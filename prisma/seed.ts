import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial data...');

  // 1. Create Tiers
  const tiers = [
    { name: 'Lite', level: 1 },
    { name: 'Standard', level: 2 },
    { name: 'Deluxe', level: 3 },
    { name: 'Ultimate', level: 4 },
  ];

  for (const tier of tiers) {
    await prisma.tier.upsert({
      where: { name: tier.name },
      update: { level: tier.level },
      create: tier,
    });
  }
  console.log('Tiers seeded successfully.');

  // Check if we already have test packs
  const existingPack = await prisma.pack.findFirst({ where: { name: 'Summer Drop Lite' } });
  
  if (!existingPack) {
    // 2. Demo Packs
    const liteTier = await prisma.tier.findUnique({ where: { name: 'Lite' } });
    const ultimateTier = await prisma.tier.findUnique({ where: { name: 'Ultimate' } });

    if (liteTier && ultimateTier) {
      const litePack = await prisma.pack.create({
        data: {
          name: 'Summer Drop Lite',
          tierId: liteTier.id,
        }
      });
      console.log('Created test Pack: Summer Drop Lite');

      const ultimatePack = await prisma.pack.create({
        data: {
          name: 'Summer Drop Ultimate',
          tierId: ultimateTier.id,
        }
      });
      console.log('Created test Pack: Summer Drop Ultimate');

      // 3. Sample QR
      await prisma.qRCampaign.create({
        data: {
          campaignHash: 'SMMR-QR-2026',
          packId: litePack.id,
          maxRedemptions: 1000,
        }
      });
      console.log('Created test QR Campaign: SMMR-QR-2026');
    }
  } else {
    console.log('Test data already seeded. Skipping.');
  }

}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
