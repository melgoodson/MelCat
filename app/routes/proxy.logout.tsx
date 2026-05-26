import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { sessionStorage, getCustomerSession } from "../services/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getCustomerSession(request);
  
  return redirect("/apps/snarky/claim", {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}
