import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getCustomerSession } from "../services/session.server";
import { getCustomerLibrary } from "../services/entitlement.server";
import { GamificationPanel } from "../components/GamificationPanel";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const appUrl = process.env.SHOPIFY_APP_URL || "https://snarky-mel-cat-34130528345.northamerica-northeast2.run.app";

  let customerId: string | undefined = undefined;

  // 1. Try to authenticate via Shopify App Proxy signature first
  try {
    const { session } = await authenticate.public.appProxy(request);
    // Signature is valid!
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

  if (!customerId) {
    return {
      authenticated: false,
      customer: null,
      packs: [],
      drops: [],
      maxTier: 0,
      token: "",
      appUrl,
    };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    return { authenticated: false, customer: null, packs: [], drops: [], maxTier: 0, token: "", appUrl };
  }

  const packs = await getCustomerLibrary(customerId);

  // Calculate highest tier
  const maxTier = packs.reduce((max, pack) => Math.max(max, pack.tier.level), 0);

  // Fetch unlocked drops based on maxTier and releaseDate
  const drops = await prisma.drop.findMany({
    where: {
      isActive: true,
      requiredTierLevel: { lte: maxTier },
      releaseDate: { lte: new Date() }
    },
    include: {
      dropAssets: {
        include: { digitalAsset: true }
      }
    }
  });

  const { FEATURES } = await import("../config/features.server");
  const { safelyTrackCustomerEvent } = await import("../services/customerEvent.server");

  await safelyTrackCustomerEvent({
    customerId,
    eventType: "library_viewed",
    metadata: { maxTier, packCount: packs.length, dropCount: drops.length },
    source: "library",
    sessionId: token || undefined
  });

  for (const drop of drops) {
    await safelyTrackCustomerEvent({
      customerId,
      eventType: "drop_unlocked",
      metadata: { dropId: drop.id },
      source: "library",
      sessionId: token || undefined
    });
  }

  return { 
    authenticated: true, 
    customer, 
    packs, 
    drops, 
    maxTier, 
    features: FEATURES, 
    token: token || "", 
    appUrl 
  };
}

export default function LibraryPage() {
  const { authenticated, customer, packs, drops, maxTier, features, token, appUrl } = useLoaderData<typeof loader>();

  if (!authenticated) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={{ margin: '0 auto 1.5rem', width: '110px', height: '110px', borderRadius: '50%', overflow: 'hidden', border: '4px solid #f28c28', boxShadow: '0 8px 24px rgba(242, 140, 40, 0.25)' }}>
              <img src={`${appUrl}/mascot.jpeg`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="MelCat Mascot" />
            </div>
            <h1 style={styles.title}>🔒 MelCat Vault Locked</h1>
            <p style={styles.text}>
              Big Mel is waiting! You need a magic link to access your digital treasures.
            </p>
            <a href="/apps/snarky/claim" style={styles.link}>
              Enter the Vault →
            </a>
          </div>
        </div>

        {/* Client-side session restorer script */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            const token = localStorage.getItem("melcat_vault_token");
            if (token && !window.location.search.includes("token=")) {
              const url = new URL(window.location.href);
              url.searchParams.set("token", token);
              window.location.href = url.toString();
            }
          })();
        ` }} />
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
            <a href="/apps/snarky/logout" style={{ color: '#e37322', textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem', background: 'rgba(242,140,40,0.1)', padding: '0.4rem 1rem', borderRadius: '30px', transition: 'all 0.2s' }}>Sign out ➔</a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginBottom: '1rem' }}>
             <div style={{ width: '70px', height: '70px', borderRadius: '50%', overflow: 'hidden', border: '3px solid #f28c28', boxShadow: '0 4px 15px rgba(242,140,40,0.2)' }}>
                <img src={`${appUrl}/mascot.jpeg`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="MelCat Mascot" />
             </div>
             <h1 style={styles.title}>The MelCat Vault</h1>
          </div>
          <p style={styles.subtitle}>
            Welcome back, <strong>{customer?.email}</strong>. You’ve unlocked <strong>Level {maxTier}</strong> perks!
          </p>
        </div>

        {/* UPGRADE BANNER */}
        {maxTier > 0 && maxTier < 4 && (
          <div style={styles.upgradeBanner}>
            <div style={styles.upgradeContent}>
              <span style={styles.upgradeBadge}>UPGRADE AVAILABLE</span>
              <h2 style={styles.upgradeTitle}>Unlock the Ultimate Experience</h2>
              <p style={styles.upgradeText}>
                You're currently on Level {maxTier}. Upgrade to Ultimate to unlock exclusive new drops, bonus animations, and a lifetime pass to future content!
              </p>
            </div>
            <div style={styles.upgradeBtnContainer}>
              {maxTier < 2 && (
                <a href="/apps/snarky/upgrade?tier=2" style={{...styles.upgradeBtn, background: '#f28c28', color: '#fff'}}>
                  Standard Upgrade
                </a>
              )}
              {maxTier < 3 && (
                <a href="/apps/snarky/upgrade?tier=3" style={{...styles.upgradeBtn, background: '#e94560', color: '#fff'}}>
                  Deluxe Upgrade
                </a>
              )}
              {maxTier < 4 && (
                <a href="/apps/snarky/upgrade?tier=4" style={styles.upgradeBtn}>
                  Ultimate Upgrade →
                </a>
              )}
            </div>
          </div>
        )}

        {packs.length === 0 && drops.length === 0 ? (
          <div style={styles.card}>
            <p style={styles.text}>
              You don't have any digital packs yet. Purchase a product or scan a
              QR code to unlock content!
            </p>
          </div>
        ) : (
          <div style={styles.grid}>
            {/* RENDER PACKS */}
            {packs.map((pack: any) => (
              <div key={pack.id} style={styles.packCard}>
                <div style={styles.packHeader}>
                  <span style={styles.tierBadge}>{pack.tier.name}</span>
                </div>
                <h3 style={styles.packName}>{pack.name}</h3>
                <p style={styles.assetCount}>
                  📦 {pack.packAssets.length} digital asset{pack.packAssets.length !== 1 ? "s" : ""}
                </p>
                {pack.packAssets.length > 0 && (
                  <div style={styles.assetList}>
                    {pack.packAssets.map((pa: any) => (
                      <a href={`/apps/snarky/api/download?id=${pa.digitalAsset.id}`} key={pa.digitalAsset.id} style={styles.assetItemLink}>
                        <div style={styles.assetItem} onMouseEnter={(e) => { e.currentTarget.style.background = '#fbe8cc'; }} onMouseLeave={(e) => { e.currentTarget.style.background = '#fdf8f4'; }}>
                          {pa.digitalAsset.thumbnailUrl ? (
                            <img src={pa.digitalAsset.thumbnailUrl} style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} alt={pa.digitalAsset.title} />
                          ) : (
                            <span style={styles.assetType}>
                              {pa.digitalAsset.type === "MP4" ? "🎬" : pa.digitalAsset.type === "PNG" ? "🖼" : pa.digitalAsset.type === "PDF" ? "📄" : pa.digitalAsset.type === "GIF" ? "🎞" : "📁"} {pa.digitalAsset.type}
                            </span>
                          )}
                          <span style={styles.assetTitle}>
                            {pa.digitalAsset.title}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* RENDER TEMPORAL DROPS */}
            {drops.map((drop: any) => (
              <div key={drop.id} style={{...styles.packCard, borderColor: 'rgba(233, 69, 96, 0.4)', background: '#fff9f9'}}>
                <div style={styles.packHeader}>
                  <span style={{...styles.tierBadge, background: 'rgba(233, 69, 96, 0.1)', color: '#e94560'}}>TEMPORAL DROP</span>
                </div>
                <h3 style={styles.packName}>{drop.title}</h3>
                <p style={styles.assetCount}>
                  🎁 {drop.dropAssets.length} digital asset{drop.dropAssets.length !== 1 ? "s" : ""}
                </p>
                {drop.dropAssets.length > 0 && (
                  <div style={styles.assetList}>
                    {drop.dropAssets.map((da: any) => (
                      <a href={`/apps/snarky/api/download?id=${da.digitalAsset.id}`} key={da.digitalAsset.id} style={styles.assetItemLink}>
                        <div style={styles.assetItem} onMouseEnter={(e) => { e.currentTarget.style.background = '#ffd8df'; }} onMouseLeave={(e) => { e.currentTarget.style.background = '#fdf8f4'; }}>
                          {da.digitalAsset.thumbnailUrl ? (
                            <img src={da.digitalAsset.thumbnailUrl} style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} alt={da.digitalAsset.title} />
                          ) : (
                            <span style={{...styles.assetType, background: '#e94560'}}>
                              {da.digitalAsset.type === "MP4" ? "🎬" : da.digitalAsset.type === "PNG" ? "🖼" : da.digitalAsset.type === "PDF" ? "📄" : da.digitalAsset.type === "GIF" ? "🎞" : "📁"} {da.digitalAsset.type}
                            </span>
                          )}
                          <span style={styles.assetTitle}>
                            {da.digitalAsset.title}
                          </span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* AI GAME SKELETON (PREVIEW) */}
        <div style={styles.gameCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🐾</span>
              <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#2d1b0d', fontWeight: 800 }}>MelCat's Corner</h3>
            </div>
            <div style={{ padding: '0.35rem 0.85rem', background: 'rgba(138, 43, 226, 0.12)', color: '#8a2be2', borderRadius: '100px', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.5px' }}>
              BETA PREVIEW
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem', alignItems: 'center' }}>
            {/* Avatar & Level */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '130px', height: '130px', borderRadius: '50%', overflow: 'hidden', border: '4px solid #f28c28', boxShadow: '0 8px 24px rgba(242, 140, 40, 0.25)', position: 'relative', background: '#fff9f0' }}>
                <img src={`${appUrl}/melcat-ai-preview.png`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="MelCat Companion" />
              </div>
              <div style={{ background: '#2d1b0d', color: '#fff', padding: '0.25rem 1.25rem', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 900, marginTop: '-15px', zIndex: 10, boxShadow: '0 4px 10px rgba(0,0,0,0.15)' }}>
                LVL 1
              </div>
              <span style={{ fontSize: '0.85rem', color: '#6b5c4f', fontWeight: 700, marginTop: '5px' }}>0 / 100 XP</span>
            </div>

            {/* Stats & Meters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.35rem', fontWeight: 700, color: '#2d1b0d' }}>
                  <span>🐟 Hunger</span>
                  <span style={{ color: '#e94560', fontWeight: 800 }}>Starving!</span>
                </div>
                <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
                  <div style={{ width: '15%', height: '100%', background: '#e94560', borderRadius: '5px' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.35rem', fontWeight: 700, color: '#2d1b0d' }}>
                  <span>🎾 Happiness</span>
                  <span style={{ color: '#f28c28', fontWeight: 800 }}>Bored</span>
                </div>
                <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
                  <div style={{ width: '40%', height: '100%', background: '#f28c28', borderRadius: '5px' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.35rem', fontWeight: 700, color: '#2d1b0d' }}>
                  <span>💅 Sass Level</span>
                  <span style={{ color: '#8a2be2', fontWeight: 800 }}>Maximum</span>
                </div>
                <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
                  <div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg, #f28c28, #8a2be2)', borderRadius: '5px' }} />
                </div>
              </div>
            </div>
          </div>

          <div style={styles.quoteBubble}>
            "I'm not saying I'm hungry, but if you don't feed me a treat soon, your internet cables are looking awfully chewable."
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button disabled style={styles.disabledBtn}>
              <span style={{ fontSize: '1.25rem' }}>🐟</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>Feed Treat (0)</span>
            </button>
            <button disabled style={styles.disabledBtn}>
              <span style={{ fontSize: '1.25rem' }}>🎾</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>Play Minigame</span>
            </button>
            <button disabled style={styles.disabledBtn}>
              <span style={{ fontSize: '1.25rem' }}>💬</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>Chat AI</span>
            </button>
          </div>
        </div>

        {/* ONBOARDING INSTRUCTIONS */}
        {(packs.length > 0 || drops.length > 0) && (
          <div style={styles.instructionsCard}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.3rem', color: '#2d1b0d', fontWeight: 800 }}>💡 How to use your content</h3>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#6b5c4f', lineHeight: 1.8, fontSize: '0.95rem' }}>
              <li><strong>GIFs:</strong> Open on your phone, hold-press, Save to Photos / Tenor.</li>
              <li><strong>PNGs:</strong> Download and use as stickers in iMessage, WhatsApp, or Canva.</li>
              <li><strong>MP4s:</strong> Save and post as Reels/Stories, or use in your own content.</li>
              <li><strong>PDFs/Printables:</strong> Download and print at home or at a copy shop.</li>
            </ul>
          </div>
        )}
        
        {authenticated && features && <GamificationPanel isEnabled={features.gamification} />}
      </div>

      {/* Client-side token storer script */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const token = "${token}";
          if (token) {
            localStorage.setItem("melcat_vault_token", token);
          }
        })();
      ` }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #fffaf0 0%, #fdf2df 50%, #fbe8cc 100%)",
    padding: "3rem 2rem",
    fontFamily: "'Outfit', 'Segoe UI', system-ui, sans-serif",
  },
  container: {
    maxWidth: "900px",
    margin: "0 auto",
  },
  header: {
    textAlign: "center" as const,
    marginBottom: "3rem",
  },
  title: {
    fontSize: "2.75rem",
    fontWeight: 800,
    background: "linear-gradient(90deg, #f28c28, #e37322)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: 0,
    letterSpacing: "-0.03em",
  },
  subtitle: {
    fontSize: "1.1rem",
    color: "#4a3728",
    margin: "12px 0 0 0",
  },
  card: {
    background: "rgba(255, 255, 255, 0.9)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(242, 140, 40, 0.2)",
    borderRadius: "28px",
    padding: "3.5rem 2rem",
    textAlign: "center" as const,
    boxShadow: "0 20px 50px rgba(242, 140, 40, 0.12)",
    maxWidth: "480px",
    margin: "2rem auto",
  },
  text: {
    color: "#2d1b0d",
    fontSize: "1.1rem",
    lineHeight: 1.6,
    marginBottom: "2rem",
  },
  link: {
    display: "inline-block",
    padding: "1rem 2.5rem",
    borderRadius: "16px",
    background: "linear-gradient(135deg, #f28c28, #e37322)",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 800,
    fontSize: "1.05rem",
    boxShadow: "0 8px 24px rgba(242, 140, 40, 0.35)",
    transition: "transform 0.2s",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
    gap: "2rem",
  },
  packCard: {
    background: "#fff",
    border: "1px solid rgba(242, 140, 40, 0.15)",
    borderRadius: "24px",
    padding: "2rem",
    boxShadow: "0 12px 30px rgba(45, 27, 13, 0.04)",
  },
  packHeader: {
    display: "flex",
    justifyContent: "space-between" as const,
    alignItems: "center",
    marginBottom: "1rem",
  },
  tierBadge: {
    background: "rgba(242, 140, 40, 0.1)",
    color: "#e37322",
    padding: "0.4rem 1.1rem",
    borderRadius: "30px",
    fontSize: "0.75rem",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  packName: {
    color: "#2d1b0d",
    fontSize: "1.6rem",
    fontWeight: 800,
    margin: "0 0 0.5rem 0",
    letterSpacing: "-0.01em",
  },
  assetCount: {
    color: "#6b5c4f",
    fontSize: "0.95rem",
    margin: "0 0 1.5rem 0",
  },
  assetList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
  },
  assetItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.85rem 1.1rem",
    background: "#fdf8f4",
    borderRadius: "14px",
    border: "1px solid rgba(242, 140, 40, 0.05)",
    transition: "all 0.2s ease-in-out",
  },
  assetType: {
    background: "#f28c28",
    color: "#fff",
    padding: "0.25rem 0.75rem",
    borderRadius: "8px",
    fontSize: "0.7rem",
    fontWeight: 800,
    textTransform: "uppercase" as const,
  },
  assetTitle: {
    color: "#2d1b0d",
    fontSize: "0.95rem",
    fontWeight: 700,
  },
  assetItemLink: {
    textDecoration: "none",
    color: "inherit",
    display: "block",
  },
  upgradeBanner: {
    background: "linear-gradient(135deg, #f28c28 0%, #e37322 100%)",
    borderRadius: "26px",
    padding: "2.25rem 3rem",
    marginBottom: "3rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: "2rem",
    boxShadow: "0 15px 35px rgba(227, 115, 34, 0.25)",
  },
  upgradeContent: {
    flex: "1 1 350px",
  },
  upgradeBadge: {
    display: "inline-block",
    background: "#fff",
    color: "#e37322",
    fontSize: "0.7rem",
    fontWeight: 900,
    padding: "0.4rem 0.9rem",
    borderRadius: "8px",
    marginBottom: "1rem",
    letterSpacing: "0.05em",
  },
  upgradeTitle: {
    color: "#fff",
    fontSize: "1.85rem",
    margin: "0 0 0.5rem 0",
    fontWeight: 800,
    letterSpacing: "-0.02em",
  },
  upgradeText: {
    color: "rgba(255, 255, 255, 0.95)",
    margin: 0,
    fontSize: "1rem",
    lineHeight: 1.6,
  },
  upgradeBtn: {
    background: "#2d1b0d",
    color: "#fff",
    textDecoration: "none",
    padding: "1.1rem 2.25rem",
    borderRadius: "16px",
    fontWeight: 800,
    fontSize: "1.05rem",
    transition: "transform 0.2s",
    whiteSpace: "nowrap" as const,
    boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
  },
  upgradeBtnContainer: {
    display: "flex",
    gap: "1rem",
    flexWrap: "wrap" as const,
  },
  gameCard: {
    marginTop: '3rem',
    padding: '2.5rem',
    background: '#fff',
    borderRadius: '28px',
    border: '1px solid rgba(242, 140, 40, 0.2)',
    boxShadow: '0 12px 40px rgba(45, 27, 13, 0.05)',
  },
  quoteBubble: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    padding: '1.25rem 1.5rem',
    marginTop: '2rem',
    fontStyle: 'italic',
    color: '#475569',
    fontSize: '0.95rem',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  disabledBtn: {
    flex: 1,
    padding: '1rem',
    background: '#f1f5f9',
    color: '#94a3b8',
    border: 'none',
    borderRadius: '16px',
    cursor: 'not-allowed',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.35rem',
  },
  instructionsCard: {
    marginTop: '3rem',
    padding: '2.25rem',
    background: 'rgba(255, 255, 255, 0.65)',
    borderRadius: '24px',
    border: '1px solid rgba(242, 140, 40, 0.12)',
  },
};
