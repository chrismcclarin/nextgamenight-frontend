# Vercel Environment Variables Setup Guide

## How to Add Environment Variables in Vercel

1. **Go to your Vercel project dashboard**
2. **Click on your project** (gamecalendarfrontend)
3. **Go to Settings** → **Environment Variables**
4. **Add each variable** using the "Add New" button
5. **Select the environment** (Production, Preview, Development - or all)
6. **Click "Save"**

## Required Environment Variables

### Auth0 Configuration
These are required for authentication to work:

```
AUTH0_SECRET
```
- A long, random string used to encrypt cookies
- Generate one with: `openssl rand -hex 32`
- Or use: `https://generate-secret.vercel.app/32`

```
AUTH0_BASE_URL
```
- Your Vercel deployment URL
- Format: `https://your-app-name.vercel.app`
- Or your custom domain if you have one
- Example: `https://gamecalendarfrontend.vercel.app`

```
AUTH0_ISSUER_BASE_URL
```
- Your Auth0 domain
- Format: `https://YOUR_AUTH0_DOMAIN.auth0.com`
- Example: `https://dev-xxxxx.us.auth0.com`
- This is the same as `AUTH0_DOMAIN` in your backend

```
AUTH0_CLIENT_ID
```
- Your Auth0 application Client ID
- Found in Auth0 Dashboard → Applications → Your App → Settings
- This should match your frontend Auth0 application

```
AUTH0_CLIENT_SECRET
```
- Your Auth0 application Client Secret
- Found in Auth0 Dashboard → Applications → Your App → Settings
- Click "Show" to reveal it
- This should match your frontend Auth0 application

```
AUTH0_AUDIENCE
```
- Your Auth0 API identifier
- Found in Auth0 Dashboard → APIs → Your API → Settings
- This should match the `AUTH0_AUDIENCE` in your backend
- Example: `https://your-api-identifier`

### Backend API Connection

```
NEXT_PUBLIC_API_URL
```
- Your Railway backend URL
- Format: `https://your-backend-name.railway.app/api`
- Or your custom domain if you have one
- **Important**: Must start with `https://` for production
- Example: `https://your-backend-production.up.railway.app/api`
- **Note**: Get this from your Railway dashboard → Your service → Settings → Domains

### Optional: Sentry Error Tracking

```
NEXT_PUBLIC_SENTRY_DSN
```
- Your Sentry DSN (if using Sentry)
- Found in Sentry Dashboard → Settings → Projects → Your Project → Client Keys (DSN)
- Only needed if you want error tracking

```
SENTRY_ORG
```
- Your Sentry organization slug
- Found in Sentry Dashboard → Settings → Organization Settings

```
SENTRY_PROJECT
```
- Your Sentry project slug
- Found in Sentry Dashboard → Settings → Projects → Your Project → Settings

## How to Get Your Railway Backend URL

1. **Go to Railway dashboard**
2. **Click on your backend service**
3. **Go to Settings** → **Networking**
4. **Find "Public Domain"** or **"Custom Domain"**
5. **Copy the URL** (should look like: `https://your-backend-production.up.railway.app`)
6. **Add `/api` to the end** for `NEXT_PUBLIC_API_URL`
   - Example: `https://your-backend-production.up.railway.app/api`

## Important Notes

1. **NEXT_PUBLIC_ prefix**: Variables starting with `NEXT_PUBLIC_` are exposed to the browser. Only use this prefix for variables that are safe to expose publicly.

2. **AUTH0_BASE_URL**: This must match your Vercel deployment URL. If you change your domain, update this.

3. **After adding variables**: Vercel will automatically trigger a new deployment. You may need to manually redeploy if it doesn't.

4. **Testing**: After deployment, test the login flow to ensure Auth0 is working correctly.

## Quick Checklist

- [ ] AUTH0_SECRET (generate a random string)
- [ ] AUTH0_BASE_URL (your Vercel URL)
- [ ] AUTH0_ISSUER_BASE_URL (your Auth0 domain)
- [ ] AUTH0_CLIENT_ID (from Auth0 dashboard)
- [ ] AUTH0_CLIENT_SECRET (from Auth0 dashboard)
- [ ] AUTH0_AUDIENCE (your Auth0 API identifier)
- [ ] NEXT_PUBLIC_API_URL (your Railway backend URL + /api)
- [ ] NEXT_PUBLIC_SENTRY_DSN (optional, if using Sentry)
- [ ] SENTRY_ORG (optional, if using Sentry)
- [ ] SENTRY_PROJECT (optional, if using Sentry)

## Troubleshooting

### "Invalid redirect URI" error
- Make sure `AUTH0_BASE_URL` matches your Vercel URL exactly
- Add your Vercel URL to Auth0 Dashboard → Applications → Your App → Settings → Allowed Callback URLs
- Format: `https://your-app.vercel.app/api/auth/callback`

### "API calls failing"
- Check that `NEXT_PUBLIC_API_URL` is correct and includes `/api`
- Make sure your Railway backend is running and accessible
- Verify CORS is configured correctly on your backend

### "Authentication not working"
- Verify all Auth0 environment variables are set correctly
- Check that `AUTH0_AUDIENCE` matches between frontend and backend
- Ensure Auth0 application settings allow your Vercel domain
