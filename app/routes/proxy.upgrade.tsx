import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCustomerSession } from "../services/session.server";
import { safelyTrackCustomerEvent } from "../services/customerEvent.server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const targetTier = parseInt(url.searchParams.get("tier") || "0", 10);
  const source = url.searchParams.get("source") || "library";
  const token = url.searchParams.get("token");

  let customerId: string | undefined = undefined;

  // 1. Try to authenticate via Shopify App Proxy signature first
  try {
    const { session } = await authenticate.public.appProxy(request);
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
    const session = await getCustomerSession(request);
    customerId = session.get("customerId") as string | undefined;
  }

  const session = await getCustomerSession(request);

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

  // Dev Sandbox Bypass:
  // If targetVariantId is missing OR we are in a sandbox environment (e.g. localhost, local tunnel, or no variant mapped)
  // we can grant the tier directly for easy testing!
  const isDev = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.includes("trycloudflare.com") || url.hostname.includes("ngrok");
  
  if (!targetVariantId || isDev) {
    // 1. Find the target tier
    const tier = await prisma.tier.findUnique({
      where: { level: targetTier }
    });
    
    if (tier) {
      // 2. Find or create a sandbox pack for this tier
      let pack = await prisma.pack.findFirst({
        where: { tierId: tier.id, name: `${tier.name} Sandbox Pack` }
      });
      
      if (!pack) {
        pack = await prisma.pack.create({
          data: {
            name: `${tier.name} Sandbox Pack`,
            tierId: tier.id,
            isActive: true
          }
        });
      }
      
      // 3. Create entitlement for the customer to this pack
      const existingEntitlement = await prisma.entitlement.findFirst({
        where: { customerId, packId: pack.id }
      });
      
      if (!existingEntitlement) {
        await prisma.entitlement.create({
          data: {
            customerId,
            packId: pack.id,
            source: "SANDBOX_UPGRADE"
          }
        });
      }
      
      // 4. Redirect back to library page with token
      const redirectUrl = `/proxy/library${token ? `?token=${token}` : ""}`;
      return redirect(redirectUrl);
    }
  }

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
