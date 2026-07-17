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

    // Check for cat tunnel or cat cube/tube free access
    const hasFreeItem = (order.line_items || []).some((item: any) => {
      const title = (item.title || "").toLowerCase();
      return title.includes("tunnel") || title.includes("cube") || title.includes("tube");
    });

    // Extract all variant IDs from line items
    const variantIds: string[] = (order.line_items || [])
      .map((item: any) => item.variant_id?.toString())
      .filter(Boolean);

    if (variantIds.length === 0 && !hasFreeItem) {
      console.log("[Webhook] orders/paid — no variants and no free items in order, skipping.");
      return new Response("No variants", { status: 200 });
    }

    const lineItems = (order.line_items || []).map((item: any) => ({
      variantId: item.variant_id?.toString(),
      title: item.title?.toString(),
    }));

    console.log(`[Webhook] orders/paid — checking entitlements for ${email}, variants: ${variantIds.join(", ")}`);
    const { customer, granted, grantedNew, alreadyOwned, mappings } = await grantPurchaseEntitlements(
      shopifyCustomerId || "",
      email,
      variantIds,
      lineItems
    );

    if (granted) {
      // Record Amazon Order if this is a Marketplace Connect / Amazon order
      const noteAttrs = order.note_attributes || order.custom_attributes || order.customAttributes || [];
      const amazonOrderIdAttr = noteAttrs.find(
        (attr: any) => (attr.name === "Amazon Order Id" || attr.key === "Amazon Order Id")
      );
      const amazonOrderId = amazonOrderIdAttr?.value;
      const isAmazon = order.source_name === "amazon-us" || 
                       (order.tags && String(order.tags).toLowerCase().includes("amazon")) ||
                       (email && email.toLowerCase().endsWith("@mail.codisto.com"));

      if (amazonOrderId || isAmazon) {
        const finalOrderId = amazonOrderId || order.name || "";
        const hasCube = (order.line_items || []).some((item: any) => {
          const title = (item.title || "").toLowerCase();
          return title.includes("cube") || title.includes("tube");
        });
        const sku = hasCube ? "cat-cube" : "cat-tunnel";

        try {
          await prisma.amazonOrder.upsert({
            where: { orderId: finalOrderId },
            update: {
              sku,
              isClaimed: true,
              claimedAt: new Date(order.created_at || order.createdAt || Date.now()),
              claimedBy: email
            },
            create: {
              orderId: finalOrderId,
              sku,
              isClaimed: true,
              claimedAt: new Date(order.created_at || order.createdAt || Date.now()),
              claimedBy: email,
              createdAt: new Date(order.created_at || order.createdAt || Date.now())
            }
          });
          console.log(`[Webhook] Successfully recorded Amazon Order ${finalOrderId} in database.`);
        } catch (err) {
          console.error(`[Webhook] Failed to upsert Amazon Order ${finalOrderId}:`, err);
        }
      }

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
