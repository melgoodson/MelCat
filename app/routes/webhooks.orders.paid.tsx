import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { grantPurchaseEntitlements } from "../services/entitlement.server";
import { sendMagicLink } from "../services/mail.server";
import prisma from "../db.server";
import crypto from "crypto";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] Received ${topic}`);

  // Idempotency check
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");
  if (webhookId) {
    const existing = await prisma.webhookEvent.findUnique({ where: { id: webhookId } });
    if (existing) {
      console.log(`[Webhook] Duplicate ${webhookId}, skipping.`);
      return new Response("Already processed", { status: 200 });
    }
    await prisma.webhookEvent.create({
      data: { id: webhookId, topic: "orders/paid", status: "pending" }
    });
  }

  try {
    const order = payload as any;
    const email = order.email || order.contact_email;
    const shopifyCustomerId = order.customer?.id?.toString();
    const shopDomain = request.headers.get("X-Shopify-Shop-Domain") || "fhfwar-jc.myshopify.com";

    if (!email) {
      console.warn("[Webhook] orders/paid — no customer email, skipping.");
      return new Response("No email", { status: 200 });
    }

    // Extract all variant IDs from line items
    const variantIds: string[] = (order.line_items || [])
      .map((item: any) => item.variant_id?.toString())
      .filter(Boolean);

    if (variantIds.length === 0) {
      console.log("[Webhook] orders/paid — no variants in order, skipping.");
      return new Response("No variants", { status: 200 });
    }

    console.log(`[Webhook] orders/paid — checking entitlements for ${email}, variants: ${variantIds.join(", ")}`);
    const { customer, granted, grantedNew, alreadyOwned, mappings } = await grantPurchaseEntitlements(shopifyCustomerId || "", email, variantIds);

    if (granted) {
      const token = crypto.randomBytes(32).toString('hex');
      await prisma.emailLoginToken.create({
        data: {
          customerId: customer.id,
          tokenHash: token,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 mins
        }
      });
      const callbackUrl = `https://${shopDomain}/apps/snarky/auth/callback?token=${token}`;
      
      if (grantedNew) {
        await sendMagicLink(email, token, callbackUrl);
        console.log(`[Webhook] orders/paid — New pack magic link dispatched to ${email}`);
      } else if (alreadyOwned) {
        const { sendLibraryAccessEmail } = await import("../services/mail.server");
        await sendLibraryAccessEmail(email, token, callbackUrl);
        console.log(`[Webhook] orders/paid — Library access link dispatched to ${email}`);
      }
      
      const { safelyTrackCustomerEvent } = await import("../services/customerEvent.server");
      // For each newly mapped variant, log an event
      for (const map of mappings || []) {
        await safelyTrackCustomerEvent({
          customerId: customer.id,
          eventType: "upgrade_purchased",
          metadata: {
            variantId: map.variantId,
            packId: map.packId,
            tierLevel: map.pack?.tier?.level,
            orderId: order.id,
            orderName: order.name,
          },
          source: "webhook"
        });
      }
    }

    // Log the webhook
    if (webhookId) {
      await prisma.webhookEvent.update({
        where: { id: webhookId },
        data: { status: "success" }
      });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] orders/paid error:", error);

    if (webhookId) {
      await prisma.webhookEvent.update({
        where: { id: webhookId },
        data: { status: "failed" }
      });
    }

    return new Response("Error", { status: 500 });
  }
};
