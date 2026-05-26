import type { LoaderFunctionArgs } from "react-router";
import { getCustomerSession } from "../services/session.server";
import { getAssetSignedUrl } from "../services/storage.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getCustomerSession(request);
  const customerId = session.get("customerId") as string;
  const url = new URL(request.url);
  const assetId = url.searchParams.get("id");

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
    const maxTierAgg = await prisma.entitlement.aggregate({
      where: { customerId, revoked: false },
      _max: { pack: { select: { tier: { select: { level: true } } } } } // nested select trick: better to get tiers
    });
    // Let's do it safely:
    const userEntitlements = await prisma.entitlement.findMany({
      where: { customerId, revoked: false },
      include: { pack: { include: { tier: true } } }
    });
    const maxTier = userEntitlements.length > 0 ? Math.max(...userEntitlements.map(e => e.pack.tier.level)) : 0;

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
        sessionId: session.get("sessionToken") as string
      });
    } else {
      await safelyTrackCustomerEvent({
        customerId,
        eventType: "asset_downloaded",
        metadata: { assetId: asset.id, type: asset.type, packId: isEntitledPack?.packId },
        source: "library",
        sessionId: session.get("sessionToken") as string
      });
    }

    return Response.redirect(signedUrl, 302);
  } catch (err) {
    console.error("[Storage] Failed to generate Supabase signed URL:", err);
    return new Response("Internal storage error.", { status: 500 });
  }
}
