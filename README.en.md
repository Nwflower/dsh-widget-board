# dsh-widget-board

[中文](README.md)

A widget board for DeepSeek Harness: a page of cards you drag and resize, each card a small widget. You or the agent in a session write a widget as three files, and other plugins can provide widgets too.

**[Live demo](https://nwflower.github.io/dsh-widget-board/)** · [Install](#install) · [Write a widget](#write-a-widget) · [For plugin providers](#for-plugin-providers)

<p align="center">
  <img src="docs/images/board-light.png" alt="The widget board in light mode" width="49%">
  <img src="docs/images/board-dark.png" alt="The widget board in dark mode" width="49%">
</p>

<hr>

## Three files

`widget.json` names and sizes the widget; next to it sit `index.html` and `style.css`, and `main.js` when it needs a script. Built-in widgets, your own and agent-written ones share this one format. Once the files are written, the card appears in the library.

<hr>

## One sandbox

Every widget runs in its own sandboxed iframe: a strict CSP, no network and no cookies, talking to the host only over a MessagePort bridge. A grant is bound to the hash of the widget's content, so changing one byte asks a person to allow it again.

<hr>

## A few doors

| Board in the sidebar | Switch board tabs, drag and tidy cards; the default board is filled on first launch |
|---|---|
| Plus menu | Add, tidy, refresh; Add opens the library as a full-height panel that rises from the bottom |
| Card gear | Change the widget's props, fill in credentials, review and grant data sources and permissions |
| Session tools | The agent lists, writes, places widgets and pushes data; `widget_show` draws one in the answer. Only `widget_catalog` starts out visible; the rest appear after being named in its `expose` field |
| `widgetBoard` service | Other plugins register widgets, data sources, actions, host capabilities and markets |

<hr>

## Install

```sh
dsh plugin add dsh-widget-board
```

If pnpm blocks the build script, approve the `allowBuilds` line it prints and retry. The repository carries no `lib/`, so installing from GitHub (`dsh plugin add github:Nwflower/dsh-widget-board`) has the package build itself once at install time.

From a checkout:

```sh
npm install
npm run build
dsh plugin add <path to this repository>
```

<hr>

## Write a widget

Create a directory under `$DSH_HOME/widget-board/widgets/<id>/`:

```text
widget.json     name, sizes, props, data sources, credentials
index.html      the picture
style.css       styles, using only the runtime tokens
main.js         optional
samples.json    optional, one sample per size family
scripts         optional, extra scripts inlined before main.js
vendor/         optional, third-party libraries shipped with the widget (their licences kept as they are)
```

Save it and the host re-reads the library; cards on open pages switch to the new version.

<hr>

### Box

The board sizes the card. The runtime sorts the content box on two axes: `data-box-width` is `narrow`, `regular` or `wide`, `data-box-height` is `short`, `regular` or `tall`, and it exposes `--w-w`, `--w-h` and `--w-cols`. `defaultBox` is the box a new card gets; `minBox` is its lower bound.

### Look

Spacing and type sizes come from `--w-space-*` and `--w-type-*`; status colors from `--w-tone-ok`, `--w-tone-warn`, `--w-tone-danger` and `--w-tone-idle`, paired with a `.w-sr` line for screen readers. The layout primitives are `.w-frame`, `.w-actions` and `.w-scroll`; hide by size with `.w-hide-short` and `.w-hide-narrow`.

### Motion

The runtime suite owns pointer and keyboard behaviour for flip, magnetic and holographic; the widget only draws. For a flip, put `.t-flip-card` and `data-t-flip` on the outer element, `.t-flip-card__inner` inside, one `.t-flip-card__face` per side and `.t-flip-card__back` on the back; magnetic uses `.t-magnetic` with `data-t-magnetic`, holographic `.t-holo` with `data-t-holo`. The built-in `flip-card`, `magnetic-card` and `holographic-card` are copyable examples.

### Data and calls

A `source` of `provider:name` names a data source a plugin registered; a source that declares `subscribe` pushes data while the card is visible, and the others are read per the manifest's `refresh`. To read one more source on demand, list it in `sources` and call the `widget-board:data.read` capability; the value it returns does not rewrite the card. `credentials` adds key fields to the settings modal; the value goes to the host's credential service and the widget cannot read it. Declare a capability in the manifest and call it with `widget.call(id, args)`; arguments and results are checked against JSON Schema, and the arguments may be omitted entirely when the capability declares none. The handshake also carries `widget.capabilityMetadata`: each capability's title, description, argument and result schemas, permission, and whether it is available right now. The built-in "Rest today" widget gets its account this way: add a `GITHUB_TOKEN` under Credentials and the card lists the open issues on the repositories you maintain, with no username to fill in, and a click on a row opens it in a new tab.

The built-in "Recent token usage" card binds the `widget-board:session.usage` source a plugin registers: while the card is visible the source pushes a current snapshot, then one more per usage-carrying session event plus a 10 second tick; the card stops receiving once it leaves the viewport and keeps no timer itself. Changing its `scope` unsubscribes and resubscribes for the new window. Its "today" and "all" windows merge the history dsh-usage recorded with the events since this plugin starts, and the card marks that source as "dsh-usage history" next to the date. When dsh-usage is not installed the live reading and its empty state stay and the source reads "History not installed"; when it is installed but cannot be read the source reads "History unavailable" instead, and neither case ever shows a fake zero. A selected session never merges history and reads "Realtime only". The history supplies the totals and the four parts for today and all; the latest call and the trend always come from live events, so a window with history but no live call still shows its totals and hides the latest call.

A widget cannot navigate or open popups itself. To send a link out, call `widget.open(url)` from inside a click handler and the page wrapping the widget opens it; only `http` and `https` addresses are accepted.

<hr>

## For plugin providers

The host half and the browser half each publish the cordis service `widgetBoard`. Both report a version and a feature list: `service.apiVersion` is the major version, `service.supportedApiVersions` is what the older entry points accept (2 and 3), and `service.features` with `service.supports(name)` says whether this side has a given feature.

A new provider calls `registerProvider({ apiVersion: 3, provider, features })` and gets a handle; widget directories, data sources, actions, capabilities and the market all hang off it:

| Host-side handle | What it does |
|---|---|
| `registerWidgets({ directory })` | Mounts a widget directory and reads it once |
| `registerDataSource()` | Mounts a data source a card binds to |
| `registerAction()` | Mounts an action |
| `registerCapability()` | Mounts a host capability a widget calls with `widget.call` |
| `registerMarketProvider()` | Mounts a market and its listing and package functions |
| `dispose()` | Withdraws every registration this provider left behind, in one call |

The browser-side handle carries `registerNativeWidget({ id, component })`, which registers a React component that renders a library widget of the same id. Child registrations omit the version and the provider name: the handle supplies both.

Existing providers keep using `registerWidgetType`, `registerDataSource`, `registerAction`, `registerCapability` and `registerMarketProvider`, passing version 2 or 3. One provider name has one active handle per side, the two kinds of entry point cannot be mixed, and a provider can register again after `dispose`.

`features` declares intended use and does not change what the side provides: `capabilityMetadata`, `eventData`, `marketProvider` and `pushData` are answered per side, and a missing one degrades that feature alone.

Widget directories mounted by the new handle, market widgets and native components use ids of the form `<author>.<name>`; local widgets and the older entry points keep flat ids, and widgets already installed are not renamed.

A read, an action or a capability call waits at most 15 seconds (a capability may declare 1 to 25 seconds), each provider runs 8 calls at a time, and a full set of slots fails at once instead of queueing. The host records registrations, failures, timeouts and current availability per provider, the board section of the settings page lists that table, and a card shows the reason for its own failure.

Across packages, take the type:

```ts
import type { WidgetBoardClientService } from 'dsh-widget-board/service'
```

`dsh-widget-board/provider` is a value-only SDK that builds and validates registration arguments. Runtime goes through the service: no value import of this plugin, no `dsh.client.external`. When a provider is disabled or unloaded, its widgets, data sources, actions, capabilities, market and grants are withdrawn; its cards stay and show unavailable, and come back with the provider.

The full rules are in [docs/provider.md](docs/provider.md).

<hr>

## Status

In development; 0.1.5 is on npm. The right sidebar, the widget library page, widget version history and sharing/import are still to come.

## License

MIT
