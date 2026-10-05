# Magazine Flipbook

A static, dependency-free flipbook website that reads the **WONCA EMR Newsletter**
as a real magazine: A4 cover and back cover shown alone, A3 interior pages shown
as full spreads, and every flip turns a single A4 leaf through the centre fold.

## How the pages work

Each visible page is one **A4 leaf** (portrait, 210 × 297). Interior spreads are
A3 landscape pages split down the middle into a left and a right leaf, so a full
spread always shows a complete A3 page.

```
view 1:  [ Cover ]                 (A4 alone)
view 2:  [ Page 2 | Page 3 ]       (one A3 spread)
view 3:  [ Page 4 | Page 5 ]       (one A3 spread)
...
view 8:  [ Back cover ]            (A4 alone)
```

## Updating the page images

1. Export the newsletter pages as PNGs (A4 portrait pages and A3 landscape
   spreads both work) into any folder, e.g. `~/Downloads/flipbook`.
2. Run:

   ```sh
   python3 tools/build_pages.py ~/Downloads/flipbook
   ```

   This splits A3 spreads at the centre, resizes every leaf to 1240 × 1754
   (A4 @ 150 dpi), writes them to `img/pages/pNN.jpg`, regenerates
   `img/cover.png`, and rewrites the manifest `js/pages.js`.

3. To offer the PDF download, replace `pdf/magazine.pdf` (and adjust
   `pdfPath` / `fileName` in `js/config.js` if the name changes).

Requires Python 3 with Pillow (`pip3 install Pillow`).

## Running locally

```sh
python3 -m http.server 8000
# open http://127.0.0.1:8000
```

## Deploying

The site is fully static — any static host works. `package.json` provides a
`serve` start command so Railway (Nixpacka) can run it directly:

```sh
railway up
```

## Structure

```
index.html          page shell
css/style.css       styling
js/config.js        title, subtitle, PDF download settings
js/pages.js         generated list of page images (build_pages.py)
js/app.js           flipbook logic
img/pages/          A4 leaf images (p01 … pNN)
pdf/magazine.pdf    optional download
tools/build_pages.py image pipeline
vendor/             PageFlip library
```

## Keyboard

- `←` / `→`, `PageUp` / `PageDown`, `Space` — turn pages
- `Home` / `End` — cover / back cover
- `F` — fullscreen
