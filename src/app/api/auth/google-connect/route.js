// app/api/auth/google-connect/route.js
// Proxy route to initiate Google Calendar OAuth with authentication
import { getAccessToken } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

// Force dynamic rendering - this route uses cookies and cannot be statically generated
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    // Get access token with audience (required for API authentication)
    const audience = process.env.AUTH0_AUDIENCE;
    const { accessToken } = await getAccessToken({ 
      audience: audience 
    });
    
    if (!accessToken) {
      return NextResponse.json(
        { error: 'No access token available. Please ensure you are logged in and have AUTH0_AUDIENCE configured.' },
        { status: 401 }
      );
    }

    // Call backend to get Google OAuth URL
    // Backend will get user info from the token, so no need to pass email/username
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    const backendResponse = await fetch(`${backendUrl}/auth/google/url`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Backend error:', errorData);
      return NextResponse.json(
        { error: errorData.error || 'Failed to get Google OAuth URL' },
        { status: backendResponse.status }
      );
    }

    const { authUrl } = await backendResponse.json();

    if (!authUrl) {
      return NextResponse.json(
        { error: 'No auth URL returned from backend' },
        { status: 500 }
      );
    }

    // Redirect to Google OAuth consent screen
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('Error in google-connect route:', error.message);
    return NextResponse.json(
      { error: `Failed to connect Google Calendar: ${error.message}` },
      { status: 500 }
    );
  }
}
