import prisma from "../db.server";
import crypto from "crypto";
import { sendDropNotificationEmail } from "./mail.server";

export async function sendDropNotifications(dropId: string): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop || !drop.isActive) {
    throw new Error("Drop not found or not active.");
  }

  // Find eligible customers:
  // 1. Not already notified for this drop
  // 2. Have a valid entitlement for a pack that is at least requiredTierLevel
  
  const eligibleCustomers = await prisma.customer.findMany({
    where: {
      dropNotifications: {
        none: { dropId }
      },
      entitlements: {
        some: {
          revoked: false,
          pack: {
            tier: {
              level: { gte: drop.requiredTierLevel }
            }
          }
        }
      }
    }
  });

  const shopDomain = process.env.SHOP_DOMAIN || "fhfwar-jc.myshopify.com";

  for (const customer of eligibleCustomers) {
    try {
      // 1. Create a magic link token (60 mins for drop notification)
      const token = crypto.randomBytes(32).toString('hex');
      await prisma.emailLoginToken.create({
        data: {
          customerId: customer.id,
          tokenHash: token,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 60 mins
        }
      });

      const callbackUrl = `https://${shopDomain}/apps/snarky/auth/callback?token=${token}`;

      // 2. Send Email
      await sendDropNotificationEmail(customer.email, drop.title, callbackUrl);

      // 3. Log it
      await prisma.dropNotificationLog.create({
        data: {
          dropId,
          customerId: customer.id,
          status: "sent"
        }
      });
      sent++;

    } catch (error: any) {
      console.error(`[Drop Notification] Error for customer ${customer.email}:`, error);
      await prisma.dropNotificationLog.create({
        data: {
          dropId,
          customerId: customer.id,
          status: "failed",
          errorMessage: error.message || "Unknown error"
        }
      });
      failed++;
    }
  }

  // Find customers who were already notified
  skipped = await prisma.dropNotificationLog.count({
    where: { dropId }
  }) - sent - failed; // already existed before this run

  return { sent, skipped, failed };
}
