# Skeleton

Minimalist PDF book previewer for Webflow. Drop a PDF, get a paste-ready embed snippet.

## Quick use

| Step | What |
|---|---|
| 1 | Upload the PDF to your byoung.co Webflow site |
| 2 | Open `configurator.html` in a browser |
| 3 | Drop the PDF file into the drop zone (for live preview) |
| 4 | Type the path of the PDF on byoung.co (e.g. `book.pdf`); the configurator prepends `https://www.byoung.co/` |
| 5 | Adjust slug, toggles, theme, project details |
| 6 | Click **Copy snippet** |
| 7 | Paste into an HTML Embed component on a Webflow page at `/skeleton/{slug}` |

The drop zone is for previewing locally; the snippet always uses the byoung.co URL.

## One-time setup

The published embed loads `preview-engine.js` from a pinned jsDelivr URL backed by a public GitHub repo. Set up the repo once:

```
# from this directory
git init
git add configurator.html preview-engine.js README.md
git commit -m "v1.0.0"
git remote add origin git@github.com:YOUR_USER/skeleton.git
git push -u origin main
git tag v1.0.0
git push --tags
```

Then edit `configurator.html` and set `GH_USER` near the top of the inline script to your GitHub username. Save.

The pinned URL is:
```
https://cdn.jsdelivr.net/gh/YOUR_USER/skeleton@v1.0.0/preview-engine.js
```

It is immutable. Pasted snippets keep working forever at that tag.

## Updating the runtime

Edit `preview-engine.js`, then:

```
git add preview-engine.js
git commit -m "v1.1.0: <what changed>"
git tag v1.1.0
git push && git push --tags
```

Update `GH_TAG` in `configurator.html` to `v1.1.0`. New snippets reference the new tag. Old snippets keep using their original tag.

## Hosting the configurator

| Option | URL | Setup |
|---|---|---|
| Local file | `file:///.../configurator.html` | None. Some browsers block fetching the PDF URL from `file://`; run a local server if so: `python3 -m http.server` |
| GitHub Pages, subdomain | `skeleton.byoung.co` | Enable Pages on the repo, add a CNAME record |
| GitHub Pages, default | `YOUR_USER.github.io/skeleton/configurator.html` | Enable Pages on the repo |

## Files

| File | Role |
|---|---|
| `configurator.html` | The tool. Open in browser. Inline CSS + JS. Loads PDF.js and preview-engine.js |
| `preview-engine.js` | The runtime. Same file used by the local preview and by all published embeds via jsDelivr |
| `README.md` | This file |

## How the embed works

The clipboard snippet:

| Part | Inline? |
|---|---|
| Container HTML and ARIA structure | Yes |
| Scoped CSS keyed by slug | Yes |
| Config (PDF URL, slug, toggles, theme) | Yes |
| PDF.js library | No, loaded from cdnjs |
| Fonts (Inter, JetBrains Mono) | No, loaded from Google Fonts |
| Runtime (preview-engine.js) | No, loaded from jsDelivr at a pinned tag |

Webflow's HTML Embed component is limited to 50,000 characters. The configurator shows a live count and disables Copy if you go over.

## Constraints worth knowing

| Concern | Behavior |
|---|---|
| Cross-origin PDF | The PDF URL must allow CORS for the Webflow domain. Webflow asset URLs are fine |
| Mobile | Force single-page mode under 768px viewport. Swipe + tap zones |
| Reduced motion | Page transitions become instant when the OS setting is on |
| Multiple embeds | Supported via slug scoping. Same slug twice on one page collides; pick unique slugs |
| Project details | Optional rich-text field in the configurator. Shows behind a DETAILS tab in the chrome bar. Hidden if empty. Allowed tags: h2-h4, p, strong, em, a, ul, ol, li, blockquote, code, hr, br. Persisted per-tab choice in sessionStorage |

## Known limits

| Limit | Note |
|---|---|
| PDF size | No hard cap in code. Above ~50MB, mobile load times grow noticeably |
| Configurator on mobile | Functional on tablet (768px+). Phone is not a target |
| Browser support | Modern Chromium, Firefox, Safari. ResizeObserver and AbortController required |
