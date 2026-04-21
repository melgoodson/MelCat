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

  return { success: true, message: 'Successfully claimed pack!' };
}
