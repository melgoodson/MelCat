import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

import { Link as RemixLink } from "react-router";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <PolarisAppProvider 
      i18n={polarisTranslations}
      linkComponent={({ url, children, external, ...rest }) => (
        <RemixLink to={url} target={external ? "_blank" : undefined} {...rest}>
          {children}
        </RemixLink>
      )}
    >
      <AppProvider embedded apiKey={apiKey}>
        <s-app-nav>
          <s-link href="/app">MelCat Dash</s-link>
          <s-link href="/app/packs">Digital Packs</s-link>
          <s-link href="/app/assets">Assets & Storage</s-link>
          <s-link href="/app/drops">Content Drops</s-link>
          <s-link href="/app/qr-campaigns">QR Claims</s-link>
          <s-link href="/app/variant-mapping">Order Rules</s-link>
          <s-link href="/app/customers">Customers</s-link>
        </s-app-nav>
        <Outlet />
      </AppProvider>
    </PolarisAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
