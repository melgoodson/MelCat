import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { Link } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [totalPacks, totalCustomers, totalEntitlements, totalCampaigns] =
    await Promise.all([
      prisma.pack.count({ where: { isActive: true } }),
      prisma.customer.count(),
      prisma.entitlement.count({ where: { revoked: false } }),
      prisma.qRCampaign.count({ where: { isActive: true } }),
    ]);
  return { totalPacks, totalCustomers, totalEntitlements, totalCampaigns };
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
  const { totalPacks, totalCustomers, totalEntitlements, totalCampaigns } =
    useLoaderData<typeof loader>();

  const stats = [
    { label: "Digital Packs",        value: totalPacks,         color: "#f28c28", bg: "rgba(242,140,40,0.12)",  emoji: "📦" },
    { label: "Total Customers",      value: totalCustomers,     color: "#10b981", bg: "rgba(16,185,129,0.12)",  emoji: "👥" },
    { label: "Active Entitlements",  value: totalEntitlements,  color: "#6366f1", bg: "rgba(99,102,241,0.12)",  emoji: "✅" },
    { label: "QR Campaigns",         value: totalCampaigns,     color: "#f59e0b", bg: "rgba(245,158,11,0.12)",  emoji: "📱" },
  ];

  return (
    <div style={{ padding: "0", fontFamily: "'Outfit','Inter',sans-serif", background: "#fafafa", minHeight: "100vh" }}>

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
          <div style={{ flexShrink:0, width:"140px", height:"140px", borderRadius:"50%", overflow:"hidden", border:"4px solid rgba(242,140,40,0.6)", boxShadow:"0 0 40px rgba(242,140,40,0.4)" }}>
            <img src="/mascot.jpeg" alt="Big Mel" style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"center 15%" }} />
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
            <div style={{ fontSize:"3rem", fontWeight:900, color:s.color, lineHeight:1, marginBottom:"0.4rem" }}>{s.value}</div>
            <div style={{ fontSize:"0.85rem", color:"#6b7280", fontWeight:600, letterSpacing:"0.02em" }}>{s.label}</div>
          </div>
        ))}
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
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
