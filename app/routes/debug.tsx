import { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const tiers = await prisma.tier.findMany();
    return new Response(JSON.stringify({ count: tiers.length, tiers, dbUrl: process.env.DATABASE_URL?.substring(0, 40) + "..." }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
