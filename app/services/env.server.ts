// Environment Variable Validator
// Validates all critical variables on server startup

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "SHOPIFY_WEBHOOK_SECRET",
  "BIG_MEL_UNLOCK_VARIANT_ID"
];

export function validateEnv() {
  const missing = [];
  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const errorMsg = `[Big Mel Env Validator] FATAL: Missing required environment variables on startup: ${missing.join(", ")}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  console.log("[Big Mel Env Validator] Env variables validation succeeded. Startup parameters initialized.");
}

// Perform validation on import
validateEnv();

export const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET!,
  BIG_MEL_UNLOCK_VARIANT_ID: process.env.BIG_MEL_UNLOCK_VARIANT_ID!,
  BIG_MEL_FREE_CHAT_LIMIT: Number(process.env.BIG_MEL_FREE_CHAT_LIMIT || "3"),
  BIG_MEL_UPGRADE_URL: process.env.BIG_MEL_UPGRADE_URL || "/cart/YOUR_VARIANT_ID:1",
  ALLOWED_STOREFRONT_ORIGINS: (process.env.ALLOWED_STOREFRONT_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
};
