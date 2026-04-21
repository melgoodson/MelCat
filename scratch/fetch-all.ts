import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const sessions = await prisma.session.findMany();

  for (const s of sessions) {
    console.log(`\n=== STORE: ${s.shop} ===`);
    const query = JSON.stringify({
      query: `
        {
          products(first: 100) {
            nodes {
              title
              variants(first: 50) {
                nodes {
                  id
                  title
                }
              }
            }
          }
        }
      `
    });

    const response = await fetch(`https://${s.shop}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': s.accessToken,
      },
      body: query
    });

    const body: any = await response.json();
    if (body.data && body.data.products) {
      body.data.products.nodes.forEach((p: any) => {
        console.log(`Product: ${p.title}`);
        p.variants.nodes.forEach((v: any) => {
          const numericId = v.id.split('/').pop();
          console.log(`  - ${v.title}: ${numericId}`);
        });
      });
    } else {
      console.log(`  (No data or error: ${JSON.stringify(body.errors || body)})`);
    }
  }
}

main();
