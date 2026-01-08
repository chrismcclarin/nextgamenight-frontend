# Fixing Auth0 Login Error on Vercel

## Error: "This page isn't working" after clicking Google sign-in

This error typically means Auth0 can't redirect back to your Vercel app after authentication.

## Quick Fix Steps

### 1. Get Your Exact Vercel URL
- Go to Vercel → Your project → Settings → Domains
- Copy your production domain (e.g., `gamecalendarfrontend-7gj3b3596-chrismcclarins-projects.vercel.app`)
- Or use your custom domain if you have one

### 2. Update Vercel Environment Variables
- Go to Vercel → Settings → Environment Variables
- Find `AUTH0_BASE_URL`
- Make sure it matches your Vercel URL exactly:
  ```
  https://gamecalendarfrontend-7gj3b3596-chrismcclarins-projects.vercel.app
  ```
- **Important**: Must include `https://` and no trailing slash
- Save and redeploy

### 3. Update Auth0 Application Settings
- Go to Auth0 Dashboard → Applications → Your Frontend App → Settings
- Scroll to "Application URIs"

**Allowed Callback URLs** - Add:
```
https://gamecalendarfrontend-7gj3b3596-chrismcclarins-projects.vercel.app/api/auth/callback
```

**Allowed Logout URLs** - Add:
```
https://gamecalendarfrontend-7gj3b3596-chrismcclarins-projects.vercel.app
```

**Allowed Web Origins** - Add:
```
https://gamecalendarfrontend-7gj3b3596-chrismcclarins-projects.vercel.app
```

**Allowed Origins (CORS)** - Add:
```
https://gamecalendarfrontend-7gj3b3596-chrismcclarins-projects.vercel.app
```

- Click "Save Changes"

### 4. Redeploy Vercel
- After updating environment variables, Vercel should auto-redeploy
- Or manually trigger: Deployments → ... → Redeploy

### 5. Test Again
- Try logging in again
- Should redirect properly after Google authentication

## Common Issues

### Issue: Still getting error after updates
**Solution**: 
- Clear browser cookies for your Vercel domain
- Try in incognito/private window
- Check Vercel function logs for specific errors

### Issue: "Invalid redirect URI" error
**Solution**:
- Double-check `AUTH0_BASE_URL` matches your Vercel URL exactly
- Verify callback URL in Auth0 matches: `{AUTH0_BASE_URL}/api/auth/callback`
- Make sure there are no typos or extra spaces

### Issue: Works locally but not on Vercel
**Solution**:
- Local uses `http://localhost:3000`
- Vercel uses `https://your-domain.vercel.app`
- Make sure `AUTH0_BASE_URL` is set to the Vercel URL (not localhost)

## Verification Checklist

- [ ] `AUTH0_BASE_URL` in Vercel = Your exact Vercel URL (with https://)
- [ ] `AUTH0_ISSUER_BASE_URL` = Your Auth0 domain (e.g., `https://dev-xxxxx.us.auth0.com`)
- [ ] `AUTH0_CLIENT_ID` = Your Auth0 frontend app Client ID
- [ ] `AUTH0_CLIENT_SECRET` = Your Auth0 frontend app Client Secret
- [ ] `AUTH0_SECRET` = A random string (generated)
- [ ] Callback URL added to Auth0: `{AUTH0_BASE_URL}/api/auth/callback`
- [ ] Logout URL added to Auth0: `{AUTH0_BASE_URL}`
- [ ] Web Origins added to Auth0: `{AUTH0_BASE_URL}`
- [ ] Vercel has been redeployed after environment variable changes

## Getting Help

If still not working:
1. Check Vercel Function Logs for specific error messages
2. Check browser console for errors
3. Verify all environment variables are set correctly
4. Make sure Auth0 application type is "Regular Web Application" (not SPA)
