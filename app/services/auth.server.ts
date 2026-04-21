import prisma from '../db.server';
import crypto from 'crypto';

export async function createMagicLinkToken(email: string) {
  let customer = await prisma.customer.findUnique({ where: { email } });
  
  if (!customer) {
    customer = await prisma.customer.create({ data: { email } });
  }

  const token = crypto.randomBytes(32).toString('hex');
  
  await prisma.emailLoginToken.create({
    data: {
      customerId: customer.id,
      tokenHash: token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 15), // 15 mins
    }
  });

  return token;
}

export async function consumeMagicLinkToken(token: string) {
  const record = await prisma.emailLoginToken.findUnique({
    where: { tokenHash: token },
    include: { customer: true }
  });

  if (!record || record.used || new Date() > record.expiresAt) {
    throw new Error('Invalid or expired token.');
  }

  await prisma.emailLoginToken.update({
    where: { id: record.id },
    data: { used: true }
  });

  return record.customer;
}
