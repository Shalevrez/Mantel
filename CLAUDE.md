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

No emoji anywhere in the UI — not in new code, release notes, rules, buttons
or messages. Use the app's vector icons (`Icon` / `IconLabel` from
`src/client/icons.jsx`; add a new one there if none fits), or no icon at all.

- Release notes (`src/releases.js`) name their icon: `icon: 'dice'`, a key of
  `ICONS` in `icons.jsx`.
- Strings built by the game engine may carry an emoji only if `TEXT_ICONS` in
  `icons.jsx` swaps it for a vector, and they must be rendered through
  `IconText`.
- `tests/no-emoji.mjs` (part of `npm test`) enforces this; card suits ♠♥♦♣
  and the joker ★ are card faces and allowed.
