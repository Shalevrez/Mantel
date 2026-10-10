# Mantel — notes for Claude

The app lives in `rami-online/` (see `rami-online/README.md`); run every npm
command from there.

## Typeface: Assistant, everywhere

The whole UI uses one font: **Assistant** (`@fontsource-variable/assistant`,
bundled and imported in `src/client/main.jsx` and `src/client/harness.jsx`).

- It is named in one place only: the `--font-ui` variable in `index.html`
  (and `harness.html`). Everything else uses `var(--font-ui)` in CSS or
  `fontFamily: 'inherit'` in inline styles.
- Don't add another font family, a font CDN link, or a hard-coded font name in
  new code. New buttons/inputs inherit (`fontFamily: 'inherit'`).
- Assistant's weights run 200–800; don't use 900.

## Icons: vectors, never emoji

Don't put emoji in new UI. Use the app's vector icons (`Icon` / `IconLabel`
from `src/client/icons.jsx`; add a new one there if none fits), or no icon at
all.
