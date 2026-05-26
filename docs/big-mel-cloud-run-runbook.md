# Big Mel — Google Cloud Run & Supabase Deployment Runbook

This runbook outlines the deployment and configuration steps for migrating the Big Mel Shopify app backend from Railway to **Google Cloud Run** using **Supabase Postgres** as the production database.

---

## 🏗️ 1. Infrastructure Architecture

* **API Host**: Google Cloud Run (Fully managed serverless container host)
* **Database**: Supabase Postgres (Managed PostgreSQL with built-in connection pooler)
* **AI Provider**: OpenAI API (GPT-4o-mini server-side only)
* **Gating**: Server-side active entitlements mapping + session chat limit counters in Supabase

---

## 🔑 2. Required Production Environment Variables

You must configure these variables inside the **Google Cloud Run Service Settings (Variables & Secrets)**:

| Environment Variable | Description / Recommended Value |
| :--- | :--- |
| `SUPABASE_URL` | Your Supabase Project API URL (e.g. `https://your-ref.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase high-privilege service role key (bypass RLS for server-side queries) |
| `OPENAI_API_KEY` | Production OpenAI API Key |
| `SHOPIFY_WEBHOOK_SECRET` | Secret key used to verify incoming Shopify webhook HMAC signatures |
| `BIG_MEL_UNLOCK_VARIANT_ID` | Shopify variant ID that represents the digital entitlement purchase |
| `BIG_MEL_FREE_CHAT_LIMIT` | Number of free chats allowed for unentitled users (Default: `3`) |
| `BIG_MEL_UPGRADE_URL` | Shopify cart path or upgrade page (e.g. `/cart/YOUR_VARIANT_ID:1`) |
| `ALLOWED_STOREFRONT_ORIGINS` | Comma-separated list of storefront origins (e.g. `https://snarkypets.com,https://your-store.myshopify.com`) |
| `DATABASE_URL` | Prisma pooler connection string (needed if running Shopify admin migrations) |
| `DIRECT_URL` | Prisma direct connection string (needed if running database migrations) |

> [!CAUTION]
> **Strict Secret Security**: Never expose `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, or `SHOPIFY_WEBHOOK_SECRET` to the client. Keep them server-side only.

---

## 🗄️ 3. Applying Supabase Database Migrations

The migration SQL file creates the three critical Big Mel backend tables:
1. `big_mel_entitlements`
2. `big_mel_chat_usage`
3. `big_mel_webhook_events`

### Method A: Using Supabase CLI (Recommended)
Since you are already logged in to the Supabase CLI, push the migrations from your local repository directly to your remote production database:

```bash
# Push migrations to remote database
supabase db push
```

### Method B: Manual Query Execution (Fallback)
If you don't have the CLI linked:
1. Open the [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to your project ➔ **SQL Editor**.
3. Copy the SQL content from `supabase/migrations/20260526000000_big_mel_migration.sql` and run it.

---

## 🚀 4. Build & Deploy to Google Cloud Run

Google Cloud Run allows direct deployments using the existing `Dockerfile` via Google Cloud Build.

### Step 1: Install & Login to Google Cloud SDK
Ensure you have `gcloud` installed and authenticated:
```bash
gcloud auth login
gcloud config set project YOUR_GCP_PROJECT_ID
```

### Step 2: Build and Deploy the Container
Run the following standard deploy command in the root of the `snarky-cat` directory:

```bash
gcloud run deploy big-mel-backend \
  --source . \
  --platform managed \
  --region us-east1 \
  --allow-unauthenticated \
  --port 3000
```

> [!NOTE]
> **Port Mapping**: Google Cloud Run injects the `PORT` env var dynamically at runtime (defaulting to 8080). The standard React Router server `react-router-serve` automatically binds to `process.env.PORT`, meaning no additional port mapping changes are required.

---

## 🧪 5. Post-Deployment Verification

Once successfully deployed, verify the endpoints using `curl` or Postman:

### 1. Health Probe
Ensure the load balancer readiness probe returns a `200 OK`:
```bash
curl -I https://YOUR-CLOUD-RUN-URL/health
# Response: HTTP/2 200 OK (text/plain "OK")
```

### 2. Entitlement Gating Check
```bash
curl -i https://YOUR-CLOUD-RUN-URL/api/melcat/entitlement?shopDomain=snarkypets.com
# Response: { "isEntitled": false }
```

### 3. Storefront Theme Setup
Update your Shopify Theme App Extension settings, or customize your Liquid block variables so `apiEndpoint` points to:
`https://YOUR-CLOUD-RUN-URL/api/melcat/chat`
This directs storefront chat widget queries straight to your scalable Cloud Run cluster with restricted CORS verification!
