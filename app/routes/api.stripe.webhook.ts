import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { supabase } from "../services/supabase.server";
import crypto from "crypto";

// Manual signature verification (robust, zero-dependency)
function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  
  const parts = signatureHeader.split(",");
  const tPart = parts.find(p => p.startsWith("t="));
  const v1Part = parts.find(p => p.startsWith("v1="));
  
  if (!tPart || !v1Part) return false;
  
  const timestamp = tPart.substring(2);
  const signature = v1Part.substring(3);
  
  const signedPayload = `${timestamp}.${rawBody}`;
  const computedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
    
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(computedSignature, "hex")
    );
  } catch (err) {
    return false;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeSignature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured in env.");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const rawBody = await request.text();

  // 1. Verify signature
  const isSignatureValid = verifyStripeSignature(rawBody, stripeSignature, webhookSecret);
  if (!isSignatureValid) {
    console.error("[Stripe Webhook] Invalid signature received.");
    return new Response("Invalid signature", { status: 400 });
  }

  // 2. Parse event payload
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error("[Stripe Webhook] Failed to parse JSON body:", err);
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  // 3. Handle checkout.session.completed
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const metadata = session?.metadata || {};
    const customerId = metadata.customerId;
    const targetTierStr = metadata.targetTier;

    if (!customerId || !targetTierStr) {
      console.warn("[Stripe Webhook] Missing customerId or targetTier in checkout session metadata, skipping.");
      return Response.json({ received: true });
    }

    const targetTier = parseInt(targetTierStr, 10);
    console.log(`[Stripe Webhook] Processing successful upgrade for Customer: ${customerId} to Tier: ${targetTier}`);

    try {
      // Find customer
      const customer = await prisma.customer.findUnique({
        where: { id: customerId }
      });

      if (!customer) {
        console.error(`[Stripe Webhook] Customer ${customerId} not found in database.`);
        return new Response("Customer not found", { status: 404 });
      }

      // Find all active packs belonging to this tier level
      const packs = await prisma.pack.findMany({
        where: { isActive: true, tier: { level: targetTier } },
        include: { tier: true }
      });

      if (packs.length === 0) {
        console.warn(`[Stripe Webhook] No active packs found for tier level ${targetTier}.`);
      }

      console.log(`[Stripe Webhook] Found ${packs.length} packs to grant for Tier Level ${targetTier}.`);

      // Grant entitlements in PostgreSQL (SQLite) and sync them to Supabase
      for (const pack of packs) {
        // Create local entitlement if it doesn't exist
        const existing = await prisma.entitlement.findFirst({
          where: { customerId: customer.id, packId: pack.id }
        });

        if (!existing) {
          await prisma.entitlement.create({
            data: {
              customerId: customer.id,
              packId: pack.id,
              source: "stripe_upgrade"
            }
          });
          console.log(`[Stripe Webhook] Granted local entitlement for pack: ${pack.name}`);
        }

        // Sync active entitlement status to Supabase big_mel_entitlements
        let variantId = "manual_grant";
        
        // Find mapped variant ID if exists
        const mapping = await prisma.productVariantPackMap.findFirst({
          where: { packId: pack.id }
        });
        if (mapping) {
          variantId = mapping.variantId;
        }

        const { error: supabaseErr } = await supabase
          .from("big_mel_entitlements")
          .upsert(
            {
              customer_id: customer.shopifyCustomerId,
              customer_email: customer.email,
              variant_id: variantId,
              is_active: true,
              updated_at: new Date().toISOString()
            },
            { onConflict: "customer_email,variant_id" }
          );

        if (supabaseErr) {
          console.error(`[Stripe Webhook] Failed to sync entitlement for pack ${pack.name} to Supabase:`, supabaseErr);
        } else {
          console.log(`[Stripe Webhook] Synced entitlement for pack ${pack.name} to Supabase.`);
        }
      }

      // Log customer event for metrics
      const { safelyTrackCustomerEvent } = await import("../services/customerEvent.server");
      await safelyTrackCustomerEvent({
        customerId: customer.id,
        eventType: "upgrade_purchased",
        metadata: { targetTier, source: "stripe_webhook" },
        source: "stripe"
      });

      console.log(`[Stripe Webhook] Upgrade transaction finalized successfully for customer: ${customer.email}`);

    } catch (err) {
      console.error("[Stripe Webhook] Error processing upgrade completion:", err);
      return new Response("Internal server error", { status: 500 });
    }
  }

  return Response.json({ received: true });
}
