/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

import React from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      "s-link": React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement> & { href?: string };
    }
  }
}
