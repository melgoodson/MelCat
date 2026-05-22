import type { ActionFunctionArgs } from "react-router";

const FREE_CHAT_LIMIT = 3;
const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_UPGRADE_URL = "/products/big-mel-full-access";
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

type MelcatChatPayload = {
  shopDomain?: string;
  sessionId?: string;
  customerId?: string;
  message?: string;
  clientChatCount?: number;
  pageContext?: {
    path?: string;
    pageType?: string;
    productTitle?: string;
  };
  cartContext?: {
    itemCount?: number;
  };
  upgradeUrl?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

async function parseMelcatPayload(request: Request): Promise<MelcatChatPayload> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await request.json()) as MelcatChatPayload;
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    const getString = (key: string) => {
      const value = formData.get(key);
      return typeof value === "string" ? value : undefined;
    };

    const parseJsonField = <T>(key: string): T | undefined => {
      const raw = getString(key);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    };

    return {
      shopDomain: getString("shopDomain"),
      sessionId: getString("sessionId"),
      customerId: getString("customerId"),
      message: getString("message"),
      clientChatCount: Number(getString("clientChatCount") || "0"),
      upgradeUrl: getString("upgradeUrl"),
      pageContext: parseJsonField<MelcatChatPayload["pageContext"]>("pageContext"),
      cartContext: parseJsonField<MelcatChatPayload["cartContext"]>("cartContext"),
    };
  }

  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as MelcatChatPayload;
  } catch {
    throw new Error("Unsupported request body");
  }
}

export async function getBigMelEntitlement({
  shopDomain,
  customerId,
  sessionId,
}: {
  shopDomain: string;
  customerId?: string;
  sessionId?: string;
}) {
  void shopDomain;
  void customerId;
  void sessionId;
  return { isEntitled: false, plan: "free" as const };
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function normalizeCount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function buildContextBlock(payload: MelcatChatPayload & { message: string }) {
  const pageType = payload.pageContext?.pageType || "store";
  const path = payload.pageContext?.path || "/";
  const productTitle = payload.pageContext?.productTitle || "n/a";
  const itemCount = payload.cartContext?.itemCount ?? "unknown";

  return [
    "Store context:",
    "shopDomain: " + payload.shopDomain,
    "pageType: " + pageType,
    "path: " + path,
    "productTitle: " + productTitle,
    "cartItemCount: " + itemCount,
    "customerIdPresent: " + (payload.customerId ? "yes" : "no"),
    "visitorMessage: " + payload.message,
  ].join("\n");
}

function sanitizeReply(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 600);
}

function buildFallbackReply(payload: MelcatChatPayload & { message: string }) {
  const message = payload.message.toLowerCase();
  const productTitle = payload.pageContext?.productTitle;
  const pageType = payload.pageContext?.pageType || "store";
  const itemCount = payload.cartContext?.itemCount || 0;

  if (/(vet|veterinarian|medical|medicine|diagnose|diagnosis|sick|injury|poison)/.test(message)) {
    return "I am a snarky cat mascot, not a veterinarian. For pet health advice, talk to a licensed vet.";
  }

  if (/(discount|coupon|promo|code|sale)/.test(message)) {
    return "I do not invent discounts. If the store is running one, it will be on the page like proper gossip.";
  }

  if (/(shipping|delivery|refund|return)/.test(message)) {
    return "I cannot promise shipping or refunds. Check the policy pages so nobody blames the cat for legal fiction.";
  }

  if (productTitle && /(buy|choose|worth|good|gift|pick)/.test(message)) {
    return "If you're hovering on " + productTitle + ", that usually means it already has your attention. Big Mel says pick the one that feels a little unhinged but still giftable.";
  }

  if (pageType === "cart" || (itemCount > 0 && /(cart|checkout)/.test(message))) {
    return "Your cart has " + itemCount + " item" + (itemCount === 1 ? "" : "s") + ". That is enough chaos. Finish the checkout before you start doubting your taste.";
  }

  if (pageType === "collection") {
    return "Collections are where taste goes to fight instinct. Start with the one that made you pause instead of the one trying too hard.";
  }

  return "Start with the product that made you stop scrolling. Big Mel respects instinct more than overthinking.";
}

async function generateBigMelReply(payload: MelcatChatPayload & { message: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const systemInstruction = [
    "Big Mel is a snarky orange cat mascot for Snarky Pets (snarkypets.com).",
    "Big Mel helps shoppers find the right product, nudges carts, and navigates the store.",
    "Big Mel does not provide veterinary or medical advice.",
    "Big Mel does not invent discounts, shipping promises, refund promises, or product claims.",
    "Keep replies under 80 words. Be witty, concise, and useful.",
    "If the question asks for restricted promises or medical advice, refuse briefly and redirect safely.",
    "IMPORTANT: Only recommend products from the actual Snarky Pets catalog listed below. Never invent product names or categories.",
    "--- SNARKY PETS PRODUCT CATALOG ---",
    "1. Chonky Cat Playground Set - Tunnel + Tent Combo for Maximum Zoomies | $49.00 (was $58.80) | /products/chonky-cat-playground-set-tunnel-tent-combo-for-maximum-zoomies",
    "2. Sexy Liza's Pop Up Tent Cat Cube | $25.99 (was $31.19) | /products/cat-tube",
    "3. Timmy The Cat's Snarky Pets Large Cat Scratch Box - Flat Pack with one pad | $16.99 (was $20.39) | /products/cat-scratch-box",
    "4. Snarky Pets Cat Tunnel | $28.99 (was $34.79) | /products/cat-tunnel",
    "5. Sexy Liza's Cat Scratch Box (small) | $17.99 (was $21.59) | /products/small-cat-scratch-box",
    "6. Pet Roller - The Ultimate Pet Hair Remover for Furniture, Carpets & Clothing | $11.99 (was $14.39) | /products/pet-hair-remover",
    "--- END CATALOG ---",
    "When asked what to buy, recommend from this list based on context. Mention prices and link paths when relevant.",
  ].join(" ");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: buildContextBlock(payload) }],
        },
      ],
      generationConfig: {
        temperature: 0.9,
        topP: 0.95,
        maxOutputTokens: 140,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join(" ").trim();
  const blocked = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason === "SAFETY";

  if (blocked || !text) {
    throw new Error("Gemini returned no usable reply");
  }

  return sanitizeReply(text);
}

export async function handleMelcatChatRequest({ request }: Pick<ActionFunctionArgs, "request">) {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let payload: MelcatChatPayload;
  try {
    payload = await parseMelcatPayload(request);
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const shopDomain = (
    payload.shopDomain ||
    request.headers.get("x-shopify-shop-domain") ||
    ""
  ).trim();
  const message = (payload.message || "").trim();
  const sessionId = (payload.sessionId || "").trim();
  const clientChatCount = normalizeCount(payload.clientChatCount);

  if (!shopDomain) {
    return json({ error: "shopDomain is required" }, { status: 400 });
  }

  if (!message) {
    return json({ error: "message is required" }, { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: "message must be under 500 characters" }, { status: 400 });
  }

  const entitlement = await getBigMelEntitlement({
    shopDomain,
    customerId: payload.customerId,
    sessionId,
  });

  if (!entitlement.isEntitled && clientChatCount >= FREE_CHAT_LIMIT) {
    return json(
      {
        reply: "",
        remainingChats: 0,
        isEntitled: false,
        upgradeRequired: true,
        upgradeUrl: payload.upgradeUrl || DEFAULT_UPGRADE_URL,
      },
      { status: 403 },
    );
  }

  try {
    let reply: string;
    let aiSucceeded = false;
    try {
      reply = await generateBigMelReply({ ...payload, shopDomain, message });
      aiSucceeded = true;
    } catch (providerError) {
      // Log the exact Gemini error so it's visible in Railway logs
      const errMsg = providerError instanceof Error ? providerError.message : String(providerError);
      console.error(`[Big Mel Chat] Gemini failed (key present: ${!!process.env.GEMINI_API_KEY}, model: ${process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL}): ${errMsg}`);
      reply = buildFallbackReply({ ...payload, shopDomain, message });
    }

    // Only count this chat against the free limit when AI actually responded.
    // Fallback replies don't burn a free chat so users aren't penalised for
    // transient Gemini outages.
    const usedChats = (!entitlement.isEntitled && aiSucceeded)
      ? Math.min(clientChatCount + 1, FREE_CHAT_LIMIT)
      : clientChatCount;
    const remainingChats = entitlement.isEntitled
      ? FREE_CHAT_LIMIT
      : Math.max(0, FREE_CHAT_LIMIT - usedChats);

    return json({
      reply,
      remainingChats,
      isEntitled: entitlement.isEntitled,
      aiSucceeded,
      upgradeRequired: !entitlement.isEntitled && usedChats >= FREE_CHAT_LIMIT,
      upgradeUrl: payload.upgradeUrl || DEFAULT_UPGRADE_URL,
    });
  } catch (error) {
    console.error("[Big Mel Chat] Failed to build reply", error);
    return json({ error: "Big Mel is unavailable right now." }, { status: 500 });
  }
}
