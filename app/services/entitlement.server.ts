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
    where: { variantId: { in: variantIds } },
    include: { pack: { include: { tier: true } } }
  });

  if (mappings.length === 0) {
    return { customer, granted: false };
  }

  let grantedNew = false;
  let alreadyOwned = false;

  for (const mapping of mappings) {
    const existing = await prisma.entitlement.findFirst({
      where: { customerId: customer.id, packId: mapping.packId }
    });
    
    if (!existing) {
      await prisma.entitlement.create({
        data: {
          customerId: customer.id,
          packId: mapping.packId,
          source: 'PURCHASE'
        }
      });
      grantedNew = true;
    } else {
      alreadyOwned = true;
    }
  }

  return { customer, granted: grantedNew || alreadyOwned, grantedNew, alreadyOwned, mappings };
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
