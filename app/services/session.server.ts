import { createCookieSessionStorage } from 'react-router';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: '__snarky_customer',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secrets: [SESSION_SECRET],
    secure: process.env.NODE_ENV === 'production',
  },
});

export async function getCustomerSession(request: Request) {
  const cookie = request.headers.get('Cookie');
  return sessionStorage.getSession(cookie);
}

export async function requireCustomerId(request: Request, redirectTo: string = '/proxy/claim') {
  const session = await getCustomerSession(request);
  const customerId = session.get('customerId');
  
  if (!customerId) {
    throw new Response('Unauthorized', {
      status: 302,
      headers: { Location: redirectTo }
    });
  }
  return customerId;
}
