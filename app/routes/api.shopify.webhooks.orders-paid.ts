import type { ActionFunctionArgs } from "react-router";
import { ENV } from "../services/env.server";
import { supabase } from "../services/supabase.server";
import crypto from "crypto";

function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;
  const secret = ENV.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return false;

  const hash = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const hashBuffer = Buffer.from(hash);
  const hmacBuffer = Buffer.from(hmacHeader);

  if (hashBuffer.length !== hmacBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hashBuffer, hmacBuffer);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await request.text();
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");

  // 1. Verify Shopify HMAC signature
  if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
    console.error("[Webhook] Invalid HMAC signature received on orders-paid");
    return new Response("Unauthorized", { status: 401 });
  }

  const webhookId = request.headers.get("X-Shopify-Webhook-Id") || `wh-${Date.now()}`;
  const topic = request.headers.get("X-Shopify-Topic") || "orders/paid";
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain") || "snarkypets.com";

  try {
    // 2. Check Idempotency / Duplicate Webhook
    const { data: existingEvent, error: selectError } = await supabase
      .from("big_mel_webhook_events")
      .select("id, processed")
      .eq("id", webhookId)
      .maybeSingle();

    if (selectError) {
      console.error("[Webhook] Error checking existing event:", selectError);
      return new Response("Database Error", { status: 500 });
    }

    if (existingEvent) {
      console.log(`[Webhook] Duplicate event detected: ${webhookId}. Skipping processing.`);
      return new Response("Already processed", { status: 200 });
    }

    const payload = JSON.parse(rawBody);

    // 3. Store event in big_mel_webhook_events as pending (processed = false)
    const { error: insertEventError } = await supabase
      .from("big_mel_webhook_events")
      .insert({
        id: webhookId,
        topic: topic,
        shop_domain: shopDomain,
        payload: payload,
        processed: false
      });

    if (insertEventError) {
      console.error("[Webhook] Failed to insert webhook event:", insertEventError);
      return new Response("Database Error", { status: 500 });
    }

    // 4. Extract line items and verify if BIG_MEL_UNLOCK_VARIANT_ID is purchased
    const lineItems = payload.line_items || [];
    
    if (!ENV.BIG_MEL_UNLOCK_VARIANT_ID) {
      console.warn("[Webhook] orders/paid — BIG_MEL_UNLOCK_VARIANT_ID is not configured in environment variables. Webhook processed without checking digital product unlocks.");
    }

    const hasUnlockVariant = lineItems.some(
      (item: any) => ENV.BIG_MEL_UNLOCK_VARIANT_ID && String(item.variant_id) === String(ENV.BIG_MEL_UNLOCK_VARIANT_ID)
    );

    if (hasUnlockVariant) {
      const customerEmail = payload.email || payload.customer?.email || null;
      const customerId = payload.customer?.id ? String(payload.customer.id) : null;
      const variantId = String(ENV.BIG_MEL_UNLOCK_VARIANT_ID);

      console.log(`[Webhook] Granting entitlement. Customer Email: ${customerEmail}, Shopify ID: ${customerId}`);

      // Insert active entitlement
      const { error: entitlementError } = await supabase
        .from("big_mel_entitlements")
        .insert({
          customer_id: customerId,
          customer_email: customerEmail,
          shop_domain: shopDomain,
          variant_id: variantId,
          is_active: true
        });

      if (entitlementError) {
        console.error("[Webhook] Error inserting active entitlement:", entitlementError);
        throw entitlementError; // Let it catch so event processed stays false
      }
    }

    // 5. Mark event processed successfully
    const { error: updateEventError } = await supabase
      .from("big_mel_webhook_events")
      .update({ processed: true })
      .eq("id", webhookId);

    if (updateEventError) {
      console.error("[Webhook] Error updating event status to processed:", updateEventError);
    }

    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("[Webhook] Webhook processing failed with error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
}
