import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { handleMelcatChatRequest } from "../services/melcatChat.server";
import { ENV } from "../services/env.server";

function getAllowedOrigin(request: Request): string {
  const origin = request.headers.get("origin");
  const allowed = ENV.ALLOWED_STOREFRONT_ORIGINS;

  if (origin && allowed.length > 0) {
    if (allowed.includes(origin)) {
      return origin;
    }
    // Fail origin check - return first allowed origin to trigger browser CORS rejection
    return allowed[0];
  }
  
  return "*";
}

function corsHeaders(request: Request): HeadersInit {
  const allowedOrigin = getAllowedOrigin(request);
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * OPTIONS — handle CORS preflight from the Shopify storefront extension.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method.toUpperCase() === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  // Strip the `origin` header so React Router's CSRF guard doesn't abort
  // cross-origin POST requests coming from the Shopify storefront extension.
  const sanitized = stripOriginHeader(request);
  const response = await handleMelcatChatRequest({ request: sanitized });
  return addCorsHeaders(response, request);
}

/* ── Helpers ───────────────────────────────────────────────── */

function stripOriginHeader(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("origin");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half",
  } as RequestInit & { duplex: string });
}

function addCorsHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
