import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getBigMelEntitlement } from "../services/melcatChat.server";
import { ENV } from "../services/env.server";

function getAllowedOrigin(request: Request): string {
  const origin = request.headers.get("origin");
  const allowed = ENV.ALLOWED_STOREFRONT_ORIGINS;

  if (origin && allowed.length > 0) {
    if (allowed.includes(origin)) {
      return origin;
    }
    return allowed[0];
  }
  return "*";
}

function corsHeaders(request: Request): HeadersInit {
  const allowedOrigin = getAllowedOrigin(request);
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };
}

// OPTIONS preflight
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method.toUpperCase() === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  // Handle GET request
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shopDomain");
  const customerId = url.searchParams.get("customerId");
  const customerEmail = url.searchParams.get("customerEmail");

  if (!shopDomain) {
    return addCorsHeaders(
      Response.json({ error: "shopDomain is required" }, { status: 400 }),
      request
    );
  }

  try {
    const { isEntitled } = await getBigMelEntitlement({
      shopDomain,
      customerId,
      customerEmail,
    });
    return addCorsHeaders(Response.json({ isEntitled }), request);
  } catch (error) {
    console.error("[Entitlement Route Loader] Error checking entitlement:", error);
    return addCorsHeaders(
      Response.json({ error: "Internal server error", isEntitled: false }, { status: 500 }),
      request
    );
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }

  if (request.method.toUpperCase() !== "POST") {
    return addCorsHeaders(
      Response.json({ error: "Method not allowed" }, { status: 405 }),
      request
    );
  }

  try {
    let body: any;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      const formData = await request.formData();
      body = {
        shopDomain: formData.get("shopDomain")?.toString(),
        customerId: formData.get("customerId")?.toString(),
        customerEmail: formData.get("customerEmail")?.toString(),
      };
    }

    const { shopDomain, customerId, customerEmail } = body;

    if (!shopDomain) {
      return addCorsHeaders(
        Response.json({ error: "shopDomain is required" }, { status: 400 }),
        request
      );
    }

    const { isEntitled } = await getBigMelEntitlement({
      shopDomain,
      customerId,
      customerEmail,
    });
    return addCorsHeaders(Response.json({ isEntitled }), request);
  } catch (error) {
    console.error("[Entitlement Route Action] Error checking entitlement:", error);
    return addCorsHeaders(
      Response.json({ error: "Internal server error", isEntitled: false }, { status: 500 }),
      request
    );
  }
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
