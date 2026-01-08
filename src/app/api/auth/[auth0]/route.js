import { handleAuth } from '@auth0/nextjs-auth0';

// Force dynamic rendering - Auth0 routes use cookies and cannot be statically generated
export const dynamic = 'force-dynamic';

export const GET = handleAuth();