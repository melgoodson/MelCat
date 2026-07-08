import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useSearchParams } from "react-router";
import { createMagicLinkToken } from "../services/auth.server";
import { sendMagicLink } from "../services/mail.server";
import { claimQrCampaign } from "../services/qr.server";
import { getCustomerSession } from "../services/session.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const campaign = url.searchParams.get("c"); // QR campaign hash
  const type = url.searchParams.get("type") || "shopify";
  const session = await getCustomerSession(request);
  const customerId = session.get("customerId");
  
  let appUrl = process.env.SHOPIFY_APP_URL || "https://snarky-mel-cat-34130528345.northamerica-northeast2.run.app";
  const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";

  if (isLocalHost) {
    appUrl = `${url.protocol}//${url.host}`;
  } else if (forwardedHost && (forwardedHost.includes("localhost") || forwardedHost.includes("127.0.0.1") || forwardedHost.includes("trycloudflare.com") || forwardedHost.includes("ngrok"))) {
    appUrl = `${forwardedProto}://${forwardedHost}`;
  } else if (url.hostname.includes("trycloudflare.com") || url.hostname.includes("ngrok")) {
    appUrl = `${url.protocol}//${url.host}`;
  }

  return { campaign, isLoggedIn: !!customerId, appUrl, defaultClaimType: type };
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const campaignHash = formData.get("campaign") as string;
  const amazonOrderId = (formData.get("amazonOrderId") as string || "").trim();

  if (!email || !email.includes("@")) {
    return { error: "Please enter a valid email address." };
  }

  let claimStatus = "PENDING";
  let isAmazonClaim = false;

  if (amazonOrderId) {
    isAmazonClaim = true;
    const orderIdRegex = /^\d{3}-\d{7}-\d{7}$/;
    if (!orderIdRegex.test(amazonOrderId)) {
      return { error: "Please enter a valid Amazon Order ID (e.g. 123-4567890-1234567)." };
    }

    const existingClaim = await prisma.amazonClaim.findFirst({
      where: { orderId: amazonOrderId, status: "APPROVED" }
    });
    if (existingClaim) {
      return { error: "This Amazon Order ID has already been claimed." };
    }

    const preApproved = await prisma.amazonOrder.findUnique({
      where: { orderId: amazonOrderId }
    });

    if (preApproved) {
      if (preApproved.isClaimed) {
        return { error: "This Amazon Order ID has already been claimed." };
      }
      claimStatus = "APPROVED";
    } else {
      // If not pre-approved, check Shopify Admin API for synced orders matching this Order ID
      const shopDomain = new URL(request.url).searchParams.get("shop") || "fhfwar-jc.myshopify.com";
      const session = await prisma.session.findFirst({
        where: { shop: shopDomain, isOnline: false }
      });

      if (session && session.accessToken) {
        try {
          const { unauthenticated } = await import("../shopify.server");
          const { admin } = await unauthenticated.admin(shopDomain);
          
          const response = await admin.graphql(`
            query searchOrders($q: String!) {
              orders(first: 5, query: $q) {
                nodes {
                  id
                  name
                  note
                  tags
                  customAttributes {
                    key
                    value
                  }
                  lineItems(first: 25) {
                    nodes {
                      title
                    }
                  }
                }
              }
            }
          `, {
            variables: { q: amazonOrderId }
          });

          if (response.ok) {
            const resJson = await response.json();
            const orders = resJson?.data?.orders?.nodes || [];
            
            let foundInShopify = false;
            let matchedSku = "cat-tunnel";

            for (const order of orders) {
              const idLower = amazonOrderId.toLowerCase();
              const nameMatch = (order.name || "").toLowerCase().includes(idLower);
              const noteMatch = (order.note || "").toLowerCase().includes(idLower);
              const tagMatch = (order.tags || []).some((t: string) => t.toLowerCase().includes(idLower));
              const attrMatch = (order.customAttributes || []).some((attr: any) => 
                (attr.value || "").toLowerCase().includes(idLower)
              );

              if (nameMatch || noteMatch || tagMatch || attrMatch) {
                const items = order.lineItems?.nodes || [];
                const hasTunnel = items.some((item: any) => (item.title || "").toLowerCase().includes("tunnel"));
                const hasCube = items.some((item: any) => (item.title || "").toLowerCase().includes("cube"));

                if (hasTunnel || hasCube) {
                  foundInShopify = true;
                  matchedSku = hasCube ? "cat-cube" : "cat-tunnel";
                  break;
                }
              }
            }

            if (foundInShopify) {
              claimStatus = "APPROVED";
              
              // Seed the AmazonOrder in the database so that it is marked as claimed
              try {
                await prisma.amazonOrder.upsert({
                  where: { orderId: amazonOrderId },
                  update: { isClaimed: true, claimedAt: new Date(), claimedBy: email, sku: matchedSku },
                  create: { orderId: amazonOrderId, sku: matchedSku, isClaimed: true, claimedAt: new Date(), claimedBy: email }
                });
              } catch (err) {
                console.error("[Amazon Claim Auto-Seeding Error]", err);
              }
            }
          }
        } catch (err) {
          console.error("[Amazon Claim Shopify Order Lookup Error]", err);
        }
      }
    }

    try {
      await prisma.amazonClaim.upsert({
        where: { orderId_email: { orderId: amazonOrderId, email } },
        update: { status: claimStatus, campaignHash },
        create: { orderId: amazonOrderId, email, status: claimStatus, campaignHash }
      });
    } catch (err) {
      console.error("[Amazon Claim Create Error]", err);
      return { error: "Could not register your claim. Try again." };
    }
  }

  try {
    const token = await createMagicLinkToken(email);

    // Build callback URL with campaign context
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop") || "fhfwar-jc.myshopify.com";
    let callbackUrl = `https://${shop}/apps/snarky/auth/callback?token=${token}`;
    if (campaignHash) {
      callbackUrl += `&c=${encodeURIComponent(campaignHash)}`;
    }

    try {
      await sendMagicLink(email, token, callbackUrl);
      
      const customer = await prisma.customer.findUnique({ where: { email } });
      if (customer) {
        const { safelyTrackCustomerEvent } = await import("../services/customerEvent.server");
        await safelyTrackCustomerEvent({
          customerId: customer.id,
          eventType: "magic_link_requested",
          metadata: { campaignHash, amazonOrderId: amazonOrderId || undefined },
          source: amazonOrderId ? "amazon_claim" : "claim"
        });
      }

      return {
        success: true,
        isAmazon: isAmazonClaim,
        isApproved: claimStatus === "APPROVED",
        message: isAmazonClaim
          ? (claimStatus === "APPROVED"
            ? "Your Amazon order is verified! Check your email for a magic link to access your content."
            : "Your Amazon claim is submitted for verification! Check your email to verify your email address. Once our team approves it, your packs will appear in your library.")
          : "Check your email! We sent you a magic link to access your digital content.",
      };
    } catch (err) {
      throw err;
    }
  } catch (err) {
    console.error("[Claim] Error:", err);
    return { error: "Something went wrong. Please try again." };
  }
}

export default function ClaimPortal() {
  const { campaign, appUrl, defaultClaimType } = useLoaderData<typeof loader>();
  const baseUrl = appUrl;
  const actionData = useActionData<typeof action>();
  const [claimType, setClaimType] = useState<"shopify" | "amazon">(defaultClaimType as "shopify" | "amazon" || "shopify");

  useEffect(() => {
    if (defaultClaimType) {
      setClaimType(defaultClaimType as "shopify" | "amazon");
    }
  }, [defaultClaimType]);

  const getToggleUrl = (type: "shopify" | "amazon") => {
    if (typeof window === "undefined") {
      return `?type=${type}${campaign ? `&c=${campaign}` : ""}`;
    }
    const params = new URLSearchParams(window.location.search);
    params.set("type", type);
    return `?${params.toString()}`;
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <div style={styles.header}>
            <div style={{ margin: '0 auto 1.5rem', width: '100px', height: '100px', borderRadius: '50%', overflow: 'hidden', border: '3px solid #f28c28', boxShadow: '0 8px 24px rgba(242, 140, 40, 0.25)', background: '#fff9f0' }}>
              <img src={`${baseUrl}/mascot.jpeg`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="MelCat Mascot" />
            </div>
          <h1 style={styles.title}>MelCat</h1>
          <p style={styles.subtitle}>Unlock Your Digital Treasures</p>
        </div>

        {actionData?.success ? (
          <div style={styles.successCard}>
            <div style={styles.successIcon}>✉️</div>
            <h2 style={styles.successTitle}>Check Your Email!</h2>
            <p style={styles.successText}>{actionData.message}</p>
          </div>
        ) : (
          <div style={styles.formCard}>
            
            {/* Claim Type Tabs */}
            <div style={{ display: "flex", borderBottom: "2px solid #f3f4f6", marginBottom: "1.5rem" }}>
              <a 
                href={getToggleUrl("shopify")}
                onClick={(e) => {
                  e.preventDefault();
                  setClaimType("shopify");
                  window.history.pushState(null, "", getToggleUrl("shopify"));
                }}
                style={{ 
                  flex: 1, 
                  padding: "0.75rem", 
                  background: "none", 
                  border: "none", 
                  borderBottom: claimType === "shopify" ? "3px solid #f28c28" : "none", 
                  color: claimType === "shopify" ? "#f28c28" : "#9ca3af", 
                  fontWeight: 700, 
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  textAlign: "center",
                  textDecoration: "none"
                }}
              >
                Shopify Purchase 🛍️
              </a>
              <a 
                href={getToggleUrl("amazon")}
                onClick={(e) => {
                  e.preventDefault();
                  setClaimType("amazon");
                  window.history.pushState(null, "", getToggleUrl("amazon"));
                }}
                style={{ 
                  flex: 1, 
                  padding: "0.75rem", 
                  background: "none", 
                  border: "none", 
                  borderBottom: claimType === "amazon" ? "3px solid #f28c28" : "none", 
                  color: claimType === "amazon" ? "#f28c28" : "#9ca3af", 
                  fontWeight: 700, 
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  textAlign: "center",
                  textDecoration: "none"
                }}
              >
                Amazon Purchase 📦
              </a>
            </div>

            {campaign && (
              <div style={styles.campaignBadge}>
                🎉 QR Campaign: <strong>{campaign}</strong>
              </div>
            )}
            
            <p style={styles.formText}>
              {claimType === "amazon" 
                ? "Bought on Amazon? Enter your email and Amazon Order ID to verify your purchase and claim your digital vault library."
                : "Enter your email to receive a secure magic link. No password needed!"}
            </p>

            {actionData?.error && (
              <div style={styles.errorBanner}>{actionData.error}</div>
            )}

            <form method="post">
              <input type="hidden" name="campaign" value={campaign || ""} />
              <div style={styles.inputGroup}>
                <div style={{ textAlign: "left" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 700, color: "#2d1b0d", display: "block", marginBottom: "0.4rem" }}>Email Address</label>
                  <input
                    type="email"
                    name="email"
                    placeholder="you@example.com"
                    required
                    style={styles.input}
                  />
                </div>

                {claimType === "amazon" && (
                  <div style={{ textAlign: "left" }}>
                    <label style={{ fontSize: "0.85rem", fontWeight: 700, color: "#2d1b0d", display: "block", marginBottom: "0.4rem" }}>Amazon Order ID</label>
                    <input
                      type="text"
                      name="amazonOrderId"
                      placeholder="e.g. 123-4567890-1234567"
                      required
                      style={styles.input}
                    />
                    <span style={{ fontSize: "0.75rem", color: "#6b5c4f", marginTop: "0.25rem", display: "block" }}>
                      Find this in your Amazon Order confirmation email.
                    </span>
                  </div>
                )}

                <button type="submit" style={styles.button}>
                  {claimType === "amazon" ? "Verify & Submit Claim" : "Send Magic Link"}
                </button>
              </div>
            </form>
          </div>
        )}

        <p style={styles.footer}>
          Your email is only used to deliver your digital content.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #fffaf0 0%, #fdf2df 50%, #fbe8cc 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
    fontFamily: "'Outfit', 'Segoe UI', system-ui, sans-serif",
  },
  container: {
    maxWidth: "480px",
    width: "100%",
    textAlign: "center" as const,
  },
  header: {
    marginBottom: "2rem",
  },
  title: {
    fontSize: "3rem",
    fontWeight: 800,
    background: "linear-gradient(90deg, #f28c28, #e37322)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: "0 0 0.25rem 0",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: "1.2rem",
    color: "#6b5c4f",
    margin: 0,
  },
  formCard: {
    background: "#fff",
    borderRadius: "24px",
    padding: "3rem 2rem",
    boxShadow: "0 20px 40px rgba(45, 27, 13, 0.08)",
    border: "1px solid rgba(242, 140, 40, 0.1)",
  },
  campaignBadge: {
    background: "rgba(242, 140, 40, 0.1)",
    color: "#e37322",
    padding: "0.6rem 1.2rem",
    borderRadius: "30px",
    fontSize: "0.85rem",
    fontWeight: 700,
    marginBottom: "1.5rem",
    display: "inline-block",
  },
  formText: {
    color: "#2d1b0d",
    fontSize: "1rem",
    marginBottom: "2rem",
    lineHeight: 1.6,
  },
  errorBanner: {
    background: "#fff1f0",
    border: "1px solid #ffa39e",
    color: "#cf1322",
    padding: "0.75rem 1rem",
    borderRadius: "10px",
    fontSize: "0.85rem",
    marginBottom: "1.5rem",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  },
  input: {
    width: "100%",
    padding: "1rem 1.2rem",
    borderRadius: "14px",
    border: "1px solid #d9d9d9",
    background: "#fff",
    color: "#2d1b0d",
    fontSize: "1rem",
    outline: "none",
    boxSizing: "border-box" as const,
    transition: "border-color 0.2s",
  },
  button: {
    width: "100%",
    padding: "1rem",
    borderRadius: "14px",
    border: "none",
    background: "linear-gradient(135deg, #f28c28, #e37322)",
    color: "#fff",
    fontSize: "1.1rem",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 8px 15px rgba(242, 140, 40, 0.3)",
    transition: "transform 0.15s",
  },
  successCard: {
    background: "#fff",
    borderRadius: "24px",
    padding: "3rem 2rem",
    boxShadow: "0 20px 40px rgba(45, 27, 13, 0.08)",
  },
  successIcon: {
    fontSize: "4rem",
    marginBottom: "1rem",
  },
  successTitle: {
    fontSize: "1.75rem",
    fontWeight: 800,
    color: "#2d1b0d",
    margin: "0 0 1rem 0",
  },
  successText: {
    color: "#6b5c4f",
    fontSize: "1rem",
    lineHeight: 1.6,
    margin: 0,
  },
  footer: {
    color: "#6b5c4f",
    fontSize: "0.8rem",
    marginTop: "2rem",
    opacity: 0.7,
  },
};
