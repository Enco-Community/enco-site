# enco-site

The home page of [Enco](https://github.com/Darkatse/Enco): a static page drawn entirely in ASCII by WebGL2. The opening condenses the name out of a screen of falling characters; every later section has a picture of its own, and the next one rains in from the top as the page scrolls.

## Running it

```bash
python3 tools/serve.py
```

Then open <http://127.0.0.1:4173>. Everything the site serves is in `public/`, with no build step; `tools/` holds development aids and is never deployed.

## Deploying

The site runs on Cloudflare at <https://enco.sh>, as a Worker that only serves `public/`. It is deployed with the [Cloudflare CLI](https://developers.cloudflare.com/cf/) (`cf`); `cloudflare.config.ts` names the Worker and its domain, and `wrangler.config.ts`, which `cf` generates and uses to build static sites, points at `public/`.

Every push to `main` deploys through `.github/workflows/deploy.yml`, which needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Pull requests build and dry-run without them. To deploy by hand:

```bash
npm ci
npx cf auth login
npx cf build --mode production
npx cf deploy --prebuilt --mode production
```

## How the picture is made

`public/src/field.js` draws two passes each frame:

1. One glyph per cell. Each section is one function in `public/src/shaders.js` (`opening`, `plugins`, `generations`, `journal`, `mappers`, `shells`, `echoes`), and the pass runs the one or two that are showing.
2. The glyphs at device resolution, from an atlas drawn with the page's own monospace font.

The first pass depends on the number of cells, about 90 rows on any screen, not on pixel density.

`public/src/story.js` turns the scroll position into which sections are showing and where each one places its pieces; `public/src/text.js` holds every string the art draws.

To look at one moment without scrolling, run this in the browser console:

```js
const { still, ascii } = await import('/tools/inspect.js');
await still({ position: 2, time: 8 }); // section index (2.5 is mid-transition), seconds
ascii();                               // the same still as plain text
```
