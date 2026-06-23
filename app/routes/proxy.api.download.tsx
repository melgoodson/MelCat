import type { LoaderFunctionArgs } from "react-router";
import { getCustomerSession } from "../services/session.server";
import { getAssetSignedUrl } from "../services/storage.server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const assetId = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const session = await getCustomerSession(request);

  let customerId: string | undefined = undefined;

  // 1. Try to authenticate via Shopify App Proxy signature first
  try {
    const { session: shopifySession } = await authenticate.public.appProxy(request);
    const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");
    if (loggedInCustomerId) {
      const customer = await prisma.customer.findFirst({
        where: { shopifyCustomerId: loggedInCustomerId }
      });
      if (customer) {
        customerId = customer.id;
      }
    }
  } catch (err) {
    // Signature verification failed or not in proxy context, skip
  }

  // 2. Try to authenticate via URL session token second
  if (!customerId && token) {
    const sessionRecord = await prisma.customerSession.findFirst({
      where: { sessionToken: token, expiresAt: { gte: new Date() } },
      include: { customer: true }
    });
    if (sessionRecord) {
      customerId = sessionRecord.customerId;
    }
  }

  // 3. Fallback to cookie session (for dev/direct local testing)
  if (!customerId) {
    customerId = session.get("customerId") as string | undefined;
  }

  if (!customerId || !assetId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Verify Entitlement Security:
  // Is this asset ID present in any pack the customer owns?
  const isEntitledPack = await prisma.entitlement.findFirst({
    where: {
      customerId,
      revoked: false,
      pack: {
        packAssets: {
          some: { assetId },
        },
      },
    },
    include: { pack: true }
  });

  // Is this asset ID present in any drop the customer is eligible for?
  let isEntitledDrop: any = null;
  if (!isEntitledPack) {
    // Let's do it safely:
    const userEntitlements = await prisma.entitlement.findMany({
      where: { customerId, revoked: false },
      include: { pack: { include: { tier: true } } }
    });
    const maxTier = userEntitlements.length > 0 ? Math.max(...userEntitlements.map(e => e.pack?.tier?.level ?? 0)) : 0;

    isEntitledDrop = await prisma.drop.findFirst({
      where: {
        isActive: true,
        releaseDate: { lte: new Date() },
        requiredTierLevel: { lte: maxTier },
        dropAssets: { some: { assetId } }
      }
    });

    if (!isEntitledDrop) {
      return new Response("Forbidden: You do not own this asset.", { status: 403 });
    }
  }

  const asset = await prisma.digitalAsset.findUnique({ where: { id: assetId } });
  if (!asset || !asset.isActive) {
    return new Response("Asset not found.", { status: 404 });
  }

  // Generate secure presigned URL via Supabase Storage
  try {
    const signedUrl = await getAssetSignedUrl(asset.fileKey, 5); // 5 mins expiry
    
    const { safelyTrackCustomerEvent } = await import("../services/customerEvent.server");
    
    if (isEntitledDrop) {
      await safelyTrackCustomerEvent({
        customerId,
        eventType: "drop_downloaded",
        metadata: { assetId: asset.id, type: asset.type, dropId: isEntitledDrop.id },
        source: "library",
        sessionId: token || (session.get("sessionToken") as string | undefined) || undefined
      });
    } else {
      await safelyTrackCustomerEvent({
        customerId,
        eventType: "asset_downloaded",
        metadata: { assetId: asset.id, type: asset.type, packId: isEntitledPack?.packId },
        source: "library",
        sessionId: token || (session.get("sessionToken") as string | undefined) || undefined
      });
    }

    return Response.redirect(signedUrl, 302);
  } catch (err) {
    console.error("[Storage] Failed to generate Supabase signed URL:", err);
    return new Response("Internal storage error.", { status: 500 });
  }
}
