// app/api/auth/token/route.js
// Endpoint to get Auth0 access token for API calls
import { getAccessToken } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

// Force dynamic rendering - this route uses cookies and cannot be statically generated
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    // Get access token with audience (required for API authentication)
    // AUTH0_AUDIENCE must be set in .env.local for this to work
    const audience = process.env.AUTH0_AUDIENCE;
    const { accessToken } = await getAccessToken({ 
      audience: audience 
    });
    
    if (!accessToken) {
      return NextResponse.json(
        { error: 'No access token available. Please ensure you are logged in and have AUTH0_AUDIENCE configured in .env.local.' },
        { status: 401 }
      );
    }
    
    return NextResponse.json({ accessToken });
  } catch (error) {
    console.error('Error getting access token:', error.message);
    return NextResponse.json(
      { error: `Failed to get access token: ${error.message}` },
      { status: 500 }
    );
  }
}

