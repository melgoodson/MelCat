import type { LoaderFunctionArgs } from "react-router";
import { sessionStorage, getCustomerSession } from "../services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getCustomerSession(request);
  const cookieHeader = await sessionStorage.destroySession(session);
  
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <script>
    localStorage.removeItem("melcat_vault_token");
    window.location.href = "/apps/snarky/claim";
  </script>
</head>
<body>
  <p>Signing out...</p>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        "Set-Cookie": cookieHeader,
      }
    }
  );
}
