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
  const isEntitled = await prisma.entitlement.findFirst({
    where: {
      customerId,
      revoked: false,
      pack: {
        packAssets: {
          some: { assetId },
        },
      },
    },
  });

  if (!isEntitled) {
    // Alternatively, verify if the asset is in an eligible Drop (Dynamic Tier constraint)
    // Left as an exercise for the temporal Drops system execution.
    return new Response("Forbidden: You do not own this asset.", { status: 403 });
  }

  const asset = await prisma.digitalAsset.findUnique({ where: { id: assetId } });
  if (!asset || !asset.isActive) {
    return new Response("Asset not found.", { status: 404 });
  }

  // Generate secure presigned URL via Supabase Storage
  try {
    const signedUrl = await getAssetSignedUrl(asset.fileKey, 5); // 5 mins expiry
    return Response.redirect(signedUrl, 302);
  } catch (err) {
    console.error("[Storage] Failed to generate Supabase signed URL:", err);
    return new Response("Internal storage error.", { status: 500 });
  }
}
