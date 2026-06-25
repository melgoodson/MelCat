import prisma from '../db.server';

export async function claimQrCampaign(campaignHash: string, customerId: string) {
  const campaign = await prisma.qRCampaign.findUnique({
    where: { campaignHash },
    include: { pack: true }
  });

  if (!campaign || !campaign.isActive) {
    throw new Error('Invalid or inactive campaign');
  }

  // Fraud / Duplicate check
  const existingRedemption = await prisma.qRRedemption.findUnique({
    where: {
      campaignId_customerId: { campaignId: campaign.id, customerId }
    }
  });

  if (existingRedemption) {
    return { success: true, message: 'Already claimed' };
  }

  await prisma.$transaction([
    prisma.qRRedemption.create({
      data: {
        campaignId: campaign.id,
        customerId
      }
    }),
    prisma.entitlement.create({
      data: {
        customerId,
        packId: campaign.packId,
        source: 'QR_CLAIM',
      }
    })
  ]);

  // Sync to Supabase big_mel_entitlements
  try {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (customer) {
      const { supabase } = await import("./supabase.server");
      const shopDomain = process.env.SHOP_DOMAIN || "fhfwar-jc.myshopify.com";
      
      const mapping = await prisma.productVariantPackMap.findFirst({
        where: { packId: campaign.packId }
      });
      const variantId = mapping?.variantId || "qr_claim_" + campaign.campaignHash;

      const { error: entitlementError } = await supabase
        .from("big_mel_entitlements")
        .insert({
          customer_id: customer.shopifyCustomerId || null,
          customer_email: customer.email,
          shop_domain: shopDomain,
          variant_id: variantId,
          is_active: true
        });

      if (entitlementError) {
        console.error(`[QR Claim Sync] Error syncing to Supabase:`, entitlementError);
      } else {
        console.log(`[QR Claim Sync] Successfully synced to Supabase for ${customer.email}`);
      }
    }
  } catch (err) {
    console.error("[QR Claim Sync] Failed to sync to Supabase:", err);
  }

  const { safelyTrackCustomerEvent } = await import("./customerEvent.server");
  await safelyTrackCustomerEvent({
    customerId,
    eventType: "claim_completed",
    metadata: { campaignHash, packId: campaign.packId },
    source: "qr"
  });

  return { success: true, message: 'Pack claimed successfully!' };
}
