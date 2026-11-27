# DrawBridge website

The public landing page for DrawBridge: product overview, how it works, a try-it demo, the team, downloads, and the waitlist.

Live at **https://drawbridge-lake.vercel.app**

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The whole page: nav, hero, Product, How it works, Demo, About, Download, Waitlist, footer. Plain HTML, CSS and JS, no build step. |
| `releases.json` | The latest desktop and extension versions, plus download URLs. `null` means that file is not published yet. The page loads this file. |
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

## Downloads

The Download section reads `releases.json`. Until a release exists, the desktop version is `0.1.0`, the extension version is `0.0.1`, and the Windows and VSIX buttons say they are not published. macOS stays "coming soon" while `desktop.mac` is null.

Installers are not stored in this folder. `npm run publish:desktop` from the repository root uploads the Windows installer and the VSIX to a GitHub release, then fills in the URLs here. Commit the updated `releases.json` and push so Vercel shows the new version. A Mac build is produced on a Mac and linked by setting `desktop.mac`.
