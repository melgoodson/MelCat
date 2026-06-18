import prisma from '../db.server';

export async function grantPurchaseEntitlements(
  shopifyCustomerId: string,
  email: string,
  variantIds: string[],
  lineItems?: Array<{ variantId?: string; title?: string }>
) {
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

  // Check for cat tunnel or cat cube free access
  let hasFreeItem = false;
  let freeItemTitle = "";
  let freeProductType: "tunnel" | "cube" | null = null;

  if (lineItems) {
    for (const item of lineItems) {
      const title = (item.title || "").toLowerCase();
      if (title.includes("tunnel")) {
        hasFreeItem = true;
        freeItemTitle = item.title || "Cat Tunnel";
        freeProductType = "tunnel";
        break;
      } else if (title.includes("cube")) {
        hasFreeItem = true;
        freeItemTitle = item.title || "Cat Cube";
        freeProductType = "cube";
        break;
      }
    }
  }

  // Find Lite pack (tier level 1) if free item purchased
  let litePack = null;
  if (hasFreeItem) {
    litePack = await prisma.pack.findFirst({
      where: { isActive: true, tier: { level: 1 } },
      include: { tier: true }
    });
  }

  const packsToGrant: Array<{ id: string; name: string; tier: { name: string; level: number } }> = [];
  mappings.forEach(m => {
    packsToGrant.push(m.pack);
  });
  if (litePack) {
    packsToGrant.push(litePack);
  }

  if (packsToGrant.length === 0) {
    return { customer, granted: false, grantedNew: false, alreadyOwned: false, mappings: [] };
  }

  let grantedNew = false;
  let alreadyOwned = false;

  for (const pack of packsToGrant) {
    const existing = await prisma.entitlement.findFirst({
      where: { customerId: customer.id, packId: pack.id }
    });
    
    if (!existing) {
      await prisma.entitlement.create({
        data: {
          customerId: customer.id,
          packId: pack.id,
          source: 'PURCHASE'
        }
      });
      grantedNew = true;

      // Track if it was a free tier grant
      if (litePack && pack.id === litePack.id) {
        const { safelyTrackCustomerEvent } = await import("./customerEvent.server");
        await safelyTrackCustomerEvent({
          customerId: customer.id,
          eventType: "free_tier_granted",
          metadata: { productType: freeProductType, title: freeItemTitle },
          source: "webhook"
        });
      }
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
