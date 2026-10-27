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

1. One glyph per cell. Each section is its own small program (`CHAPTERS` in `public/src/shaders.js`); during a transition the outgoing section draws below the rain front and the incoming one above it.
2. The glyphs at device resolution, from an atlas drawn with the page's own monospace font.

The first pass depends on the number of cells, about 90 rows on any screen, not on pixel density.

The page is built to open on any device:

- **Compiling**: programs compile on demand, a section before the reader reaches it. The page never waits for the compiler: it uses a program only once a fence shows the GPU has worked through it, and, where the browser supports `KHR_parallel_shader_compile`, once the browser reports the compile done.
- **The name**: it is analysed once per size on the CPU, so the opening reads one texel per cell.
- **Software rendering**: where WebGL runs on the CPU, because the GPU is blocked or absent, the glyphs are drawn at CSS resolution and the page draws at most 24 frames a second.
- **Pacing** (`public/src/pace.js`): the page never sends a frame while the GPU is still drawing the last one. A frame still drawing when the next one is due holds the next one back until twice its own time has passed, so a device that cannot keep up spends at most half its time on the picture. Devices that keep up stay at 60 frames a second.

`tools/bench.html` times compiling and drawing each section. To see how a computer without a GPU fares, run it in headless Chrome with `--disable-gpu --enable-unsafe-swiftshader`: WebGL then runs on the CPU and the browser composites on the CPU, as it would there.

`public/src/story.js` turns the scroll position into which sections are showing and where each one places its pieces; `public/src/text.js` holds every string the art draws.

To look at one moment without scrolling, run this in the browser console:

```js
const { still, ascii } = await import('/tools/inspect.js');
await still({ position: 2, time: 8 }); // section index (2.5 is mid-transition), seconds
ascii();                               // the same still as plain text
```

## Link previews and icons

Discord, Telegram, X and other apps that preview links read the Open Graph tags in `public/index.html`, never the script, so the English title and description there are the ones they show. The image is `public/card.png`, the opening's name in the dark theme. `tools/card.html` draws it with the page's own renderer: open it, save the PNG over `public/card.png`, and redeploy whenever the opening or the dark palette changes. Apps cache previews for a while; Telegram's @WebpageBot refreshes one on request.

The tab icon, `public/favicon.ico`, and the home-screen icon, `public/apple-touch-icon.png`, come from `tools/icons.html` the same way: the tab icon sets the lowercase `e` of `enco` on the dark paper with two concentric echo arcs in the accent colour, while the home-screen icon condenses a lowercase `e` out of the opening's falling ASCII rain with the page's own renderer.
