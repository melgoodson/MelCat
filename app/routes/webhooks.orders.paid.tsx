import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { grantPurchaseEntitlements } from "../services/entitlement.server";
import prisma from "../db.server";

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
  }

  try {
    const order = payload as any;
    const email = order.email || order.contact_email;
    const shopifyCustomerId = order.customer?.id?.toString();

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

    console.log(`[Webhook] orders/paid — granting entitlements for ${email}, variants: ${variantIds.join(", ")}`);
    await grantPurchaseEntitlements(shopifyCustomerId || "", email, variantIds);

    // Log the webhook
    if (webhookId) {
      await prisma.webhookEvent.create({
        data: { id: webhookId, topic: "orders/paid", status: "success" }
      });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] orders/paid error:", error);

    if (webhookId) {
      await prisma.webhookEvent.create({
        data: { id: webhookId, topic: "orders/paid", status: "failed" }
      });
    }

    return new Response("Error", { status: 500 });
  }
};
