import prisma from '../db.server';

export async function grantPurchaseEntitlements(shopifyCustomerId: string, email: string, variantIds: string[]) {
  // Sync customer
  let customer = await prisma.customer.findUnique({ where: { email } });
  if (!customer) {
    customer = await prisma.customer.create({ data: { email, shopifyCustomerId } });
  } else if (!customer.shopifyCustomerId && shopifyCustomerId) {
    customer = await prisma.customer.update({ where: { id: customer.id }, data: { shopifyCustomerId } });
  }

  // Find mapped packs
  const mappings = await prisma.productVariantPackMap.findMany({
    where: { variantId: { in: variantIds } }
  });

  for (const mapping of mappings) {
    await prisma.entitlement.create({
      data: {
        customerId: customer.id,
        packId: mapping.packId,
        source: 'PURCHASE'
      }
    });
  }
}

export async function getCustomerLibrary(customerId: string) {
  const entitlements = await prisma.entitlement.findMany({
    where: { customerId, revoked: false },
    include: {
      pack: {
        include: {
          tier: true,
          packAssets: { include: { digitalAsset: true }}
        }
      }
    }
  });

  return entitlements.map(e => e.pack);
}
