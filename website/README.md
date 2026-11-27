# DrawBridge website

The public landing page for DrawBridge: product overview, how it works, a try-it demo, the team, and the waitlist.

Live at **https://drawbrdge.com**

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The whole page: nav, hero, Product, How it works, Demo, About, Waitlist, footer. Plain HTML, CSS and JS, no build step. |
| `assets/` | Logo, goblin sprites, demo reel, social preview image, favicon. |
| `api/waitlist.js` | Vercel serverless function for the waitlist. `POST` saves a signup, `GET` returns the count. |

The styling follows the dashboard and extension: dark charcoal panels, mint labels, the pixel-block score chart and castle-wall dividers.

## Waitlist storage

Signups are saved in an Upstash for Redis database connected through the Vercel Marketplace. Vercel provides `KV_REST_API_URL` and `KV_REST_API_TOKEN` as environment variables. Never commit them.

- `waitlist:emails` is the set of every email.
- `waitlist:entry:<email>` holds that person's role, school, source and join date.

## Run it locally

```bash
cd website
python3 -m http.server 5178
```

The waitlist API only runs on Vercel, or locally with `npx vercel dev`.

## Deploying

The site is a Vercel project. To deploy it from this repo, set the project's **Root Directory** to `website` in Vercel → Settings → Build and Deployment. This folder is listed in `.vscodeignore`, so it is never packaged into the extension.
