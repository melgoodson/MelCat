import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function getVariants() {
  const sessions = await prisma.session.findMany();

  for (const session of sessions) {
    console.log(`--- Store: ${session.shop} ---`);
    if (!session.accessToken) continue;

    const query = '{ products(first: 250) { nodes { title variants(first: 50) { nodes { id title } } } } }';
    try {
      const resp = await fetch('https://' + session.shop + '/admin/api/2026-07/graphql.json', { 
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json', 
          'X-Shopify-Access-Token': session.accessToken 
        }, 
        body: JSON.stringify({ query }) 
      });
      const body: any = await resp.json();
      if (body.data) {
        body.data.products.nodes.forEach((p: any) => {
          console.log(`Product: ${p.title}`);
          p.variants.nodes.forEach((v: any) => {
            console.log(`  - ${v.title} (ID: ${v.id.split('/').pop()})`);
          });
        });
      }
    } catch (e) {
      console.error(`Error fetching from ${session.shop}`);
    }
  }
}

getVariants();
