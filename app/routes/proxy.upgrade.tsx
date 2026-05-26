import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCustomerSession } from "../services/session.server";
import { safelyTrackCustomerEvent } from "../services/customerEvent.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getCustomerSession(request);
  const customerId = session.get("customerId") as string | undefined;

  const url = new URL(request.url);
  const targetTier = parseInt(url.searchParams.get("tier") || "0", 10);
  const source = url.searchParams.get("source") || "library";

  if (!customerId) {
    return redirect("/apps/snarky/claim");
  }

  // Determine upgrade variant ID
  let targetVariantId = "";

  if (targetTier === 2 && process.env.UPGRADE_VARIANT_STANDARD) {
    targetVariantId = process.env.UPGRADE_VARIANT_STANDARD;
  } else if (targetTier === 3 && process.env.UPGRADE_VARIANT_DELUXE) {
    targetVariantId = process.env.UPGRADE_VARIANT_DELUXE;
  } else if (targetTier === 4 && process.env.UPGRADE_VARIANT_ULTIMATE) {
    targetVariantId = process.env.UPGRADE_VARIANT_ULTIMATE;
  } else {
    // DB lookup
    const mapping = await prisma.productVariantPackMap.findFirst({
      where: {
        pack: {
          tier: {
            level: targetTier,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (mapping) {
      targetVariantId = mapping.variantId;
    }
  }

  // Event tracking
  await safelyTrackCustomerEvent({
    customerId,
    eventType: "upgrade_clicked",
    metadata: { targetTier, targetVariantId },
    source,
    sessionId: session.get("sessionToken"),
  });

  if (!targetVariantId) {
    // Fallback if variant isn't mapped
    return redirect("/collections/all");
  }

  // Clean format: extract digits if Shopify ID format was used e.g. gid://shopify/ProductVariant/1234
  const numericId = targetVariantId.replace(/\D/g, "");

  const shopDomain = process.env.SHOP_DOMAIN || "fhfwar-jc.myshopify.com";
  
  // Fast checkout link
  return redirect(`https://${shopDomain}/cart/${numericId}:1`);
}
