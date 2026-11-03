# Frame.io V4 in GWS Studio

The review uses a native video player, version selection and timestamped comments backed by the Frame.io V4 API. No Frame.io iframe is embedded.

1. Complete [Vercel + Neon setup](VERCEL-SETUP.md), apply migrations and create a Studio team account.
2. In Adobe Developer Console create an OAuth Web App project with Frame.io API access. The Frame.io account needs Adobe authentication.
3. Register the exact HTTPS callback `<APP_ORIGIN>/api/frameio/callback`; store it in `FRAMEIO_REDIRECT_URI`. Use a stable branch URL if enabling OAuth in a preview.
4. Set `FRAMEIO_CLIENT_ID`, `FRAMEIO_CLIENT_SECRET` and a separate `SESSION_SECRET` in the intended Vercel environment. Do not put provider tokens in the browser or repository. Scopes: `openid email profile offline_access additional_info.roles`.
5. Log into the Studio, choose **Frame.io → Mit Adobe verbinden**, authorize access, then link an Editing task to a file or version stack.

Adobe authorization is separate from Studio authentication. The Frame.io connection is bound to the Better Auth user ID verified server-side. Incoming `oai-authenticated-*` headers have no authority on Vercel. Tokens are encrypted before storage in Neon; only file/account IDs are stored in browser-local task state.

Confirm the video frame rate before sending frame-accurate comments. Fractional frame rates use NDF for new comments; supported existing DF labels are parsed. Media URLs expire and are refreshed. Permissions, transcoding or DRM may prevent custom-player playback, in which case **In Frame.io öffnen** remains available.

After an uncertain write the app retains the draft and requires checking the remote result before retrying; the same request ID is not replayed automatically. API data refreshes while the review is open, with backoff for provider errors.

## Optional webhooks

Use the direct Vercel endpoint `/api/frameio/webhook` and set `FRAMEIO_WEBHOOK_SECRET` to Frame.io's signing key. The endpoint is exempt from Studio login and accepts only valid raw-body signatures within its time window; normal Frame.io API routes still require a verified Studio session. No separate Sites relay or private Sites service token is needed.

If Vercel Deployment Protection blocks third-party requests before they reach the function, configure an explicitly scoped supported bypass for webhook ingress or keep periodic refresh. Do not assume webhook delivery is active until tested. Suitable events include `file.ready`, `file.versioned`, `comment.created`, `comment.updated` and `comment.completed`.

## Current verification

Mocked API/auth/storage tests validate the transport and security boundaries. Live Adobe login, real Neon migrations and actual Frame.io review require the connected database, environment secrets, a Studio account and Adobe configuration. No credentials or live provider data are included.

Official docs:
- https://developer.frame.io/platform/docs/guides/authentication/overview
- https://developer.frame.io/platform/v4/docs/guides/media-links
- https://developer.frame.io/platform/api-reference/comments/create
