# dsh-widget-board

[中文](README.md)

A widget board plugin for DeepSeek Harness: a "Board" entry in the sidebar and a set of card boards you can drag and resize, where every card is a small widget. You or the agent in a session write a widget as three files, and other plugins can provide widgets too.

**[Live demo](https://nwflower.github.io/dsh-widget-board/)** · [Install](#install) · [Get started](#get-started) · [Write a widget](#widget-library) · [For plugin providers](#for-plugin-providers)

<p align="center">
  <img src="docs/images/board-light.png" alt="The widget board in light mode" width="49%">
  <img src="docs/images/board-dark.png" alt="The widget board in dark mode" width="49%">
</p>

## Three things to know

1. **A widget is three files.** `widget.json` names it and sizes it, next to `index.html` and `style.css`, plus `main.js` when it needs a script. Built-in widgets, your own and agent-written ones share one format, so once the agent has written the files the card appears in the library.
2. **A sandbox, with permissions bound to content.** Every widget runs in its own sandboxed iframe with a strict CSP: no network, and it talks to the host only over a MessagePort bridge. A grant is bound to the hash of the widget's content, so changing one byte drops every earlier grant until a person allows it again.
3. **Other plugins can provide widgets.** Plugins register widget directories, data sources, actions and host capabilities through the `widgetBoard` service, and each registration carries an `apiVersion` for negotiation. When a provider is unplugged, its cards stay in place and show a placeholder.

## Live demo

The first screen of the [demo page](https://nwflower.github.io/dsh-widget-board/) is the plugin's real browser half, with every card running in a sandboxed iframe. Things to try:

- Drag the handle at the top of a card to move it, drag the corner to resize it.
- Hover a flip card to turn it.
- Switch between light and dark with the button at the top right, and between Chinese and English with the language switch.
- Reload the page; the layout is still there, because it is stored in your browser.

The demo host is read-only and has no data sources or host capabilities, so the Weather and DSH balance cards are left out; with the plugin installed they are in the library. Further down the page there is a recording, a diagram for each of the three points above and the install command.

## Install

Not on npm yet, so install it from the GitHub repository:

```sh
dsh plugin add github:Nwflower/dsh-widget-board
```

`lib/` is a build artifact and is never committed, so the package builds itself once at install time (`prepare` runs `node scripts/build.mjs`). pnpm blocks dependency build scripts by default and will stop the first install: approve it with "Allow build scripts and retry" in the plugin market, or add the `allowBuilds` line pnpm prints to the profile's `pnpm-workspace.yaml` and retry.

When working from a checkout, build it first and install by directory:

```sh
npm install
npm run build
dsh plugin add <path to this repository>
```

## Get started

1. After installing, open Board in the sidebar. The first launch shows a default board that is already filled with cards.
2. Click the plus at the bottom centre and choose Add to open the library: hold a tile and drop it on any column, or tap it to add at the shortest column.
3. Click the gear in a card's top-right corner to change the widget's props, fill in credentials, and review and grant data sources and permissions.
4. Write your own widget under `$DSH_HOME/widget-board/widgets/<id>/`; cards on open pages switch to the new version when you save. See the [widget library](#widget-library) for the format.

## Features

### Board

- **Several boards**: a tab strip at the top switches between boards and its pill slides to the active one; the strip holds a single New entry, while renaming, removing and selecting live in a Board section in settings. Every board's cards stay mounted, so switching remounts nothing and the boards you cannot see stay paused; each board keeps its own cards, boxes and revisions, and an older single board is carried over as the first one when it opens.
- **Free layout**: the board switches between 1 and 4 columns by its own width, and every card keeps its own column span and height; height snaps to 6/10/14/18/22/26/30 rem and vertical positions snap to 2 rem, a card shows its live size while you resize it from the corner, and changing the window width or collapsing the sidebar needs no re-arranging.
- **The masthead is a card**: the title, tagline and type specimen of a living board live in the built-in `board-hero` widget, so they can be dragged, resized and removed; an older board gets the card once on upgrade, and Add lives in the bottom menu.
- **Bottom menu**: the plus centred at the bottom of the board column splits into a fan of three icon actions for Add, Tidy and Refresh. Add opens a floating widget library; Tidy compacts every card in reading order; Refresh makes the host re-read the library and remount the cards.
- **Windows desktop**: when the window reserves its caption row and the strip fits, it sits at the left of that row, a size smaller than in the page with air above and below, and the board starts right below; when it does not fit, or outside the desktop, the strip stays at the top of the page.
- **State lives on the host**: a card's interface state and data are kept by the host, so they survive a panel switch, a page reload and a widget hot reload.
- **Notifications and unread count**: a widget calls `widget.notify(...)`; the Board entry in the sidebar slides in an unread count, and clicking the entry clears it.

### Built-in widgets

- **Generic data cards**: stat, list, table, chart, progress, key-value, timeline and image ship in the library; they share the `.t-data` skeleton, data fills the content, props change the headings, and the board owns the card size.
- **Time and density**: a flip clock, ring gauges and a heatmap; the clock flips hours and minutes cell by cell with running seconds alongside, the gauges show quotas and goals as rings, and the heatmap lays out daily cells with totals, active days and a streak.
- **Calendar and diff**: the calendar lays a month out in seven columns, dots the days that have plans, and steps to another month or back to today; the diff card prints a unified diff line by line with add and remove signs, and file paths stand on their own line.
- **Markdown and code**: the Markdown card typesets GFM and highlights fenced code by language; marked and highlight ship with the plugin, are inlined into the document, and the widget stays offline.
- **Flip group**: two ordinary cards, one per side, share one card box and flip on hover; adding one from the library opens its slot strip, so you choose the widget for each side. Replacing one resets that slot's props, data and state, leaves the other slot alone, and raises the group's minimum box to the larger of the two.
- **Three motion templates**: flip, magnetic and holographic cards; add one and change the copy through props. The runtime suite owns the motion and pointer behaviour, so the template carries no event code.

### Settings, data and capabilities

- **Card settings**: the gear beside Remove in the card's top-right corner opens a settings modal with four sections: Widget settings, Credentials, Data and permissions, and About. Props render from the widget's own schema and the host validates them against the same schema on save; credentials are written to the host's credential service and never enter board files, exports or tool output; data sources, permissions and Allow / Revoke live here too.
- **Host capabilities**: a widget declares the capabilities it uses in its manifest and calls them with `widget.call`; plugins register capabilities, the host validates arguments and results against JSON Schema, and one with a permission needs a person's grant first. The built-in DSH balance card declares `dsh.account.balance` and reads the recharge and bonus wallets of the signed-in DSH account; no API key needed.
- **Three sources of widgets**: the built-in widgets in the package, your own under `$DSH_HOME/widget-board/widgets/`, and widgets that plugins register through the `widgetBoard` service. One format for all of them: a directory with `widget.json` plus `index.html`, `style.css` and an optional `main.js`.

### Look and safety

- **Follows the host's look**: colors, radii, durations and curves come from the host's tokens; switching light and dark or changing the skin updates the cards in place, together with the interface language.
- **Isolated**: every widget runs in its own sandboxed iframe with no access to your sessions, cookies or the network; widget documents carry a strict CSP, and images and fonts are inlined as `data:` addresses.

## Widget library

The Add action in the bottom menu opens the library, grouped by source and laid out as a grid. Each tile is a live thumbnail of the widget itself. Hold a tile, drop it on the board and the card lands in that column; tap a tile to add at the shortest column. Remove a card from its top-right corner; a broken widget only takes itself out, and its card shows the reason.

To write a widget, create a directory under `$DSH_HOME/widget-board/widgets/<id>/` with `widget.json`, `index.html` and `style.css`, plus `main.js` when it needs a script. The host re-reads the library as the directory changes, and cards on open pages remount at the new version.

`widget.json` can also declare `credentials`: the settings modal shows a key field for each, the host's credential service stores the value, and the widget cannot read it or write it into board files. A `source` of `provider:name` names a data source a plugin registered; props field labels and hints go in `text` under `props.<field>.label` and `props.<field>.hint`.

The board owns the card box. The runtime sorts the content box on two axes: `data-box-width` is `narrow`, `regular` or `wide`, and `data-box-height` is `short`, `regular` or `tall`; it also exposes `--w-w`, `--w-h` and `--w-cols`. Use these to hide or reveal content as the card changes. `defaultBox` in `widget.json` is the box a new card gets, and `minBox` is its lower bound: dragging and resizing stop there. Spacing and type sizes come from `--w-space-*` and `--w-type-*`; status colors read `--w-tone-ok`, `--w-tone-warn`, `--w-tone-danger` and `--w-tone-idle`, paired with a `.w-sr` line so color is not the only signal. The suite adds `.w-frame`, `.w-actions` and `.w-scroll` layout primitives plus `.w-hide-short` and `.w-hide-narrow` for size-based hiding. Library thumbnails carry `data-placement="preview"` and `data-size="preview"`, so a widget can switch to a static layout there.

When a widget has something to announce, it calls `widget.notify({ title, body })`; the title falls back to the widget title, the body is optional, and the two are capped at 120 and 400 characters. Notifications land on the Board entry in the sidebar: hover reads the latest title and body, and clicking the entry marks them read.

### Adding motion to a widget

Flip, magnetic and holographic are optional runtime-suite effects; the card shell never applies them by itself. To flip a widget, put `.t-flip-card` and `data-t-flip` on the outer element, `.t-flip-card__inner` inside it, one `.t-flip-card__face` per side and `.t-flip-card__back` on the back. Use `.t-magnetic` with `data-t-magnetic` for the magnetic effect and `.t-holo` with `data-t-holo` for the holographic one. The suite owns the pointer and keyboard behaviour; the widget only draws its own artwork. The built-in `flip-card`, `magnetic-card` and `holographic-card` are copyable examples.

## For plugin providers

The host half publishes the cordis service `widgetBoard` (`WIDGET_BOARD_API_VERSION = 3`):

- `registerWidgetType({ apiVersion, provider, directory })` registers a widget directory and returns a handle with `provider`, `widgets`, `register({ dataSources, actions, capabilities })` and `dispose()`. Data sources, actions and capabilities live under that provider's registration and are released with it.
- `registerDataSource({ apiVersion, provider, id, read, permission? })` registers a data source a card can bind to; one with a `permission` needs a person's grant before it reads.
- `registerAction({ apiVersion, provider, id, run, permission? })` registers an action, which can declare permissions the same way.
- `registerCapability({ apiVersion, provider, id, input?, output?, permission?, credentials?, call })` registers a host capability; a widget declares it in its manifest and calls `widget.call(id, args)`. Arguments and results are schema-checked and `call` receives an abort signal; one with a `permission` needs a person's grant.

The browser half publishes the same service; `registerWidgetType({ apiVersion, provider, id, component })` registers a React component, and once it matches a library widget by id the card renders it with the same parameters as `window.widget`. Read the version from `service.apiVersion` instead of copying the constant.

A provider imports the type from `dsh-widget-board/service` with `import type { WidgetBoardClientService }` and declares the service on `Context` with `declare module '@deepseek-ai/cordis'`; a plain-JS provider can keep a same-shaped declaration. Runtime goes through the service only: do not value-import this plugin, and do not add `dsh.client.external` to get around the rule; the client artifact depends only on the platform seeds. When a provider is disabled or unloaded, its widgets, data sources, actions, capabilities and grants are withdrawn; its cards stay in place and show unavailable until it returns.

## Building the demo page

`npm run demo` builds the page behind the [live demo](#live-demo): a directory you can drop onto static hosting such as GitHub Pages. It writes to `.debug/demo/` by default; `--out <dir>` or the `DEMO_OUT` environment variable picks another place. The board on the page is driven by a read-only host that runs in the browser: the snapshot is the default board generated at build time, and layout and card state live in the browser's IndexedDB. Put the recording in `media/` of the output directory and set its relative path in the `demo-recording` tag of `index.html`, or pass `--recording <file>` at build time. `npm run demo:check` walks the whole page on a static server under a sub-path. The demo page is not part of the published package.

## Status

In development, not yet released. Session tools, inline display, the right sidebar and widget sharing are still to come.

## License

MIT
