import prisma from "../db.server";

export async function mergeCustomerProfiles(sourceEmail: string, targetEmail: string) {
  if (sourceEmail.toLowerCase() === targetEmail.toLowerCase()) {
    throw new Error("Cannot merge the same email profile into itself.");
  }

  const sourceCustomer = await prisma.customer.findUnique({ where: { email: sourceEmail } });
  const targetCustomer = await prisma.customer.findUnique({ where: { email: targetEmail } });

  if (!sourceCustomer) {
    throw new Error(`Source customer ${sourceEmail} not found.`);
  }

  if (!targetCustomer) {
    throw new Error(`Target customer ${targetEmail} not found.`);
  }

  // Execute merge in a transaction to ensure no stranded data
  await prisma.$transaction(async (tx) => {
    // 1. Reassign Entitlements
    await tx.entitlement.updateMany({
      where: { customerId: sourceCustomer.id },
      data: { customerId: targetCustomer.id }
    });

    // 2. Reassign QR Redemptions 
    // Careful: what if target already claimed the same campaign?
    // In Prisma, violating a unique constraint throws.
    // Instead of raw updateMany, we must map them manually to drop duplicates
    const sourceRedemptions = await tx.qRRedemption.findMany({ where: { customerId: sourceCustomer.id } });
    const targetRedemptions = await tx.qRRedemption.findMany({ where: { customerId: targetCustomer.id } });

    for (const s of sourceRedemptions) {
      const exists = targetRedemptions.some(t => t.campaignId === s.campaignId);
      if (exists) {
        // Drop duplicate constraint
        await tx.qRRedemption.delete({ where: { id: s.id } });
      } else {
        await tx.qRRedemption.update({
          where: { id: s.id },
          data: { customerId: targetCustomer.id }
        });
      }
    }

    // 3. Log Audit
    await tx.adminAuditLog.create({
      data: {
        action: "CUSTOMER_MERGE",
        customerId: targetCustomer.id,
        details: JSON.stringify({
          sourceEmail,
          targetEmail,
          sourceId: sourceCustomer.id
        })
      }
    });

    // 4. Invalidate source sessions / tokens
    await tx.customerSession.deleteMany({ where: { customerId: sourceCustomer.id } });
    await tx.emailLoginToken.deleteMany({ where: { customerId: sourceCustomer.id } });

    // 5. Hard delete the source profile 
    await tx.customer.delete({ where: { id: sourceCustomer.id } });
  });

  return { success: true };
}
