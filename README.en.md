# dsh-widget-board

[中文](README.md)

A widget board plugin for DeepSeek Harness. It adds a "Board" entry to the sidebar and a page of cards you can drag and resize; each card renders one widget from the widget library.

- **Free layout**: the board switches between 1 and 4 columns by its own width, and every card keeps its own column span and height; a card shows its live size while you resize it from the corner, and changing the window width or collapsing the sidebar needs no re-arranging.
- **Three sources of widgets**: the built-in widgets in the package, your own under `$DSH_HOME/widget-board/widgets/`, and widgets that plugins register through the `widgetBoard` service. One format for all of them: a directory with `widget.json` plus `index.html`, `style.css` and an optional `main.js`.
- **State lives on the host**: a card's interface state and data are kept by the host, so they survive a panel switch, a page reload and a widget hot reload.
- **Follows the host's look**: colors, radii, durations and curves come from the host's tokens; switching light and dark or changing the skin updates the cards in place, together with the interface language.
- **Isolated**: every widget runs in its own sandboxed iframe with no access to your sessions, cookies or the network; widget documents carry a strict CSP, and images and fonts are inlined as `data:` addresses.

## Widget library

The button in the board header opens the library, grouped by source. Add a card from there and remove one from the card's top-right corner; a broken widget only takes itself out, and its card shows the reason.

To write a widget, create a directory under `$DSH_HOME/widget-board/widgets/<id>/` with `widget.json`, `index.html` and `style.css`, plus `main.js` when it needs a script. The host re-reads the library as the directory changes, and cards on open pages remount at the new version.

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
