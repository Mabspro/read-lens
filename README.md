# Read Lens

A local-first research helper built with Next.js 14 App Router.

## Setup

```powershell
npm install
cp .env.example .env.local
```

Then choose one of these paths:

- Free tier: leave API keys empty and use Extract Only mode.
- Local env tier: add `ANTHROPIC_API_KEY` to `.env.local`. Host enrichment is enabled by default in local development.
- BYOK tier: start the app and add a provider key in Settings for the current browser session.

Run the app with:

```powershell
npm run dev
```

## Optional environment variables

- ALLOW_HOST_ENRICHMENT: when 	rue, the host/server key may be used for enrichment
- ANTHROPIC_API_KEY: host/server enrichment key
- `NEXT_PUBLIC_ANALYTICS_ID`: enables anonymous PostHog usage events when users opt in
- `NEXT_PUBLIC_SUPPORT_TIP_URL`: Buy Me a Coffee or Ko-fi link
- `NEXT_PUBLIC_GITHUB_REPO_URL`: repo URL for the Star on GitHub CTA
- `NEXT_PUBLIC_GITHUB_SPONSORS_URL`: GitHub Sponsors URL

## What it does

- Sends all URLs to `/api/process` in one request
- Routes `x.com` and `twitter.com` links through the Twitter syndication extractor
- Routes other public URLs through Jina Reader, with `@extractus/article-extractor` as a low-content fallback
- Supports Extract Only, local env enrichment, or BYOK enrichment
- Supports Anthropic, OpenAI, Gemini, and Grok providers for AI analysis
- Renders either a clean extracted-source feed or a structured research memo with summaries, takeaways, follow-up questions, and research rails
- Includes a settings panel for provider selection, key testing, model override, and optional anonymous analytics

## Deployment

The app is ready for Vercel once the output quality looks good:

```powershell
vercel deploy
```



