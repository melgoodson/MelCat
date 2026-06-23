import { useState, useEffect, useRef } from "react";
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

  // State hooks for Tamagotchi & Chat
  const [hunger, setHunger] = useState(10);
  const [boredom, setBoredom] = useState(10);
  const [mascotState, setMascotState] = useState<'idle' | 'eating' | 'playing' | 'purring' | 'angry' | 'thinking'>('idle');
  const [speechText, setSpeechText] = useState("I'm not saying I'm hungry, but if you don't feed me a treat soon, your internet cables are looking awfully chewable.");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'model' | 'system'; text: string }>>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pathPrefix, setPathPrefix] = useState("/apps/snarky");

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.location.pathname.startsWith("/proxy")) {
        setPathPrefix("/proxy");
      }
    }
  }, []);

  useEffect(() => {
    setIsClient(true);
    const savedHunger = localStorage.getItem("melcat_stat_hunger");
    const savedBoredom = localStorage.getItem("melcat_stat_boredom");
    const lastTimeStr = localStorage.getItem("melcat_stat_last_time");
    
    let h = savedHunger ? parseInt(savedHunger, 10) : 10;
    let b = savedBoredom ? parseInt(savedBoredom, 10) : 10;
    const now = Date.now();
    
    if (lastTimeStr) {
      const lastTime = parseInt(lastTimeStr, 10);
      const elapsedMins = Math.floor((now - lastTime) / 60000);
      if (elapsedMins > 0) {
        h = Math.min(100, h + Math.floor(elapsedMins / 3) * 2);
        b = Math.min(100, b + Math.floor(elapsedMins / 3) * 2);
      }
    }
    
    setHunger(h);
    setBoredom(b);
    localStorage.setItem("melcat_stat_hunger", String(h));
    localStorage.setItem("melcat_stat_boredom", String(b));
    localStorage.setItem("melcat_stat_last_time", String(now));
    
    // Load initial chat history if available
    try {
      const historyStr = sessionStorage.getItem("melcat_chat_history");
      if (historyStr) {
        const parsed = JSON.parse(historyStr);
        setChatMessages(parsed);
      }
    } catch (e) {}
  }, []);

  // Auto-scroll chat history to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, chatOpen]);

  const getMascotImage = () => {
    if (mascotState === 'eating') return `${appUrl}/melcat-eating.webp`;
    if (mascotState === 'playing') return `${appUrl}/melcat-playing.webp`;
    if (mascotState === 'purring') return `${appUrl}/melcat-purring.webp`;
    if (mascotState === 'angry' || hunger >= 80 || boredom >= 80) return `${appUrl}/melcat-angry.webp`;
    return `${appUrl}/melcat-ai-preview.png`;
  };

  const getStatusText = () => {
    if (mascotState === 'eating') return "STATUS: EATING";
    if (mascotState === 'playing') return "STATUS: PLAYING";
    if (mascotState === 'purring') return "STATUS: PURRING";
    if (mascotState === 'thinking') return "STATUS: THINKING";
    if (hunger >= 80) return "NEEDS: FOOD!";
    if (boredom >= 80) return "NEEDS: PLAY!";
    if (hunger >= 60) return "STATUS: HUNGRY";
    if (boredom >= 60) return "STATUS: BORED";
    if (hunger <= 25 && boredom <= 25) return "STATUS: HAPPY";
    return "STATUS: OK";
  };

  const checkNiceActions = () => {
    if (localStorage.getItem("melcat_reward_claimed") === "true") return;
    let actions = parseInt(localStorage.getItem("melcat_nice_actions") || "0", 10);
    actions++;
    localStorage.setItem("melcat_nice_actions", String(actions));
    
    if (actions >= 5) {
      localStorage.setItem("melcat_reward_claimed", "true");
      setSpeechText("Fine. You aren't terrible. You kept me fed. Use code MELCARES for 10% off.");
    }
  };

  const handleFeed = () => {
    if (hunger === 0) {
      setSpeechText("I am literally full. Do I look like a garbage disposal?");
      setMascotState('angry');
      setTimeout(() => setMascotState('idle'), 4000);
      return;
    }
    const newHunger = Math.max(0, hunger - 30);
    setHunger(newHunger);
    setMascotState('eating');
    setSpeechText("Acceptable offering. The void is slightly less hungry.");
    localStorage.setItem("melcat_stat_hunger", String(newHunger));
    localStorage.setItem("melcat_stat_last_time", String(Date.now()));
    
    checkNiceActions();
    
    setTimeout(() => {
      setMascotState('idle');
    }, 4000);
  };

  const handlePlay = () => {
    if (boredom === 0) {
      setSpeechText("I am currently too stimulated for this nonsense.");
      setMascotState('idle');
      return;
    }
    const newBoredom = Math.max(0, boredom - 30);
    setBoredom(newBoredom);
    setMascotState('playing');
    setSpeechText("I will destroy this string. Thank you.");
    localStorage.setItem("melcat_stat_boredom", String(newBoredom));
    localStorage.setItem("melcat_stat_last_time", String(Date.now()));
    
    checkNiceActions();
    
    setTimeout(() => {
      setMascotState('idle');
    }, 4000);
  };

  const handlePet = () => {
    const newHunger = Math.max(0, hunger - 5);
    const newBoredom = Math.max(0, boredom - 5);
    setHunger(newHunger);
    setBoredom(newBoredom);
    setMascotState('purring');
    setSpeechText("*purrs aggressively* Don't tell anyone you saw this.");
    localStorage.setItem("melcat_stat_hunger", String(newHunger));
    localStorage.setItem("melcat_stat_boredom", String(newBoredom));
    localStorage.setItem("melcat_stat_last_time", String(Date.now()));
    
    checkNiceActions();
    
    setTimeout(() => {
      setMascotState('idle');
    }, 3000);
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const userMessage = inputText.trim();
    setInputText("");
    setIsLoading(true);
    setMascotState('thinking');
    
    const newMessages = [...chatMessages, { role: 'user' as const, text: userMessage }];
    setChatMessages(newMessages);

    try {
      const historyPayload = newMessages.map(m => ({
        role: m.role === 'user' ? 'user' as const : 'model' as const,
        text: m.text
      }));

      const body = {
        shopDomain: "fhfwar-jc.myshopify.com",
        sessionId: getOrCreateSessionId(),
        customerId: customer?.shopifyCustomerId || customer?.id || null,
        customerEmail: customer?.email || null,
        message: userMessage,
        history: historyPayload,
        pageContext: {
          path: "/apps/snarky/library",
          pageType: "vault"
        },
        cartContext: {
          itemCount: 0
        }
      };

      const response = await fetch(`${pathPrefix}/melcat/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const data = await response.json();
      if (data.reply) {
        const updatedMessages = [...newMessages, { role: 'model' as const, text: data.reply }];
        setChatMessages(updatedMessages);
        setSpeechText(data.reply);
        
        sessionStorage.setItem("melcat_chat_history", JSON.stringify(updatedMessages));
      }
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages(prev => [...prev, { role: 'system' as const, text: "Big Mel is currently sleeping. Try again later." }]);
    } finally {
      setIsLoading(false);
      setMascotState('idle');
    }
  };

  const getOrCreateSessionId = () => {
    let sid = sessionStorage.getItem("sienvi_melcat_session_id");
    if (!sid) {
      sid = "melcat-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem("sienvi_melcat_session_id", sid);
    }
    return sid;
  };

  if (!authenticated) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={{ margin: '0 auto 1.5rem', width: '110px', height: '110px', borderRadius: '50%', overflow: 'hidden', border: '4px solid #f28c28', boxShadow: '0 8px 24px rgba(242, 140, 40, 0.25)', background: '#fff9f0' }}>
              <img src={`${appUrl}/mascot.jpeg`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="MelCat Mascot" />
            </div>
            <h1 style={styles.title}>🔒 MelCat Vault Locked</h1>
            <p style={styles.text}>
              Big Mel is waiting! You need a magic link to access your digital treasures.
            </p>
            <a href={`${pathPrefix}/claim`} style={styles.link}>
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
            <a href={`${pathPrefix}/logout${token ? `?token=${token}` : ""}`} style={{ color: '#e37322', textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem', background: 'rgba(242,140,40,0.1)', padding: '0.4rem 1rem', borderRadius: '30px', transition: 'all 0.2s' }}>Sign out ➔</a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginBottom: '1rem' }}>
             <div style={{ width: '70px', height: '70px', borderRadius: '50%', overflow: 'hidden', border: '3px solid #f28c28', boxShadow: '0 4px 15px rgba(242,140,40,0.2)', background: '#fff9f0' }}>
                <img src={`${appUrl}/mascot.jpeg`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="MelCat Mascot" />
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
                <a href={`${pathPrefix}/upgrade?tier=2${token ? `&token=${token}` : ""}`} style={{...styles.upgradeBtn, background: '#f28c28', color: '#fff'}}>
                  Standard Upgrade
                </a>
              )}
              {maxTier < 3 && (
                <a href={`${pathPrefix}/upgrade?tier=3${token ? `&token=${token}` : ""}`} style={{...styles.upgradeBtn, background: '#e94560', color: '#fff'}}>
                  Deluxe Upgrade
                </a>
              )}
              {maxTier < 4 && (
                <a href={`${pathPrefix}/upgrade?tier=4${token ? `&token=${token}` : ""}`} style={styles.upgradeBtn}>
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
                      <a href={`${pathPrefix}/api/download?id=${pa.digitalAsset.id}${token ? `&token=${token}` : ""}`} key={pa.digitalAsset.id} style={styles.assetItemLink}>
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
                      <a href={`${pathPrefix}/api/download?id=${da.digitalAsset.id}${token ? `&token=${token}` : ""}`} key={da.digitalAsset.id} style={styles.assetItemLink}>
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

        {/* INTERACTIVE MELCAT VAULT VAULT COMPANION */}
        <div style={styles.gameCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>🐾</span>
              <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#2d1b0d', fontWeight: 800 }}>MelCat's Corner</h3>
            </div>
            <div style={{ padding: '0.35rem 0.85rem', background: 'rgba(242, 140, 40, 0.12)', color: '#e37322', borderRadius: '100px', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.5px' }}>
              {getStatusText()}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem', alignItems: 'center' }}>
            {/* Avatar & Level with click-to-pet Easter Egg */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <button 
                onClick={handlePet}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  padding: 0, 
                  cursor: 'pointer', 
                  outline: 'none',
                  transition: 'transform 0.15s ease'
                }}
                title="Click to pet Big Mel!"
                onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.95)'; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <div style={{ width: '130px', height: '130px', borderRadius: '50%', overflow: 'hidden', border: '4px solid #f28c28', boxShadow: '0 8px 24px rgba(242, 140, 40, 0.25)', position: 'relative', background: '#fff9f0' }}>
                  <img src={getMascotImage()} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="MelCat Companion" />
                </div>
              </button>
              <div style={{ background: '#2d1b0d', color: '#fff', padding: '0.25rem 1.25rem', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 900, marginTop: '-15px', zIndex: 10, boxShadow: '0 4px 10px rgba(0,0,0,0.15)' }}>
                LVL {Math.max(1, maxTier)}
              </div>
              <span style={{ fontSize: '0.85rem', color: '#6b5c4f', fontWeight: 700, marginTop: '5px' }}>
                {typeof localStorage !== 'undefined' && localStorage.getItem("melcat_reward_claimed") === "true" ? "100 / 100 XP" : "40 / 100 XP"}
              </span>
            </div>

            {/* Stats & Meters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.35rem', fontWeight: 700, color: '#2d1b0d' }}>
                  <span>🐟 Hunger</span>
                  <span style={{ color: hunger >= 60 ? '#e94560' : '#2d1b0d', fontWeight: 800 }}>
                    {hunger >= 80 ? "Starving!" : hunger >= 60 ? "Hungry" : hunger <= 25 ? "Full" : "Satisfied"}
                  </span>
                </div>
                <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
                  <div style={{ width: `${hunger}%`, height: '100%', background: hunger >= 60 ? '#e94560' : '#f28c28', borderRadius: '5px', transition: 'width 0.4s ease' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.35rem', fontWeight: 700, color: '#2d1b0d' }}>
                  <span>🎾 Boredom</span>
                  <span style={{ color: boredom >= 60 ? '#e37322' : '#2d1b0d', fontWeight: 800 }}>
                    {boredom >= 80 ? "Bored!" : boredom >= 60 ? "Restless" : boredom <= 25 ? "Happy" : "Amused"}
                  </span>
                </div>
                <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
                  <div style={{ width: `${boredom}%`, height: '100%', background: boredom >= 60 ? '#e94560' : '#f28c28', borderRadius: '5px', transition: 'width 0.4s ease' }} />
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

          {chatOpen ? (
            <div style={styles.chatContainer}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#2d1b0d' }}>💬 Chat with Big Mel</span>
                <button 
                  onClick={() => setChatOpen(false)}
                  style={{ background: 'none', border: 'none', color: '#e37322', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  Close Chat
                </button>
              </div>

              <div style={styles.chatHistory}>
                {chatMessages.length === 0 ? (
                  <div style={{ color: '#6b5c4f', fontStyle: 'italic', fontSize: '0.9rem', margin: 'auto', padding: '1rem', textAlign: 'center' }}>
                    Type something to start your judgment session...
                  </div>
                ) : (
                  chatMessages.map((msg, i) => (
                    <div 
                      key={i} 
                      style={
                        msg.role === 'user' 
                          ? styles.userBubble 
                          : msg.role === 'system'
                            ? styles.systemBubble
                            : styles.modelBubble
                      }
                    >
                      {msg.text}
                    </div>
                  ))
                )}
                {isLoading && (
                  <div style={{...styles.modelBubble, display: 'flex', alignItems: 'center', gap: '0.5rem', fontStyle: 'italic', color: '#6b5c4f'}}>
                    <span>🐾 Big Mel is thinking...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={handleChatSubmit} style={styles.chatForm}>
                <input 
                  type="text" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={isLoading ? "Please wait..." : "Ask Big Mel anything..."}
                  disabled={isLoading}
                  style={styles.chatInput}
                />
                <button 
                  type="submit" 
                  disabled={isLoading || !inputText.trim()}
                  style={{
                    ...styles.chatSubmitBtn,
                    opacity: (isLoading || !inputText.trim()) ? 0.6 : 1,
                    cursor: (isLoading || !inputText.trim()) ? 'not-allowed' : 'pointer'
                  }}
                >
                  Send
                </button>
              </form>
            </div>
          ) : (
            <>
              <div style={styles.quoteBubble}>
                "{speechText}"
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button 
                  onClick={handleFeed}
                  style={styles.activeBtn}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <span style={{ fontSize: '1.25rem' }}>🐟</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Feed Treat</span>
                </button>
                <button 
                  onClick={handlePlay}
                  style={styles.activeBtn}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <span style={{ fontSize: '1.25rem' }}>🎾</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Play Minigame</span>
                </button>
                <button 
                  onClick={() => setChatOpen(true)}
                  style={{...styles.activeBtn, background: 'linear-gradient(135deg, #2d1b0d, #4a2e12)'}}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <span style={{ fontSize: '1.25rem' }}>💬</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Chat AI</span>
                </button>
              </div>
            </>
          )}
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
  activeBtn: {
    flex: 1,
    padding: '1rem',
    background: 'linear-gradient(135deg, #f28c28, #e37322)',
    color: '#fff',
    border: 'none',
    borderRadius: '16px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0.35rem',
    boxShadow: '0 4px 12px rgba(242, 140, 40, 0.15)',
    transition: 'all 0.2s ease',
  },
  chatContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
    marginTop: '1.5rem',
    border: '1px solid #f1f5f9',
    borderRadius: '16px',
    padding: '1.25rem',
    background: '#fafbfd',
  },
  chatHistory: {
    maxHeight: '250px',
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.75rem',
    paddingRight: '0.5rem',
  },
  userBubble: {
    alignSelf: 'flex-end',
    background: 'linear-gradient(135deg, #f28c28, #e37322)',
    color: '#fff',
    padding: '0.75rem 1.1rem',
    borderRadius: '16px 16px 4px 16px',
    fontSize: '0.9rem',
    maxWidth: '80%',
    boxShadow: '0 4px 12px rgba(242, 140, 40, 0.15)',
  },
  modelBubble: {
    alignSelf: 'flex-start',
    background: '#fff',
    color: '#2d1b0d',
    padding: '0.75rem 1.1rem',
    borderRadius: '16px 16px 16px 4px',
    fontSize: '0.9rem',
    maxWidth: '80%',
    border: '1px solid #e2e8f0',
    boxShadow: '0 4px 10px rgba(0, 0, 0, 0.02)',
  },
  systemBubble: {
    alignSelf: 'center',
    background: '#fee2e2',
    color: '#991b1b',
    padding: '0.5rem 1rem',
    borderRadius: '12px',
    fontSize: '0.8rem',
    maxWidth: '90%',
  },
  chatForm: {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '0.5rem',
  },
  chatInput: {
    flex: 1,
    padding: '0.75rem 1rem',
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    fontSize: '0.9rem',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  chatSubmitBtn: {
    padding: '0.75rem 1.25rem',
    borderRadius: '12px',
    border: 'none',
    background: 'linear-gradient(135deg, #f28c28, #e37322)',
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.9rem',
    cursor: 'pointer',
    boxShadow: '0 4px 10px rgba(242, 140, 40, 0.2)',
  },
  instructionsCard: {
    marginTop: '3rem',
    padding: '2.25rem',
    background: 'rgba(255, 255, 255, 0.65)',
    borderRadius: '24px',
    border: '1px solid rgba(242, 140, 40, 0.12)',
  },
};
