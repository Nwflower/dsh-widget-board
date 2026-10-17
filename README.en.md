# dsh-widget-board

[中文](README.md)

A widget board plugin for DeepSeek Harness. It adds a "Board" entry to the sidebar and a page of cards you can drag, resize and expand; each card is a small widget: weather, a key number, a task list, a chart, or anything you ask the agent to write.

- **Widgets written by the agent**: describe a widget in a session; the agent writes it, checks how it renders at every size, and places it on a board.
- **Shown right in the conversation**: the agent can show a widget inline in its reply, and the card follows its data as it changes.
- **Fits every screen**: the board picks its column count from its own width, and each widget lays out per the size families it declares, in a narrow window, on a wide screen or in the right sidebar.
- **Share and import**: a widget or a whole board exports to one file, and imports from a file, a link or a git repository; an import shows the permissions it asks for, and you approve them.
- **Isolated**: every widget runs in its own sandbox with no access to your sessions, files or the network; running a command or reaching a host asks you first.

## Status

In development, not yet released.

## License

MIT
