import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { handleMelcatChatRequest } from "../services/melcatChat.server";

/**
 * OPTIONS — handle CORS preflight from the Shopify storefront proxy.
 * React Router calls the loader for OPTIONS requests on resource routes.
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
  // React Router's CSRF check compares `origin` vs `x-forwarded-host`.
  // Shopify's storefront proxy sets origin=<storefront> and
  // x-forwarded-host=<app-domain>, so they never match.
  // We bypass the check here by cloning the request with the origin
  // header stripped so React Router's internal guard is satisfied,
  // then delegate to the real handler.
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

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };
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
