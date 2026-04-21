import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { consumeMagicLinkToken } from "../services/auth.server";
import { claimQrCampaign } from "../services/qr.server";
import { sessionStorage, getCustomerSession } from "../services/session.server";
import prisma from "../db.server";
import crypto from "crypto";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const campaignHash = url.searchParams.get("c");

  if (!token) {
    return new Response(
      renderHTML("Invalid Link", "This link is missing a verification token. Please request a new one."),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  try {
    // 1. Validate token and get customer
    const customer = await consumeMagicLinkToken(token);

    // 2. Create a persistent session
    const session = await getCustomerSession(request);
    const sessionToken = crypto.randomBytes(32).toString("hex");

    await prisma.customerSession.create({
      data: {
        customerId: customer.id,
        sessionToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
      },
    });

    session.set("customerId", customer.id);
    session.set("sessionToken", sessionToken);

    // 3. If there's a QR campaign, auto-claim it
    let claimMessage = "";
    if (campaignHash) {
      try {
        const result = await claimQrCampaign(campaignHash, customer.id);
        claimMessage = result.message;
      } catch (err: any) {
        claimMessage = err.message || "Could not process QR claim.";
      }
    }

    // 4. Redirect to library with session cookie
    const cookieHeader = await sessionStorage.commitSession(session);

    return new Response(
      renderHTML(
        "Welcome!",
        claimMessage
          ? `${claimMessage} Redirecting to your library...`
          : "You're verified! Redirecting to your library...",
        "/apps/snarky/proxy/library"
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Set-Cookie": cookieHeader,
        },
      }
    );
  } catch (err: any) {
    console.error("[Auth Callback] Error:", err);
    return new Response(
      renderHTML("Link Expired", "This magic link has expired or already been used. Please request a new one."),
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }
}

function renderHTML(title: string, message: string, redirectUrl?: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — MelCat</title>
  ${redirectUrl ? `<meta http-equiv="refresh" content="2;url=${redirectUrl}">` : ""}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      color: #fff;
      padding: 2rem;
    }
    .card {
      max-width: 420px;
      text-align: center;
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 2.5rem 2rem;
    }
    h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.75rem; }
    p { color: rgba(255,255,255,0.8); line-height: 1.6; }
    .spinner {
      width: 32px; height: 32px; margin: 1.5rem auto 0;
      border: 3px solid rgba(255,255,255,0.2);
      border-top-color: #e94560;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    ${redirectUrl ? '<div class="spinner"></div>' : ""}
  </div>
</body>
</html>`;
}
