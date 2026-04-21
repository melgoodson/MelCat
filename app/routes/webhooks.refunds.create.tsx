import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
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
    const refund = payload as any;
    const orderId = refund.order_id?.toString();

    if (!orderId) {
      console.warn("[Webhook] refunds/create — no order_id, skipping.");
      return new Response("No order_id", { status: 200 });
    }

    // Extract refunded variant IDs
    const refundedVariantIds: string[] = (refund.refund_line_items || [])
      .map((item: any) => item.line_item?.variant_id?.toString())
      .filter(Boolean);

    if (refundedVariantIds.length === 0) {
      console.log("[Webhook] refunds/create — no refunded variants, skipping.");
      return new Response("No variants", { status: 200 });
    }

    // Find matching pack mappings for refunded variants
    const mappings = await prisma.productVariantPackMap.findMany({
      where: { variantId: { in: refundedVariantIds } }
    });

    const packIds = mappings.map(m => m.packId);

    if (packIds.length > 0) {
      // Revoke entitlements that were sourced from PURCHASE for these packs
      await prisma.entitlement.updateMany({
        where: {
          packId: { in: packIds },
          source: "PURCHASE",
          revoked: false,
        },
        data: { revoked: true }
      });

      console.log(`[Webhook] refunds/create — revoked entitlements for packs: ${packIds.join(", ")}`);
    }

    if (webhookId) {
      await prisma.webhookEvent.create({
        data: { id: webhookId, topic: "refunds/create", status: "success" }
      });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[Webhook] refunds/create error:", error);

    if (webhookId) {
      await prisma.webhookEvent.create({
        data: { id: webhookId, topic: "refunds/create", status: "failed" }
      });
    }

    return new Response("Error", { status: 500 });
  }
};
