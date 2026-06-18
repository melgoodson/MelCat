import prisma from "../db.server";
import { FEATURES } from "../config/features.server";

export type EventType =
  | "claim_completed"
  | "library_viewed"
  | "asset_downloaded"
  | "upgrade_clicked"
  | "upgrade_purchased"
  | "drop_unlocked"
  | "drop_downloaded"
  | "magic_link_requested"
  | "magic_link_consumed"
  | "chat_sent"
  | "free_tier_granted";

export async function trackCustomerEvent(params: {
  customerId?: string;
  eventType: EventType;
  metadata?: Record<string, any>;
  sessionId?: string;
  source?: string;
}): Promise<void> {
  await prisma.customerEvent.create({
    data: {
      customerId: params.customerId,
      eventType: params.eventType,
      metadata: params.metadata || {},
      sessionId: params.sessionId,
      source: params.source,
    },
  });
}

export async function safelyTrackCustomerEvent(params: {
  customerId?: string;
  eventType: EventType;
  metadata?: Record<string, any>;
  sessionId?: string;
  source?: string;
}): Promise<void> {
  try {
    await trackCustomerEvent(params);
  } catch (error) {
    // Fail silently in production to avoid disrupting user flow
    console.error(`[Analytics] Failed to track event ${params.eventType}:`, error);
  }
}

export async function getRecentCustomerEvents(customerId: string, limit = 50) {
  return prisma.customerEvent.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
