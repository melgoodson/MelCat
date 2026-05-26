// Environment Variable Validator
// Validates only core infrastructure on server startup to prevent serverless boot crashes

const REQUIRED_CORE_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SHOPIFY_WEBHOOK_SECRET"
];

export function validateEnv() {
  const missing = [];
  for (const key of REQUIRED_CORE_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const errorMsg = `[Big Mel Env Validator] FATAL: Missing required core variables on startup: ${missing.join(", ")}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  console.log("[Big Mel Env Validator] Core env variables validated. Server startup approved.");
}

// Perform validation on import
validateEnv();

export const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  BIG_MEL_UNLOCK_VARIANT_ID: process.env.BIG_MEL_UNLOCK_VARIANT_ID || "",
  BIG_MEL_FREE_CHAT_LIMIT: Number(process.env.BIG_MEL_FREE_CHAT_LIMIT || "3"),
  BIG_MEL_UPGRADE_URL: process.env.BIG_MEL_UPGRADE_URL || "/collections/all",
  ALLOWED_STOREFRONT_ORIGINS: (process.env.ALLOWED_STOREFRONT_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
};
