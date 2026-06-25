import prisma from "../db.server";
import { supabase } from "./supabase.server";

export async function getDashboardMetrics(dateRange: { from?: Date; to?: Date }) {
  const [core, funnel, qr, upgrade, drop, amazon] = await Promise.all([
    getCoreCounters(dateRange),
    getFunnelMetrics(dateRange),
    getQRCampaignMetrics(dateRange),
    getUpgradeMetrics(dateRange),
    getDropMetrics(dateRange),
    getAmazonMetrics(),
  ]);

  return { core, funnel, qr, upgrade, drop, amazon };
}

export async function getAmazonMetrics() {
  const [
    totalOrders,
    claimedOrders,
    totalClaims,
    pendingClaimsCount,
    approvedClaimsCount,
    claims,
    orders
  ] = await Promise.all([
    prisma.amazonOrder.count(),
    prisma.amazonOrder.count({ where: { isClaimed: true } }),
    prisma.amazonClaim.count(),
    prisma.amazonClaim.count({ where: { status: "PENDING" } }),
    prisma.amazonClaim.count({ where: { status: "APPROVED" } }),
    prisma.amazonClaim.findMany({
      orderBy: { claimedAt: "desc" },
      take: 100
    }),
    prisma.amazonOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    })
  ]);

  return {
    totalOrders,
    claimedOrders,
    totalClaims,
    pendingClaimsCount,
    approvedClaimsCount,
    claims,
    orders
  };
}


export async function getCoreCounters(dateRange: { from?: Date; to?: Date }) {
  const eventWhere = dateRange.from ? { createdAt: { gte: dateRange.from, lte: dateRange.to } } : {};
  const customerWhere = dateRange.from ? { createdAt: { gte: dateRange.from, lte: dateRange.to } } : {};
  const qrRedemptionWhere = dateRange.from ? { claimedAt: { gte: dateRange.from, lte: dateRange.to } } : {};
  const dropNotificationWhere = dateRange.from ? { sentAt: { gte: dateRange.from, lte: dateRange.to } } : {};

  const [totalCustomers, activeEntitlements, qrRedemptions, events, chatSessionsResult] = await Promise.all([
    prisma.customer.count({ where: customerWhere }),
    prisma.entitlement.count({ where: { revoked: false, ...customerWhere } }),
    prisma.qRRedemption.count({ where: qrRedemptionWhere }),
    prisma.customerEvent.groupBy({
      by: ['eventType'],
      _count: { id: true },
      where: eventWhere
    }),
    prisma.customerEvent.groupBy({
      by: ['sessionId'],
      where: { eventType: "chat_sent", ...eventWhere }
    })
  ]);

  const eventCounts = events.reduce((acc, curr) => ({
    ...acc, [curr.eventType]: curr._count.id
  }), {} as Record<string, number>);

  const uniqueChatSessions = chatSessionsResult.filter(r => r.sessionId).length;

  let totalChats = eventCounts.chat_sent || 0;
  let finalUniqueSessions = uniqueChatSessions;

  // Fallback to Supabase big_mel_chat_usage table to show historical chats before event tracking was active
  try {
    const { data: usageData } = await supabase
      .from("big_mel_chat_usage")
      .select("chat_count");

    if (usageData && usageData.length > 0) {
      const historicChats = usageData.reduce((acc, curr) => acc + (curr.chat_count || 0), 0);
      const historicSessions = usageData.length;
      
      if (totalChats === 0) {
        totalChats = historicChats;
      }
      if (finalUniqueSessions === 0) {
        finalUniqueSessions = historicSessions;
      }
    }
  } catch (err) {
    console.error("[Metrics] Failed to fetch historical chat usage:", err);
  }

  // Free Tier Purchases (tunnels/cubes)
  const freeTierEvents = await prisma.customerEvent.findMany({
    where: { eventType: "free_tier_granted", ...eventWhere }
  });

  let tunnelsClaimed = 0;
  let cubesClaimed = 0;
  freeTierEvents.forEach(e => {
    const productType = (e.metadata as any)?.productType;
    if (productType === "tunnel") tunnelsClaimed++;
    else if (productType === "cube") cubesClaimed++;
  });

  // Free-to-paid conversion rate
  const freeTierCustomersResult = await prisma.customerEvent.groupBy({
    by: ['customerId'],
    where: { eventType: "free_tier_granted" }
  });
  
  const freeTierCustomerIds = freeTierCustomersResult
    .map(r => r.customerId)
    .filter(Boolean) as string[];

  let convertedUpgrades = 0;
  if (freeTierCustomerIds.length > 0) {
    const upgradedCustomersResult = await prisma.customerEvent.groupBy({
      by: ['customerId'],
      where: {
        customerId: { in: freeTierCustomerIds },
        eventType: "upgrade_purchased"
      }
    });
    convertedUpgrades = upgradedCustomersResult.length;
  }

  const freeToPaidConversionRate = freeTierCustomerIds.length > 0
    ? ((convertedUpgrades / freeTierCustomerIds.length) * 100).toFixed(1) + "%"
    : "0.0%";

  return {
    totalCustomers,
    activeEntitlements,
    totalQRRedemptions: qrRedemptions,
    libraryViews: eventCounts.library_viewed || 0,
    assetDownloads: eventCounts.asset_downloaded || 0,
    upgradeClicks: eventCounts.upgrade_clicked || 0,
    upgradePurchases: eventCounts.upgrade_purchased || 0,
    dropNotifications: await prisma.dropNotificationLog.count({ where: dropNotificationWhere }),
    dropDownloads: eventCounts.drop_downloaded || 0,
    totalChats,
    uniqueChatSessions: finalUniqueSessions,
    tunnelsClaimed,
    cubesClaimed,
    freeToPaidConversionRate,
    eventCounts
  };
}

export async function getFunnelMetrics(dateRange: { from?: Date; to?: Date }) {
  const { eventCounts, dropNotifications } = await getCoreCounters(dateRange);
  
  const claimToLibrary = eventCounts.claim_completed ? 
    ((eventCounts.library_viewed || 0) / eventCounts.claim_completed * 100).toFixed(1) : "0.0";
    
  const libraryToUpgradeClick = eventCounts.library_viewed ?
    ((eventCounts.upgrade_clicked || 0) / eventCounts.library_viewed * 100).toFixed(1) : "0.0";
    
  const clickToPurchase = eventCounts.upgrade_clicked ?
    ((eventCounts.upgrade_purchased || 0) / eventCounts.upgrade_clicked * 100).toFixed(1) : "0.0";

  const dropToDownload = dropNotifications ?
    ((eventCounts.drop_downloaded || 0) / dropNotifications * 100).toFixed(1) : "0.0";

  return {
    claimToLibrary: `${claimToLibrary}%`,
    libraryToUpgradeClick: `${libraryToUpgradeClick}%`,
    clickToPurchase: `${clickToPurchase}%`,
    dropToDownload: `${dropToDownload}%`
  };
}

export async function getQRCampaignMetrics(dateRange: { from?: Date; to?: Date }) {
  const eventWhere = dateRange.from ? { createdAt: { gte: dateRange.from, lte: dateRange.to } } : {};
  const qrRedemptionWhere = dateRange.from ? { claimedAt: { gte: dateRange.from, lte: dateRange.to } } : {};
  
  const campaigns = await prisma.qRCampaign.findMany({
    include: {
      pack: { select: { name: true } },
      redemptions: {
        where: qrRedemptionWhere,
      }
    }
  });

  const claims = await prisma.customerEvent.findMany({
    where: { eventType: "claim_completed", ...eventWhere }
  });

  const result = campaigns.map(c => {
    // Unique customers
    const uniqueCust = new Set((c.redemptions as any[]).map((r: any) => r.customerId)).size;
    // Claim completed count linked to this campaignHash
    const claimsForCampaign = claims.filter(ev => 
      ev.metadata && typeof ev.metadata === 'object' && (ev.metadata as any).campaignHash === c.campaignHash
    ).length;

    return {
      campaignHash: c.campaignHash,
      packName: (c as any).pack?.name ?? "N/A",
      isActive: c.isActive,
      redemptions: c.redemptions.length,
      uniqueCustomers: uniqueCust,
      claimCompleted: claimsForCampaign,
      // library_viewed linking requires session tracing, we provide a rough estimate or N/A
      libraryViewed: "N/A" 
    };
  });

  return result;
}

export async function getUpgradeMetrics(dateRange: { from?: Date; to?: Date }) {
  const eventWhere = dateRange.from ? { createdAt: { gte: dateRange.from, lte: dateRange.to } } : {};

  const clicks = await prisma.customerEvent.findMany({
    where: { eventType: "upgrade_clicked", ...eventWhere }
  });

  const purchases = await prisma.customerEvent.findMany({
    where: { eventType: "upgrade_purchased", ...eventWhere }
  });

  // Group by Target Tier
  const tierStats: Record<string, { clicks: number, purchases: number }> = {};

  clicks.forEach(c => {
    const tier = (c.metadata as any)?.targetTier || "Unknown";
    if (!tierStats[tier]) tierStats[tier] = { clicks: 0, purchases: 0 };
    tierStats[tier].clicks++;
  });

  purchases.forEach(p => {
    // Note: upgrade_purchased metadata uses 'tierLevel' instead of 'targetTier'
    const tier = (p.metadata as any)?.tierLevel || "Unknown";
    if (!tierStats[tier]) tierStats[tier] = { clicks: 0, purchases: 0 };
    tierStats[tier].purchases++;
  });

  return Object.entries(tierStats).map(([tier, stats]) => ({
    tier,
    clicks: stats.clicks,
    purchases: stats.purchases,
    conversion: stats.clicks ? ((stats.purchases / stats.clicks) * 100).toFixed(1) + "%" : "0.0%"
  }));
}

export async function getDropMetrics(dateRange: { from?: Date; to?: Date }) {
  const eventWhere = dateRange.from ? { createdAt: { gte: dateRange.from, lte: dateRange.to } } : {};
  const dropNotificationWhere = dateRange.from ? { sentAt: { gte: dateRange.from, lte: dateRange.to } } : {};

  const drops = await prisma.drop.findMany({
    include: {
      notifications: { where: dropNotificationWhere }
    }
  });

  const downloads = await prisma.customerEvent.findMany({
    where: { eventType: "drop_downloaded", ...eventWhere }
  });

  return drops.map(drop => {
    const notifications = (drop as any).notifications || [];
    const notifsSent = notifications.filter((n: any) => n.status === 'sent').length;
    const notifsFailed = notifications.filter((n: any) => n.status === 'failed').length;
    
    const dropDl = downloads.filter(d => 
      d.metadata && typeof d.metadata === 'object' && (d.metadata as any).dropId === drop.id
    ).length;

    return {
      dropTitle: drop.title,
      requiredTier: drop.requiredTierLevel,
      notificationsSent: notifsSent,
      notificationsFailed: notifsFailed,
      dropDownloaded: dropDl,
      reactivationRate: notifsSent ? ((dropDl / notifsSent) * 100).toFixed(1) + "%" : "0.0%"
    };
  });
}
