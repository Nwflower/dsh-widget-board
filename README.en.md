# dsh-widget-board

[中文](README.md)

A widget board plugin for DeepSeek Harness. It adds a "Board" entry to the sidebar and a set of card boards you can drag and resize, with a tab strip at the top that switches between them; each card renders one widget from the widget library.

- **Several boards**: a tab strip at the top switches between boards and its pill slides to the active one; the strip holds a single New entry, while renaming, removing and selecting live in a Board section in settings. Every board's cards stay mounted, so switching remounts nothing and the boards you cannot see stay paused; each board keeps its own cards, boxes and revisions, and an older single board is carried over as the first one when it opens.
- **Free layout**: the board switches between 1 and 4 columns by its own width, and every card keeps its own column span and height; height snaps to 6/10/14/18/22/26/30 rem and vertical positions snap to 2 rem, a card shows its live size while you resize it from the corner, and changing the window width or collapsing the sidebar needs no re-arranging.
- **The masthead is a card**: the title, tagline and type specimen of a living board live in the built-in `board-hero` widget, so they can be dragged, resized and removed; an older board gets the card once on upgrade, and Add lives in the bottom menu.
- **Bottom menu**: the centred plus at the bottom splits into a fan of three icon actions for Add, Tidy and Refresh. The fill, bridges and shadow live in one SVG goo filter; the actions spring out 40 ms apart, the plus turns 45°, and closing drops the whole shape 5 px before it settles. Add opens a floating widget library laid out as a grid of live thumbnails; hold a tile and drop it on any column, or tap to add at the end. Tidy compacts every card in reading order. Refresh makes the host re-read the library and remount the cards.
- **Generic data cards**: stat, list, table, chart, progress, key-value, timeline and image ship in the library; they share the `.t-data` skeleton, data fills the content, props change the headings, and the board owns the card size.
- **Markdown and code**: the Markdown card typesets GFM and highlights fenced code by language; marked and highlight ship with the plugin, are inlined into the document, and the widget stays offline.
- **Flip group (prototype)**: two ordinary cards, one per side, share one card box and flip on hover; fixed to stat and chart for now, added from the library and removed as a group.
- **Three motion templates**: flip, magnetic and holographic cards sit in the library; add one and change the copy through props. The runtime suite owns the motion and pointer behaviour, so the template carries no event code.
- **Three sources of widgets**: the built-in widgets in the package, your own under `$DSH_HOME/widget-board/widgets/`, and widgets that plugins register through the `widgetBoard` service. One format for all of them: a directory with `widget.json` plus `index.html`, `style.css` and an optional `main.js`.
- **State lives on the host**: a card's interface state and data are kept by the host, so they survive a panel switch, a page reload and a widget hot reload.
- **Notifications and unread count**: a widget calls `widget.notify(...)`; the Board entry in the sidebar slides in an unread count with the notification-badge transition, and clicking the entry clears it.
- **Follows the host's look**: colors, radii, durations and curves come from the host's tokens; switching light and dark or changing the skin updates the cards in place, together with the interface language.
- **Isolated**: every widget runs in its own sandboxed iframe with no access to your sessions, cookies or the network; widget documents carry a strict CSP, and images and fonts are inlined as `data:` addresses.

## Widget library

The Add action in the bottom menu opens the library, grouped by source and laid out as a grid. Each tile is a live thumbnail of the widget itself. Hold a tile, drop it on the board and the card lands in that column; tap a tile to add at the shortest column. Remove a card from its top-right corner; a broken widget only takes itself out, and its card shows the reason.

To write a widget, create a directory under `$DSH_HOME/widget-board/widgets/<id>/` with `widget.json`, `index.html` and `style.css`, plus `main.js` when it needs a script. The host re-reads the library as the directory changes, and cards on open pages remount at the new version.

The board owns the card box. The runtime sorts the content box on two axes: `data-box-width` is `narrow`, `regular` or `wide`, and `data-box-height` is `short`, `regular` or `tall`; it also exposes `--w-w`, `--w-h` and `--w-cols`. Use these to hide or reveal content as the card changes. `minBox` in `widget.json` is the card's lower bound: dragging and resizing stop there. Spacing and type sizes come from `--w-space-*` and `--w-type-*`; the suite adds `.w-frame`, `.w-actions` and `.w-scroll` layout primitives plus `.w-hide-short` and `.w-hide-narrow` for size-based hiding. Library thumbnails carry `data-placement="preview"` and `data-size="preview"`, so a widget can switch to a static layout there.

When a widget has something to announce, it calls `widget.notify({ title, body })`; the title falls back to the widget title, the body is optional, and the two are capped at 120 and 400 characters. Notifications land on the Board entry in the sidebar: hover reads the latest title and body, and clicking the entry marks them read.

### Adding motion to a widget

Flip, magnetic and holographic are optional runtime-suite effects; the card shell never applies them by itself. To flip a widget, put `.t-flip-card` and `data-t-flip` on the outer element, `.t-flip-card__inner` inside it, one `.t-flip-card__face` per side and `.t-flip-card__back` on the back. Use `.t-magnetic` with `data-t-magnetic` for the magnetic effect and `.t-holo` with `data-t-holo` for the holographic one. The suite owns the pointer and keyboard behaviour; the widget only draws its own artwork. The built-in `flip-card`, `magnetic-card` and `holographic-card` are copyable examples.

## For plugin providers

The host half publishes the cordis service `widgetBoard` (`WIDGET_BOARD_API_VERSION = 1`):

- `registerWidgetType({ apiVersion, provider, directory })` registers a widget directory and returns a disposer.
- `registerDataSource({ apiVersion, id, read })` registers a data source a card can bind to.
- `registerAction({ apiVersion, id, run })` registers an action.

The browser half publishes the same service; `registerWidgetType({ apiVersion, provider, id, component })` registers a React component, and once it matches a library widget by id the card renders it with the same parameters as `window.widget`. A provider never imports this plugin at runtime: declare the same shape in its own package with a `declare module` block and negotiate by `apiVersion`.

## Status

In development, not yet released. Session tools, inline display, the right sidebar and widget sharing are still to come.

## License

MIT
