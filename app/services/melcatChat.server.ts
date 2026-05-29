import { ENV } from "./env.server";
import { supabase } from "./supabase.server";

const MAX_MESSAGE_LENGTH = 500;

export type MelcatChatPayload = {
  shopDomain?: string;
  sessionId?: string;
  customerId?: string | null;
  customerEmail?: string | null;
  message?: string;
  pageContext?: {
    path?: string;
    pageType?: string;
    productTitle?: string;
  };
  cartContext?: {
    itemCount?: number;
  };
  upgradeUrl?: string;
  history?: Array<{ role: "user" | "model" | "assistant"; text: string }>;
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
      customerEmail: getString("customerEmail"),
      message: getString("message"),
      upgradeUrl: getString("upgradeUrl"),
      pageContext: parseJsonField<MelcatChatPayload["pageContext"]>("pageContext"),
      cartContext: parseJsonField<MelcatChatPayload["cartContext"]>("cartContext"),
      history: parseJsonField<MelcatChatPayload["history"]>("history"),
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

// ── Database Queries ────────────────────────────────────────

export async function getBigMelEntitlement({
  shopDomain,
  customerId,
  customerEmail,
}: {
  shopDomain: string;
  customerId?: string | null;
  customerEmail?: string | null;
}) {
  if (!shopDomain) return { isEntitled: false };
  if (!customerId && !customerEmail) return { isEntitled: false };

  const conditions = [];
  if (customerId) {
    conditions.push(`customer_id.eq.${customerId}`);
  }
  if (customerEmail && customerEmail.trim()) {
    conditions.push(`customer_email.ilike.${customerEmail.trim()}`);
  }

  if (conditions.length === 0) return { isEntitled: false };

  const { data, error } = await supabase
    .from("big_mel_entitlements")
    .select("id")
    .eq("shop_domain", shopDomain)
    .eq("is_active", true)
    .or(conditions.join(","));

  if (error) {
    console.error("[Entitlement Check] Supabase error:", error);
    throw error; // Fail closed on errors
  }

  const isEntitled = data && data.length > 0;
  return { isEntitled };
}

export async function getChatUsage({
  sessionId,
  shopDomain,
}: {
  sessionId: string;
  shopDomain: string;
}) {
  const { data, error } = await supabase
    .from("big_mel_chat_usage")
    .select("chat_count")
    .eq("session_id", sessionId)
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (error) {
    console.error("[Chat Usage] Get usage error:", error);
    throw error; // Fail closed on errors
  }

  return data?.chat_count ?? 0;
}

export async function incrementChatUsage({
  sessionId,
  shopDomain,
}: {
  sessionId: string;
  shopDomain: string;
}) {
  const currentCount = await getChatUsage({ sessionId, shopDomain });
  const { error } = await supabase
    .from("big_mel_chat_usage")
    .upsert({
      session_id: sessionId,
      shop_domain: shopDomain,
      chat_count: currentCount + 1,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "session_id,shop_domain"
    });

  if (error) {
    console.error("[Chat Usage] Increment usage error:", error);
    throw error; // Fail closed on errors
  }
}

// ── AI Helper & Prompting ───────────────────────────────────

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

// ── OpenAI Provider ──
async function generateBigMelReplyOpenAI(payload: MelcatChatPayload & { message: string }) {
  const apiKey = ENV.OPENAI_API_KEY;
  const url = "https://api.openai.com/v1/chat/completions";
  const systemPrompt = [
    "You are Big Mel, the snarky orange cat mascot for Snarky Pets.",
    "You help shoppers choose products, understand the store, and unlock rewards.",
    "You are funny and sarcastic, but never cruel.",
    "You do not provide veterinary, medical, legal, or financial advice.",
    "You do not invent discounts, shipping timelines, refund promises, or product claims.",
    "When unsure, tell the shopper to check the product page or contact support.",
    "Keep answers under 80 words."
  ].join("\n");

  const contextText = buildContextBlock(payload);

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt }
  ];

  if (payload.history && payload.history.length > 0) {
    payload.history.forEach(h => {
      const openAiRole = h.role === "model" || h.role === "assistant" ? "assistant" : "user";
      messages.push({ role: openAiRole, content: h.text });
    });
  }

  messages.push({ role: "user", content: contextText });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 150,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || "";

  if (!reply) {
    throw new Error("OpenAI returned no usable reply");
  }

  return sanitizeReply(reply);
}

// ── Gemini Provider ──
async function generateBigMelReplyGemini(payload: MelcatChatPayload & { message: string }) {
  const apiKey = ENV.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const systemInstruction = [
    "You are Big Mel, the snarky orange cat mascot for Snarky Pets.",
    "You help shoppers choose products, understand the store, and unlock rewards.",
    "You are funny and sarcastic, but never cruel.",
    "You do not provide veterinary, medical, legal, or financial advice.",
    "You do not invent discounts, shipping timelines, refund promises, or product claims.",
    "When unsure, tell the shopper to check the product page or contact support.",
    "Keep answers under 80 words."
  ].join("\n");

  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  if (payload.history && payload.history.length > 0) {
    payload.history.forEach(h => {
      const geminiRole = h.role === "user" ? "user" : "model";
      contents.push({
        role: geminiRole,
        parts: [{ text: h.text }]
      });
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: buildContextBlock(payload) }],
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents,
      generationConfig: {
        temperature: 0.8,
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

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join(" ").trim();
  const blocked = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason === "SAFETY";

  if (blocked || !text) {
    throw new Error("Gemini returned no usable reply");
  }

  return sanitizeReply(text);
}

// ── Dynamic Provider Dispatcher ──
async function generateBigMelReply(payload: MelcatChatPayload & { message: string }) {
  if (ENV.OPENAI_API_KEY) {
    return generateBigMelReplyOpenAI(payload);
  } else if (ENV.GEMINI_API_KEY) {
    return generateBigMelReplyGemini(payload);
  } else {
    throw new Error("No AI API keys configured. Set either OPENAI_API_KEY or GEMINI_API_KEY in Cloud Run.");
  }
}

// ── Main Request Handler ────────────────────────────────────

export async function handleMelcatChatRequest({ request }: { request: Request }) {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let payload: MelcatChatPayload;
  try {
    payload = await parseMelcatPayload(request);
  } catch (err) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const shopDomain = (
    payload.shopDomain ||
    request.headers.get("x-shopify-shop-domain") ||
    ""
  ).trim();
  const message = (payload.message || "").trim();
  const sessionId = (payload.sessionId || "").trim();

  if (!shopDomain) {
    return Response.json({ error: "shopDomain is required" }, { status: 400 });
  }

  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: `message must be under ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 });
  }

  try {
    // 1. Check entitlement
    const { isEntitled } = await getBigMelEntitlement({
      shopDomain,
      customerId: payload.customerId,
      customerEmail: payload.customerEmail,
    });

    // 2. Check usage count
    const chatUsage = await getChatUsage({ sessionId, shopDomain });

    if (!isEntitled && chatUsage >= ENV.BIG_MEL_FREE_CHAT_LIMIT) {
      return Response.json(
        {
          reply: "Upgrade required. Free chat limit reached.",
          remainingChats: 0,
          isEntitled: false,
          upgradeRequired: true,
          upgradeUrl: ENV.BIG_MEL_UPGRADE_URL,
        },
        { status: 403 }
      );
    }

    // 3. Generate reply using dynamic AI provider
    const reply = await generateBigMelReply({ ...payload, shopDomain, message });

    // 4. Increment usage count only after a successful AI reply
    if (!isEntitled) {
      await incrementChatUsage({ sessionId, shopDomain });
    }

    const updatedUsage = isEntitled ? 0 : (await getChatUsage({ sessionId, shopDomain }));
    const remainingChats = isEntitled ? ENV.BIG_MEL_FREE_CHAT_LIMIT : Math.max(0, ENV.BIG_MEL_FREE_CHAT_LIMIT - updatedUsage);

    return Response.json({
      reply,
      remainingChats,
      isEntitled,
      upgradeRequired: !isEntitled && updatedUsage >= ENV.BIG_MEL_FREE_CHAT_LIMIT,
      upgradeUrl: ENV.BIG_MEL_UPGRADE_URL,
    });

  } catch (error) {
    console.error("[Big Mel Chat Handler] Failed with error:", error);
    // Fail closed on error - deny access / return clean error
    return Response.json(
      { error: "Big Mel is currently sleeping. Try again later." },
      { status: 500 }
    );
  }
}
