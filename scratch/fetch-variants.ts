import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getVariants() {
  const session = await prisma.session.findFirst({
    where: { shop: 'snarky-cat-yvht7of7.myshopify.com' }
  });

  if (!session || !session.accessToken) {
    console.error("No active session found");
    process.exit(1);
  }

  const query = `
    query getProducts($query: String) {
      products(first: 20, query: $query) {
        nodes {
          title
          variants(first: 5) {
            nodes {
              id
              title
            }
          }
        }
      }
    }
  `;

  async function search(term: string) {
    const response = await fetch(`https://${session.shop}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': session.accessToken!,
      },
      body: JSON.stringify({ 
        query, 
        variables: { query: term } 
      }),
    });

    const body: any = await response.json();
    return body.data.products.nodes;
  }

  console.log("Searching for 'Tunnel' and 'Cube'...");
  const t = await search("Tunnel");
  const c = await search("Cube");

  const results = [...t, ...c].map(p => ({
    name: p.title,
    variants: p.variants.nodes.map((v: any) => ({
      title: v.title,
      id: v.id.split('/').pop()
    }))
  }));

  console.log(JSON.stringify(results, null, 2));
}

getVariants();
