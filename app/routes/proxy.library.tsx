import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getCustomerSession } from "../services/session.server";
import { getCustomerLibrary } from "../services/entitlement.server";
import { GamificationPanel } from "../components/GamificationPanel";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getCustomerSession(request);
  const customerId = session.get("customerId") as string | undefined;

  if (!customerId) {
    return {
      authenticated: false,
      customer: null,
      packs: [],
      drops: [],
      maxTier: 0,
    };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    return { authenticated: false, customer: null, packs: [], drops: [], maxTier: 0 };
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
    sessionId: session.get("sessionToken")
  });

  for (const drop of drops) {
    await safelyTrackCustomerEvent({
      customerId,
      eventType: "drop_unlocked",
      metadata: { dropId: drop.id },
      source: "library",
      sessionId: session.get("sessionToken")
    });
  }

  return { authenticated: true, customer, packs, drops, maxTier, features: FEATURES };
}

export default function LibraryPage() {
  const { authenticated, customer, packs, drops, maxTier } = useLoaderData<typeof loader>();

  if (!authenticated) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={{ margin: '0 auto 1.5rem', width: '100px', height: '100px', borderRadius: '50%', overflow: 'hidden', border: '3px solid #f28c28' }}>
              <img src="/apps/snarky/mascot.jpeg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <h1 style={styles.title}>🔒 MelCat Vault Locked</h1>
            <p style={styles.text}>
              Big Mel is waiting! You need to log in to access your digital treasures.
            </p>
            <a href="/apps/snarky/claim" style={styles.link}>
              Enter the Vault →
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <a href="/apps/snarky/logout" style={{ color: '#e37322', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem' }}>Sign out</a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginBottom: '1rem' }}>
             <div style={{ width: '60px', height: '60px', borderRadius: '50%', overflow: 'hidden', border: '2px solid #f28c28' }}>
                <img src="/apps/snarky/mascot.jpeg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
             </div>
             <h1 style={styles.title}>The MelCat Vault</h1>
          </div>
          <p style={styles.subtitle}>
            Welcome back, <strong>{customer?.email}</strong>. You’ve unlocked <strong>Level {maxTier}</strong> perks!
          </p>
        </div>

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
                  {pack.packAssets.length} digital asset{pack.packAssets.length !== 1 ? "s" : ""}
                </p>
                {pack.packAssets.length > 0 && (
                  <div style={styles.assetList}>
                    {pack.packAssets.map((pa: any) => (
                      <a href={`/apps/snarky/api/download?id=${pa.digitalAsset.id}`} key={pa.digitalAsset.id} style={styles.assetItemLink}>
                        <div style={styles.assetItem}>
                          {pa.digitalAsset.thumbnailUrl ? (
                            <img src={pa.digitalAsset.thumbnailUrl} style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} />
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
              <div key={drop.id} style={{...styles.packCard, borderColor: 'rgba(233, 69, 96, 0.5)'}}>
                <div style={styles.packHeader}>
                  <span style={{...styles.tierBadge, background: 'rgba(255,255,255,0.1)', color: '#e94560'}}>TEMPORAL DROP</span>
                </div>
                <h3 style={styles.packName}>{drop.title}</h3>
                <p style={styles.assetCount}>
                  {drop.dropAssets.length} digital asset{drop.dropAssets.length !== 1 ? "s" : ""}
                </p>
                {drop.dropAssets.length > 0 && (
                  <div style={styles.assetList}>
                    {drop.dropAssets.map((da: any) => (
                      <a href={`/apps/snarky/api/download?id=${da.digitalAsset.id}`} key={da.digitalAsset.id} style={styles.assetItemLink}>
                        <div style={styles.assetItem}>
                          {da.digitalAsset.thumbnailUrl ? (
                            <img src={da.digitalAsset.thumbnailUrl} style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} />
                          ) : (
                            <span style={styles.assetType}>
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
        <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#fff', borderRadius: '24px', border: '1px solid rgba(242, 140, 40, 0.2)', boxShadow: '0 8px 30px rgba(0,0,0,0.06)' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🐾</span>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#2d1b0d', fontWeight: 800 }}>MelCat's Corner</h3>
            </div>
            <div style={{ padding: '0.25rem 0.75rem', background: 'rgba(138, 43, 226, 0.1)', color: '#8a2be2', borderRadius: '100px', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.5px' }}>
              BETA PREVIEW
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', alignItems: 'center' }}>
            {/* Avatar & Level */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '120px', height: '120px', borderRadius: '50%', overflow: 'hidden', border: '4px solid #f28c28', boxShadow: '0 8px 24px rgba(242, 140, 40, 0.25)', position: 'relative', background: '#fff9f0' }}>
                <img src="/melcat-ai-preview.png" style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="MelCat Companion" />
              </div>
              <div style={{ background: '#2d1b0d', color: '#fff', padding: '0.2rem 1rem', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 800, marginTop: '-15px', zIndex: 10 }}>
                LVL 1
              </div>
              <span style={{ fontSize: '0.8rem', color: '#6b5c4f', fontWeight: 600 }}>0 / 100 XP</span>
            </div>

            {/* Stats & Meters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem', fontWeight: 700, color: '#2d1b0d' }}>
                  <span>🐟 Hunger</span>
                  <span style={{ color: '#e94560' }}>Starving!</span>
                </div>
                <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: '15%', height: '100%', background: '#e94560', borderRadius: '4px' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem', fontWeight: 700, color: '#2d1b0d' }}>
                  <span>🎾 Happiness</span>
                  <span style={{ color: '#f28c28' }}>Bored</span>
                </div>
                <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: '40%', height: '100%', background: '#f28c28', borderRadius: '4px' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem', fontWeight: 700, color: '#2d1b0d' }}>
                  <span>💅 Sass Level</span>
                  <span style={{ color: '#8a2be2' }}>Maximum</span>
                </div>
                <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg, #f28c28, #8a2be2)', borderRadius: '4px' }} />
                </div>
              </div>

            </div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', marginTop: '1.5rem', fontStyle: 'italic', color: '#475569', fontSize: '0.9rem', textAlign: 'center' }}>
            "I'm not saying I'm hungry, but if you don't feed me a treat soon, your internet cables are looking awfully chewable."
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button disabled style={{ flex: 1, padding: '0.8rem', background: '#f1f5f9', color: '#94a3b8', border: 'none', borderRadius: '12px', fontWeight: 700, cursor: 'not-allowed', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🐟</span>
              <span style={{ fontSize: '0.75rem' }}>Feed Treat (0)</span>
            </button>
            <button disabled style={{ flex: 1, padding: '0.8rem', background: '#f1f5f9', color: '#94a3b8', border: 'none', borderRadius: '12px', fontWeight: 700, cursor: 'not-allowed', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🎾</span>
              <span style={{ fontSize: '0.75rem' }}>Play Minigame</span>
            </button>
            <button disabled style={{ flex: 1, padding: '0.8rem', background: '#f1f5f9', color: '#94a3b8', border: 'none', borderRadius: '12px', fontWeight: 700, cursor: 'not-allowed', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{ fontSize: '1.25rem' }}>💬</span>
              <span style={{ fontSize: '0.75rem' }}>Chat AI</span>
            </button>
          </div>
        </div>

        {/* Onboarding Instructions */}
        {(packs.length > 0 || drops.length > 0) && (
          <div style={{ marginTop: '3rem', padding: '2rem', background: 'rgba(255, 255, 255, 0.6)', borderRadius: '20px', border: '1px solid rgba(242, 140, 40, 0.1)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.25rem', color: '#2d1b0d' }}>💡 How to use your content</h3>
            <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#6b5c4f', lineHeight: 1.8 }}>
              <li><strong>GIFs:</strong> Open on your phone, hold-press, Save to Photos / Tenor.</li>
              <li><strong>PNGs:</strong> Download and use as stickers in iMessage, WhatsApp, or Canva.</li>
              <li><strong>MP4s:</strong> Save and post as Reels/Stories, or use in your own content.</li>
              <li><strong>PDFs/Printables:</strong> Download and print at home or at a copy shop.</li>
            </ul>
          </div>
        )}
        
        {authenticated && features && <GamificationPanel isEnabled={features.gamification} />}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    minHeight: "100vh",
    background: "#fffaf0",
    padding: "2rem",
    fontFamily: "'Outfit', 'Inter', system-ui, sans-serif",
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
    fontSize: "2.5rem",
    fontWeight: 800,
    background: "linear-gradient(90deg, #f28c28, #e37322)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    margin: 0,
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: "1.1rem",
    color: "#4a3728",
    margin: "10px 0 0 0",
  },
  card: {
    background: "rgba(255, 255, 255, 0.8)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(242, 140, 40, 0.2)",
    borderRadius: "24px",
    padding: "3rem",
    textAlign: "center" as const,
    boxShadow: "0 20px 40px rgba(242, 140, 40, 0.1)",
  },
  text: {
    color: "#2d1b0d",
    fontSize: "1.1rem",
    lineHeight: 1.6,
  },
  link: {
    display: "inline-block",
    marginTop: "1.5rem",
    padding: "1rem 2rem",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #f28c28, #e37322)",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: "1rem",
    boxShadow: "0 8px 20px rgba(242, 140, 40, 0.3)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
    gap: "2rem",
  },
  packCard: {
    background: "#fff",
    border: "1px solid rgba(242, 140, 40, 0.15)",
    borderRadius: "20px",
    padding: "2rem",
    boxShadow: "0 10px 25px rgba(45, 27, 13, 0.05)",
    transition: "transform 0.2s ease",
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
    padding: "0.4rem 1rem",
    borderRadius: "30px",
    fontSize: "0.75rem",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  packName: {
    color: "#2d1b0d",
    fontSize: "1.5rem",
    fontWeight: 800,
    margin: "0 0 0.5rem 0",
  },
  assetCount: {
    color: "#6b5c4f",
    fontSize: "0.9rem",
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
    padding: "0.75rem 1rem",
    background: "#fdf8f4",
    borderRadius: "12px",
    border: "1px solid rgba(242, 140, 40, 0.05)",
    transition: "background 0.2s",
  },
  assetType: {
    background: "#f28c28",
    color: "#fff",
    padding: "0.2rem 0.6rem",
    borderRadius: "6px",
    fontSize: "0.7rem",
    fontWeight: 800,
    textTransform: "uppercase" as const,
  },
  assetTitle: {
    color: "#2d1b0d",
    fontSize: "0.95rem",
    fontWeight: 500,
  },
  assetItemLink: {
    textDecoration: "none",
    color: "inherit",
    display: "block",
  },
  upgradeBanner: {
    background: "linear-gradient(135deg, #f28c28, #e37322)",
    borderRadius: "24px",
    padding: "2rem 3rem",
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
    padding: "0.4rem 0.8rem",
    borderRadius: "8px",
    marginBottom: "1rem",
    letterSpacing: "0.05em",
  },
  upgradeTitle: {
    color: "#fff",
    fontSize: "1.75rem",
    margin: "0 0 0.5rem 0",
    fontWeight: 800,
  },
  upgradeText: {
    color: "rgba(255, 255, 255, 0.9)",
    margin: 0,
    fontSize: "1rem",
    lineHeight: 1.5,
  },
  upgradeBtn: {
    background: "#2d1b0d",
    color: "#fff",
    textDecoration: "none",
    padding: "1rem 2rem",
    borderRadius: "14px",
    fontWeight: 800,
    fontSize: "1rem",
    transition: "transform 0.2s",
    whiteSpace: "nowrap" as const,
    boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
  },
  upgradeBtnContainer: {
    display: "flex",
    gap: "1rem",
    flexWrap: "wrap" as const,
  },
};
