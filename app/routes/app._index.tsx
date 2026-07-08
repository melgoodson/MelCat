import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useActionData, useSubmit, Form } from "react-router";
import { Link, IndexTable, Card, Text, Badge, BlockStack, Box } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "seed_amazon_orders") {
    const rawOrders = formData.get("ordersList") as string;
    const sku = formData.get("sku") as string || "cat-tunnel";
    if (!rawOrders) {
      return Response.json({ error: "Please enter at least one Order ID" });
    }

    const orderIds = rawOrders
      .split("\n")
      .map(o => o.trim())
      .filter(o => o.length > 0);

    let seededCount = 0;
    for (const orderId of orderIds) {
      try {
        await prisma.amazonOrder.upsert({
          where: { orderId },
          update: { sku },
          create: { orderId, sku, isClaimed: false }
        });
        seededCount++;
      } catch (err) {
        console.error(`Failed to seed Amazon Order ID ${orderId}:`, err);
      }
    }

    return Response.json({ success: true, message: `Successfully seeded ${seededCount} Amazon Order IDs.` });
  }

  if (intent === "approve_claim") {
    const claimId = formData.get("claimId") as string;
    if (!claimId) return Response.json({ error: "Missing claim ID" });

    try {
      const claim = await prisma.amazonClaim.findUnique({ where: { id: claimId } });
      if (!claim) return Response.json({ error: "Claim not found" });

      // 1. Mark claim as APPROVED
      await prisma.amazonClaim.update({
        where: { id: claimId },
        data: { status: "APPROVED" }
      });

      // 2. Mark corresponding AmazonOrder as claimed (if it exists)
      try {
        await prisma.amazonOrder.update({
          where: { orderId: claim.orderId },
          data: { isClaimed: true, claimedAt: new Date(), claimedBy: claim.email }
        });
      } catch (err) {
        // AmazonOrder might not exist if it was a manual claim that was approved
        console.log(`Pre-approved Amazon Order not found during claim approval for ID: ${claim.orderId}`);
      }

      // 3. Find Lite pack (level 1)
      const litePack = await prisma.pack.findFirst({
        where: { isActive: true, tier: { level: 1 } },
        include: { tier: true }
      });

      if (!litePack) {
        return Response.json({ error: "Lite pack not found in database. Seed packs first." });
      }

      // 4. Grant entitlement via grantPurchaseEntitlements
      const order = await prisma.amazonOrder.findFirst({ where: { orderId: claim.orderId } });
      const productType = order?.sku || "Amazon Cat Tunnel";
      const { grantPurchaseEntitlements } = await import("../services/entitlement.server");
      const lineItems = [{ title: productType }];
      await grantPurchaseEntitlements("", claim.email, [], lineItems);

      return Response.json({ success: true, message: `Claim approved successfully for ${claim.email}!` });
    } catch (err: any) {
      console.error("Failed to approve claim:", err);
      return Response.json({ error: err.message || "Failed to approve claim" });
    }
  }

  if (intent === "reject_claim") {
    const claimId = formData.get("claimId") as string;
    if (!claimId) return Response.json({ error: "Missing claim ID" });

    try {
      await prisma.amazonClaim.update({
        where: { id: claimId },
        data: { status: "REJECTED" }
      });
      return Response.json({ success: true, message: "Claim rejected." });
    } catch (err: any) {
      console.error("Failed to reject claim:", err);
      return Response.json({ error: err.message || "Failed to reject claim" });
    }
  }

  if (intent === "sync_shopify_orders") {
    try {
      const { admin } = await authenticate.admin(request);
      
      const response = await admin.graphql(`
        query getRecentOrders {
          orders(first: 100, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              createdAt
              email
              customer {
                id
              }
              lineItems(first: 50) {
                nodes {
                  variant {
                    id
                  }
                  title
                }
              }
            }
          }
        }
      `);

      if (!response.ok) {
        return Response.json({ error: "Failed to fetch orders from Shopify API" });
      }

      const resJson = await response.json();
      const orders = resJson?.data?.orders?.nodes || [];

      const { grantPurchaseEntitlements } = await import("../services/entitlement.server");
      let syncedCount = 0;

      for (const order of orders) {
        const email = (order.email || "").toLowerCase().trim();
        const shopifyCustomerId = order.customer?.id ? String(order.customer.id).replace(/\D/g, "") : "";
        const lineItems = order.lineItems?.nodes || [];

        if (!email) continue;

        const hasMatchedItem = lineItems.some((item: any) => {
          const title = (item.title || "").toLowerCase();
          return title.includes("tunnel") || title.includes("cube");
        });

        if (hasMatchedItem) {
          const variantIds = lineItems
            .map((item: any) => item.variant?.id ? String(item.variant.id) : "")
            .filter(Boolean);

          const lineItemsMapped = lineItems.map((item: any) => ({
            variantId: item.variant?.id ? String(item.variant.id) : "",
            title: item.title?.toString(),
          }));

          const result = await grantPurchaseEntitlements(shopifyCustomerId, email, variantIds, lineItemsMapped);
          if (result.grantedNew) {
            syncedCount++;
          }
        }
      }

      return Response.json({ success: true, message: `Sync complete! Successfully imported/updated ${syncedCount} customers from Shopify.` });
    } catch (err: any) {
      console.error("Failed to sync Shopify orders:", err);
      return Response.json({ error: err.message || "Failed to sync Shopify orders" });
    }
  }

  return Response.json({ error: "Unknown action intent" });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const windowStr = url.searchParams.get("window") || "30d";

  let fromDate: Date | undefined;
  if (windowStr === "7d") fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (windowStr === "30d") fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const dateRange = { from: fromDate, to: new Date() };

  const { getDashboardMetrics } = await import("../services/metrics.server");

  let metrics;
  try {
    metrics = await getDashboardMetrics(dateRange);
  } catch (err) {
    console.error("[Dashboard] Metrics query failed (tables may not exist yet):", err);
    metrics = {
      core: {
        totalCustomers: 0, activeEntitlements: 0, totalQRRedemptions: 0,
        libraryViews: 0, assetDownloads: 0, upgradeClicks: 0,
        upgradePurchases: 0, dropNotifications: 0, dropDownloads: 0,
        totalChats: 0, uniqueChatSessions: 0, tunnelsClaimed: 0, cubesClaimed: 0,
        freeToPaidConversionRate: "0.0%", eventCounts: {}
      },
      funnel: { claimToLibrary: "N/A", libraryToUpgradeClick: "N/A", clickToPurchase: "N/A", dropToDownload: "N/A" },
      qr: [],
      upgrade: [],
      drop: [],
      amazon: {
        totalOrders: 0,
        claimedOrders: 0,
        totalClaims: 0,
        pendingClaimsCount: 0,
        approvedClaimsCount: 0,
        claims: [],
        orders: []
      }
    };
  }

  return { metrics, windowStr };
};

const navLinks = [
  { href: "/app/packs",          label: "Digital Packs",        emoji: "📦", desc: "Manage your content tiers" },
  { href: "/app/assets",         label: "Assets & Storage",     emoji: "🗂️", desc: "Upload & organise files" },
  { href: "/app/drops",          label: "Content Drops",        emoji: "🎁", desc: "Schedule future unlocks" },
  { href: "/app/variant-mapping",label: "Order Rules",          emoji: "🔗", desc: "Link products to packs" },
  { href: "/app/qr-campaigns",   label: "QR Claims",            emoji: "📱", desc: "Physical-to-digital bridge" },
  { href: "/app/customers",      label: "Customer Database",    emoji: "👥", desc: "View entitlements & history" },
];

const blueprint = [
  { n: "1", title: "Define Tiers", body: "Create Lite, Standard & Ultimate access levels." },
  { n: "2", title: "Map Variants", body: "Link Shopify products to packs for auto-grant." },
  { n: "3", title: "Drop Content", body: "Schedule exclusive drops to drive retention." },
  { n: "4", title: "Track Growth", body: "Monitor customers, entitlements & QR scans." },
];

export default function Index() {
  const { metrics, windowStr } = useLoaderData<typeof loader>();
  const actionData = useActionData() as { error?: string; success?: boolean; message?: string } | undefined;
  const submit = useSubmit();
  const { core, funnel, qr, upgrade, drop, amazon } = metrics;

  const handleApprove = (claimId: string) => {
    submit({ intent: "approve_claim", claimId }, { method: "POST" });
  };

  const handleReject = (claimId: string) => {
    submit({ intent: "reject_claim", claimId }, { method: "POST" });
  };

  const stats = [
    { label: "Total Customers",      value: core.totalCustomers,     color: "#10b981", bg: "rgba(16,185,129,0.12)",  emoji: "👥" },
    { label: "Active Entitlements",  value: core.activeEntitlements, color: "#6366f1", bg: "rgba(99,102,241,0.12)",  emoji: "✅" },
    { label: "QR Redemptions",       value: core.totalQRRedemptions, color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  emoji: "📱" },
    { label: "Library Views",        value: core.libraryViews,       color: "#8b5cf6", bg: "rgba(139,92,246,0.12)",  emoji: "👀" },
    { label: "Asset Downloads",      value: core.assetDownloads,     color: "#ec4899", bg: "rgba(236,72,153,0.12)",  emoji: "⬇️" },
    { label: "Upgrade Clicks",       value: core.upgradeClicks,      color: "#f28c28", bg: "rgba(242,140,40,0.12)",  emoji: "✨" },
    { label: "Upgrade Purchases",    value: core.upgradePurchases,   color: "#059669", bg: "rgba(5,150,105,0.12)",   emoji: "💳" },
    { label: "Drop DLs",             value: core.dropDownloads,      color: "#e11d48", bg: "rgba(225,29,72,0.12)",   emoji: "🎁" },
  ];

  return (
    <div style={{ padding: "0", fontFamily: "'Outfit','Inter',sans-serif", background: "#fafafa", minHeight: "100vh" }}>

      {actionData && (actionData.error || actionData.success) && (
        <div style={{ 
          padding: "1.25rem 2.5rem", 
          background: actionData.success ? "#ecfdf5" : "#fff1f0", 
          borderBottom: actionData.success ? "2px solid #34d399" : "2px solid #fca5a5",
          color: actionData.success ? "#065f46" : "#991b1b",
          fontSize: "1rem",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)"
        }}>
          <span style={{ fontSize: "1.25rem" }}>{actionData.success ? "✨" : "⚠️"}</span>
          <span>{actionData.success ? actionData.message : actionData.error}</span>
        </div>
      )}

      {/* ── HERO ──────────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, #2d1b0d 0%, #4a2e12 60%, #6b4019 100%)",
        padding: "2.5rem 2.5rem 3.5rem",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* decorative circles */}
        <div style={{ position:"absolute", top:"-60px", right:"-60px", width:"250px", height:"250px", borderRadius:"50%", background:"rgba(242,140,40,0.15)", pointerEvents:"none" }} />
        <div style={{ position:"absolute", bottom:"-80px", left:"30%", width:"180px", height:"180px", borderRadius:"50%", background:"rgba(242,140,40,0.08)", pointerEvents:"none" }} />

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"2rem", position:"relative" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:"0.75rem", marginBottom:"0.75rem" }}>
              <span style={{ background:"rgba(242,140,40,0.25)", color:"#f28c28", fontSize:"0.75rem", fontWeight:800, letterSpacing:"0.1em", padding:"0.35rem 0.85rem", borderRadius:"30px", textTransform:"uppercase" }}>Digital Vault</span>
            </div>
            <h1 style={{ margin:0, fontSize:"2.75rem", fontWeight:900, color:"#fff", lineHeight:1.1, letterSpacing:"-0.03em" }}>
              Welcome back,<br />
              <span style={{ background:"linear-gradient(90deg,#f28c28,#f5c842)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>MelCat</span> 🐾
            </h1>
            <p style={{ margin:"1rem 0 0", color:"rgba(255,255,255,0.65)", fontSize:"1.05rem", maxWidth:"420px", lineHeight:1.6 }}>
              Big Mel's premium digital vault — manage packs, drops, and your community all in one place.
            </p>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"1rem" }}>
            <div style={{ background: "#fff", padding: "0.25rem 0.5rem", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
              <select 
                value={windowStr} 
                onChange={(e) => window.location.search = `?window=${e.target.value}`}
                style={{ border: "none", background: "transparent", fontSize: "0.9rem", fontWeight: 600, color: "#1f2937", outline: "none", cursor: "pointer", padding: "0.25rem" }}
              >
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="all">All Time</option>
              </select>
            </div>
            <div style={{ flexShrink:0, width:"140px", height:"140px", borderRadius:"50%", overflow:"hidden", border:"4px solid rgba(242,140,40,0.6)", boxShadow:"0 0 40px rgba(242,140,40,0.4)" }}>
              <img src="/mascot.jpeg" alt="Big Mel" style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"center 15%" }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── STATS ──────────────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"1rem", padding:"1.5rem 2.5rem", background:"#fafafa" }}>
        {stats.map(s => (
          <div key={s.label} style={{
            background:"#fff",
            borderRadius:"20px",
            padding:"1.75rem",
            boxShadow:"0 2px 16px rgba(0,0,0,0.06)",
            border:`1px solid ${s.bg.replace("0.12","0.3")}`,
            position:"relative",
            overflow:"hidden",
          }}>
            <div style={{ position:"absolute", top:"-20px", right:"-20px", width:"90px", height:"90px", borderRadius:"50%", background:s.bg, pointerEvents:"none" }} />
            <div style={{ fontSize:"2rem", marginBottom:"0.75rem" }}>{s.emoji}</div>
            <div style={{ fontSize:"2.25rem", fontWeight:900, color:s.color, lineHeight:1, marginBottom:"0.4rem" }}>{s.value}</div>
            <div style={{ fontSize:"0.85rem", color:"#6b7280", fontWeight:600, letterSpacing:"0.02em" }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── FUNNELS ────────────────────────────────────────────── */}
      <div style={{ padding:"0 2.5rem 1.5rem", display: "flex", gap: "1rem" }}>
        <div style={{ flex: 1, background: "#1f2937", color: "#fff", padding: "1.25rem", borderRadius: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
           <span style={{ fontSize: "0.9rem", color: "#9ca3af" }}>QR Claim → Vault</span>
           <span style={{ fontSize: "1.25rem", fontWeight: 800, color: "#10b981" }}>{funnel.claimToLibrary}</span>
        </div>
        <div style={{ flex: 1, background: "#1f2937", color: "#fff", padding: "1.25rem", borderRadius: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
           <span style={{ fontSize: "0.9rem", color: "#9ca3af" }}>Vault → Upgrade Click</span>
           <span style={{ fontSize: "1.25rem", fontWeight: 800, color: "#f59e0b" }}>{funnel.libraryToUpgradeClick}</span>
        </div>
        <div style={{ flex: 1, background: "#1f2937", color: "#fff", padding: "1.25rem", borderRadius: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
           <span style={{ fontSize: "0.9rem", color: "#9ca3af" }}>Click → Purchase</span>
           <span style={{ fontSize: "1.25rem", fontWeight: 800, color: "#f28c28" }}>{funnel.clickToPurchase}</span>
        </div>
        <div style={{ flex: 1, background: "#1f2937", color: "#fff", padding: "1.25rem", borderRadius: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
           <span style={{ fontSize: "0.9rem", color: "#9ca3af" }}>Drop Notif → Download</span>
           <span style={{ fontSize: "1.25rem", fontWeight: 800, color: "#ec4899" }}>{funnel.dropToDownload}</span>
        </div>
      </div>

      {/* ── COMMAND CENTER + BLUEPRINT ─────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:"1.5rem", padding:"0 2.5rem 2.5rem" }}>

        {/* Command Center */}
        <div style={{ background:"#fff", borderRadius:"24px", padding:"2rem", boxShadow:"0 2px 16px rgba(0,0,0,0.06)" }}>
          <h2 style={{ margin:"0 0 1.5rem", fontSize:"1.25rem", fontWeight:800, color:"#1f2937" }}>
            Command Center
          </h2>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem" }}>
            {navLinks.map(link => (
              <Link key={link.href} url={link.href} removeUnderline>
                <div style={{
                  display:"flex",
                  alignItems:"center",
                  gap:"1rem",
                  padding:"1.1rem 1.25rem",
                  borderRadius:"14px",
                  background:"#fafafa",
                  border:"1px solid #e5e7eb",
                  transition:"all 0.15s",
                  cursor:"pointer",
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget;
                  el.style.background = "rgba(242,140,40,0.06)";
                  el.style.borderColor = "rgba(242,140,40,0.4)";
                  el.style.transform = "translateY(-2px)";
                  el.style.boxShadow = "0 6px 20px rgba(242,140,40,0.12)";
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget;
                  el.style.background = "#fafafa";
                  el.style.borderColor = "#e5e7eb";
                  el.style.transform = "translateY(0)";
                  el.style.boxShadow = "none";
                }}
                >
                  <span style={{ fontSize:"1.75rem", lineHeight:1 }}>{link.emoji}</span>
                  <div>
                    <div style={{ fontSize:"0.95rem", fontWeight:700, color:"#1f2937", marginBottom:"0.15rem" }}>{link.label}</div>
                    <div style={{ fontSize:"0.78rem", color:"#9ca3af" }}>{link.desc}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Blueprint */}
        <div style={{
          background:"linear-gradient(160deg,#2d1b0d 0%,#4a2e12 100%)",
          borderRadius:"24px",
          padding:"2rem",
          boxShadow:"0 2px 16px rgba(0,0,0,0.12)",
          position:"relative",
          overflow:"hidden",
        }}>
          <div style={{ position:"absolute", bottom:"-40px", right:"-40px", width:"160px", height:"160px", borderRadius:"50%", background:"rgba(242,140,40,0.1)", pointerEvents:"none" }} />
          <h2 style={{ margin:"0 0 1.5rem", fontSize:"1.25rem", fontWeight:800, color:"#fff" }}>
            MelCat Blueprint
          </h2>
          <div style={{ display:"flex", flexDirection:"column", gap:"1rem", position:"relative" }}>
            {blueprint.map(item => (
              <div key={item.n} style={{ display:"flex", gap:"1rem", alignItems:"flex-start" }}>
                <div style={{
                  flexShrink:0,
                  width:"32px", height:"32px",
                  borderRadius:"50%",
                  background:"linear-gradient(135deg,#f28c28,#f5c842)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:"0.8rem", fontWeight:900, color:"#2d1b0d",
                }}>
                  {item.n}
                </div>
                <div>
                  <div style={{ fontSize:"0.95rem", fontWeight:700, color:"#fff", marginBottom:"0.2rem" }}>{item.title}</div>
                  <div style={{ fontSize:"0.8rem", color:"rgba(255,255,255,0.55)", lineHeight:1.5 }}>{item.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── BIG MEL INTERACTIVE & SALES ANALYTICS ───────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:"1.5rem", padding:"0 2.5rem 2.5rem" }}>
        
        {/* Chat & Widget Interactions */}
        <div style={{ background:"#fff", borderRadius:"24px", padding:"2rem", boxShadow:"0 2px 16px rgba(0,0,0,0.06)", border:"1px solid #e5e7eb" }}>
          <h2 style={{ margin:"0 0 1.25rem", fontSize:"1.25rem", fontWeight:800, color:"#1f2937", display:"flex", alignItems:"center", gap:"0.5rem" }}>
            <span>💬</span> Big Mel Chat Activity
          </h2>
          <p style={{ margin:"0 0 1.5rem", fontSize:"0.9rem", color:"#6b7280" }}>
            Monitor how customers are interacting with the Big Mel storefront widget in real-time.
          </p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
            <div style={{ background:"#f9fafb", border:"1px solid #f3f4f6", padding:"1.5rem", borderRadius:"16px", textAlign:"center" }}>
              <div style={{ fontSize:"2.25rem", fontWeight:900, color:"#f28c28", marginBottom:"0.25rem" }}>{core.totalChats || 0}</div>
              <div style={{ fontSize:"0.85rem", fontWeight:700, color:"#4b5563" }}>Total Messages Sent</div>
              <div style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:"0.25rem" }}>AI-generated judgment replies</div>
            </div>
            <div style={{ background:"#f9fafb", border:"1px solid #f3f4f6", padding:"1.5rem", borderRadius:"16px", textAlign:"center" }}>
              <div style={{ fontSize:"2.25rem", fontWeight:900, color:"#8b5cf6", marginBottom:"0.25rem" }}>{core.uniqueChatSessions || 0}</div>
              <div style={{ fontSize:"0.85rem", fontWeight:700, color:"#4b5563" }}>Active Chat Sessions</div>
              <div style={{ fontSize:"0.75rem", color:"#9ca3af", marginTop:"0.25rem" }}>Unique visitor interactions</div>
            </div>
          </div>
        </div>

        {/* Product-Linked Access & Upgrades */}
        <div style={{ background:"linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", color:"#fff", borderRadius:"24px", padding:"2rem", boxShadow:"0 4px 20px rgba(15,23,42,0.15)", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", top:"-50px", right:"-50px", width:"150px", height:"150px", borderRadius:"50%", background:"rgba(242,140,40,0.15)", pointerEvents:"none" }} />
          <h2 style={{ margin:"0 0 1.25rem", fontSize:"1.25rem", fontWeight:800, color:"#fff", display:"flex", alignItems:"center", gap:"0.5rem" }}>
            <span>🛒</span> Product Access Rules
          </h2>
          <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid rgba(255,255,255,0.1)", paddingBottom:"0.75rem" }}>
              <span style={{ fontSize:"0.9rem", color:"#94a3b8" }}>🐈 Tunnels Claimed</span>
              <span style={{ fontSize:"1.15rem", fontWeight:800, color:"#f28c28" }}>{core.tunnelsClaimed || 0}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid rgba(255,255,255,0.1)", paddingBottom:"0.75rem" }}>
              <span style={{ fontSize:"0.9rem", color:"#94a3b8" }}>📦 Cubes Claimed</span>
              <span style={{ fontSize:"1.15rem", fontWeight:800, color:"#f28c28" }}>{core.cubesClaimed || 0}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:"0.25rem" }}>
              <span style={{ fontSize:"0.9rem", color:"#94a3b8" }}>⚡ Upgrade Conv. Rate</span>
              <span style={{ background:"#10b981", color:"#fff", fontSize:"0.85rem", fontWeight:800, padding:"0.25rem 0.6rem", borderRadius:"30px" }}>
                {core.freeToPaidConversionRate || "0.0%"}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* ── AMAZON REDEMPTIONS & CLAIMS ────────────────────────── */}
      <div style={{ padding:"0 2.5rem 2.5rem" }}>
        <div style={{ background:"#fff", borderRadius:"24px", padding:"2rem", boxShadow:"0 2px 16px rgba(0,0,0,0.06)", border:"1px solid #e5e7eb" }}>
          
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"2rem", borderBottom:"1px solid #f3f4f6", paddingBottom:"1.25rem", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin:0, fontSize:"1.4rem", fontWeight:800, color:"#1f2937", display:"flex", alignItems:"center", gap:"0.6rem" }}>
                <span>📦</span> Amazon Channels & Claims
              </h2>
              <p style={{ margin:"0.35rem 0 0", fontSize:"0.88rem", color:"#6b7280" }}>
                Manage physical package inserts, pre-authorized Amazon Order IDs, and manual customer claim submissions.
              </p>
            </div>
            
            {/* Amazon Stats pills */}
            <div style={{ display:"flex", gap:"0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="intent" value="sync_shopify_orders" />
                <button 
                  type="submit" 
                  style={{ background: "#4f46e5", color: "#fff", border: "none", padding: "0.4rem 0.85rem", borderRadius: "30px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "0.35rem" }}
                >
                  <span>🔄</span> Sync Shopify Orders
                </button>
              </Form>
              <div style={{ background:"#f3f4f6", padding:"0.4rem 0.85rem", borderRadius:"30px", fontSize:"0.8rem", fontWeight:700, color:"#4b5563" }}>
                Pre-authorized: <span style={{ color:"#f28c28" }}>{amazon.totalOrders}</span> ({amazon.claimedOrders} claimed)
              </div>
              <div style={{ background:"#fffbeb", padding:"0.4rem 0.85rem", borderRadius:"30px", fontSize:"0.8rem", fontWeight:700, color:"#b45309" }}>
                Pending Claims: <span style={{ color:"#d97706" }}>{amazon.pendingClaimsCount}</span>
              </div>
              <div style={{ background:"#ecfdf5", padding:"0.4rem 0.85rem", borderRadius:"30px", fontSize:"0.8rem", fontWeight:700, color:"#047857" }}>
                Approved Claims: <span style={{ color:"#10b981" }}>{amazon.approvedClaimsCount}</span>
              </div>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:"2rem" }}>
            
            {/* Claims Table */}
            <div>
              <Text variant="headingMd" as="h3">Submitted Amazon Claims</Text>
              <div style={{ height: "10px" }}></div>
              {amazon.claims.length === 0 ? (
                <div style={{ textAlign:"center", padding:"3rem 1rem", background:"#f9fafb", borderRadius:"16px", border:"1px dashed #e5e7eb" }}>
                  <span style={{ fontSize:"2rem" }}>🔍</span>
                  <p style={{ margin:"0.5rem 0 0", fontSize:"0.9rem", color:"#9ca3af", fontWeight:600 }}>No claims submitted yet.</p>
                </div>
              ) : (
                <div style={{ border:"1px solid #f3f4f6", borderRadius:"16px", overflow:"hidden" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", textAlign:"left", fontSize:"0.875rem" }}>
                    <thead>
                      <tr style={{ background:"#f9fafb", borderBottom:"1px solid #f3f4f6" }}>
                        <th style={{ padding:"0.75rem 1rem", fontWeight:700, color:"#4b5563" }}>Order ID</th>
                        <th style={{ padding:"0.75rem 1rem", fontWeight:700, color:"#4b5563" }}>Email</th>
                        <th style={{ padding:"0.75rem 1rem", fontWeight:700, color:"#4b5563" }}>Campaign</th>
                        <th style={{ padding:"0.75rem 1rem", fontWeight:700, color:"#4b5563" }}>Status</th>
                        <th style={{ padding:"0.75rem 1rem", fontWeight:700, color:"#4b5563" }}>Date</th>
                        <th style={{ padding:"0.75rem 1rem", fontWeight:700, color:"#4b5563", textAlign:"right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {amazon.claims.map((claim: any) => (
                        <tr key={claim.id} style={{ borderBottom:"1px solid #f3f4f6" }}>
                          <td style={{ padding:"0.75rem 1rem", fontWeight:600 }}>{claim.orderId}</td>
                          <td style={{ padding:"0.75rem 1rem" }}>{claim.email}</td>
                          <td style={{ padding:"0.75rem 1rem" }}>
                            {claim.campaignHash ? <Badge tone="info">{claim.campaignHash}</Badge> : <span style={{ color:"#9ca3af" }}>None</span>}
                          </td>
                          <td style={{ padding:"0.75rem 1rem" }}>
                            <Badge tone={claim.status === "APPROVED" ? "success" : claim.status === "PENDING" ? "warning" : "critical"}>
                              {claim.status}
                            </Badge>
                          </td>
                          <td style={{ padding:"0.75rem 1rem", color:"#6b7280" }}>
                            {new Date(claim.claimedAt).toLocaleDateString()}
                          </td>
                          <td style={{ padding:"0.75rem 1rem", textAlign:"right" }}>
                            {claim.status === "PENDING" && (
                              <div style={{ display:"inline-flex", gap:"0.5rem", justifyContent:"flex-end" }}>
                                <button 
                                  onClick={() => handleApprove(claim.id)}
                                  style={{ background:"#10b981", color:"#fff", border:"none", padding:"0.3rem 0.75rem", borderRadius:"6px", fontSize:"0.75rem", fontWeight:700, cursor:"pointer" }}
                                >
                                  Approve
                                </button>
                                <button 
                                  onClick={() => handleReject(claim.id)}
                                  style={{ background:"#ef4444", color:"#fff", border:"none", padding:"0.3rem 0.75rem", borderRadius:"6px", fontSize:"0.75rem", fontWeight:700, cursor:"pointer" }}
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Bulk Seeder Form */}
            <div style={{ background:"#f9fafb", borderRadius:"20px", padding:"1.5rem", border:"1px solid #f3f4f6" }}>
              <h3 style={{ margin:"0 0 1rem", fontSize:"1rem", fontWeight:700, color:"#1f2937" }}>
                Pre-Authorize Amazon Orders
              </h3>
              <p style={{ margin:"0 0 1.25rem", fontSize:"0.8rem", color:"#6b7280", lineHeight:1.4 }}>
                Authorise specific Amazon Order IDs so that when users submit them on the claim page, they are approved automatically.
              </p>
              
              <Form method="post">
                <input type="hidden" name="intent" value="seed_amazon_orders" />
                <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
                  <div>
                    <textarea 
                      name="ordersList" 
                      placeholder="e.g.&#10;123-4567890-1234567&#10;987-6543210-9876543" 
                      rows={5}
                      style={{ width:"100%", padding:"0.6rem 0.8rem", borderRadius:"10px", border:"1px solid #d1d5db", outline:"none", fontSize:"0.85rem", fontFamily:"monospace", boxSizing:"border-box" }}
                      required
                    />
                  </div>
                  <div>
                    <select 
                      name="sku" 
                      style={{ width:"100%", padding:"0.5rem", borderRadius:"8px", border:"1px solid #d1d5db", background:"#fff", outline:"none", fontSize:"0.85rem", fontWeight:600 }}
                    >
                      <option value="cat-tunnel">Cat Tunnel (Lite Pack)</option>
                      <option value="cat-cube">Cat Cube (Lite Pack)</option>
                    </select>
                  </div>
                  <button 
                    type="submit" 
                    style={{ background:"#f28c28", color:"#fff", border:"none", padding:"0.6rem", borderRadius:"10px", fontSize:"0.85rem", fontWeight:700, cursor:"pointer", display:"flex", justifyContent:"center", alignItems:"center", gap:"0.5rem" }}
                  >
                    <span>⚡</span> Authorise Orders
                  </button>
                </div>
              </Form>
            </div>

          </div>

        </div>
      </div>

      {/* ── METRICS TABLES ─────────────────────────────────────── */}
      <div style={{ padding:"0 2.5rem 2.5rem", display:"grid", gridTemplateColumns:"1fr", gap:"1.5rem" }}>
        
        {/* QR Campaigns Table */}
        <Card padding="0">
          <Box padding="400">
            <Text variant="headingMd" as="h2">QR Campaign Performance</Text>
          </Box>
          <IndexTable
            resourceName={{ singular: 'campaign', plural: 'campaigns' }}
            itemCount={qr.length}
            headings={[
              { title: 'Hash' },
              { title: 'Pack' },
              { title: 'Status' },
              { title: 'Redemptions' },
              { title: 'Unique Users' },
              { title: 'Claims' },
            ]}
            selectable={false}
          >
            {qr.map(c => (
              <IndexTable.Row id={c.campaignHash} key={c.campaignHash} position={0}>
                <IndexTable.Cell><Text variant="bodyMd" fontWeight="bold" as="span">{c.campaignHash}</Text></IndexTable.Cell>
                <IndexTable.Cell>{c.packName}</IndexTable.Cell>
                <IndexTable.Cell><Badge tone={c.isActive ? "success" : "critical"}>{c.isActive ? "Active" : "Inactive"}</Badge></IndexTable.Cell>
                <IndexTable.Cell>{c.redemptions}</IndexTable.Cell>
                <IndexTable.Cell>{c.uniqueCustomers}</IndexTable.Cell>
                <IndexTable.Cell>{c.claimCompleted}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>

        {/* Upgrade Performance Table */}
        <Card padding="0">
          <Box padding="400">
            <Text variant="headingMd" as="h2">Upgrade Performance</Text>
          </Box>
          <IndexTable
            resourceName={{ singular: 'tier', plural: 'tiers' }}
            itemCount={upgrade.length}
            headings={[
              { title: 'Target Tier' },
              { title: 'Clicks' },
              { title: 'Purchases' },
              { title: 'Conversion' },
            ]}
            selectable={false}
          >
            {upgrade.map(u => (
              <IndexTable.Row id={u.tier} key={u.tier} position={0}>
                <IndexTable.Cell><Text variant="bodyMd" fontWeight="bold" as="span">{u.tier}</Text></IndexTable.Cell>
                <IndexTable.Cell>{u.clicks}</IndexTable.Cell>
                <IndexTable.Cell>{u.purchases}</IndexTable.Cell>
                <IndexTable.Cell><Badge tone="success">{u.conversion}</Badge></IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>

        {/* Drops Performance Table */}
        <Card padding="0">
          <Box padding="400">
            <Text variant="headingMd" as="h2">Drop Performance</Text>
          </Box>
          <IndexTable
            resourceName={{ singular: 'drop', plural: 'drops' }}
            itemCount={drop.length}
            headings={[
              { title: 'Drop Title' },
              { title: 'Required Tier' },
              { title: 'Notifs Sent' },
              { title: 'Notifs Failed' },
              { title: 'Downloads' },
              { title: 'Reactivation %' },
            ]}
            selectable={false}
          >
            {drop.map(d => (
              <IndexTable.Row id={d.dropTitle} key={d.dropTitle} position={0}>
                <IndexTable.Cell><Text variant="bodyMd" fontWeight="bold" as="span">{d.dropTitle}</Text></IndexTable.Cell>
                <IndexTable.Cell>Level {d.requiredTier}</IndexTable.Cell>
                <IndexTable.Cell>{d.notificationsSent}</IndexTable.Cell>
                <IndexTable.Cell>{d.notificationsFailed > 0 ? <Badge tone="critical">{d.notificationsFailed}</Badge> : 0}</IndexTable.Cell>
                <IndexTable.Cell>{d.dropDownloaded}</IndexTable.Cell>
                <IndexTable.Cell><Badge tone="info">{d.reactivationRate}</Badge></IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        </Card>

      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
