# Desk Pet Link

A chibi desktop-pet companion that lives inside Cindy, with an optional desktop edition.

## In Cindy
Open the "桌宠 / Desk Pet" page: the pet walks around, can be petted (rub its head), chats using your Cindy model, offers emotional support and gentle reminders, switches between 4 outfits and plays 6 actions in every outfit.

## Agent tools
- `pet_say` – announce task results, encourage, remind to rest
- `pet_action` – sit / stretch / hug the cat / lie down / cheer / drink / listen to music / watch a video
- `pet_outfit` – switch outfit
- `pet_dock` – make the desktop pet peek over the top / bottom / left / right screen edge
- `pet_show` – show or hide the desktop edition
- `pet_work_status` – Cindy's work state, token usage vs budget, project overview, task statuses
- `pet_set_budget` – set the daily/monthly token budget and cross-check the remaining estimate
- `pet_project_scan` – re-scan the project folder you picked
- `pet_status` – check whether the desktop edition and the chat relay are online

## Desktop edition (optional, separate installer)
A transparent always-on-top pet with a mood/energy system, panels (status, mood diary, focus timer, reminders), edge-peeking, being picked up and carried, tray icon and a Windows installer.
- Right-click → "跟随 Cindy": the pet appears when Cindy is running and hides when it quits (add "开机自动启动" for a fully automatic experience).
- Desktop settings → chat source → Cindy: the desktop pet chats through your Cindy model (keep the pet page open in Cindy).
- This plugin forwards announcements, actions and outfit changes to it.

## Works with other AI tools
The desktop edition also ships an MCP server (`deskpet-mcp.cjs`), a CLI (`deskpet-cli.cjs`) and ready-made Claude Code / Codex / Cursor configs in its `integrations` folder, so other AI agents can make the pet announce task results, act, change outfits or peek over screen edges.

## Works with Cindy's activity
The pet follows what Cindy is doing (typing, thinking, waiting for your approval, error, done) using only activity boundaries and token counts - never message, command or file contents. A work bench panel shows today's/monthly token usage against a budget you set (Cindy does not expose real remaining quota to plugins), an overview of a project folder you pick yourself (read-only statistics), and the project's task statuses.

## Action sync
Manual actions (sit, stretch, hug the cat, cheer...), petting and sleep/wake are mirrored between the pet page in Cindy and the desktop edition (Windows and macOS) when sync is on. Remote-triggered actions are never echoed back.

## Privacy
- **Local only:** the plugin talks to `127.0.0.1` on your computer (ports 47831 for the desktop edition, 47832 for the relay). Nothing is sent to a plugin server.
- **Chat with the pet:** when you chat with the pet in Cindy, the plugin sends the following to the model you selected in Cindy: the role prompt, the last 16 chat messages, Cindy's current work state (idle / working / thinking / waiting / error), and a usage percentage if you set a budget. The data goes to Cindy, and from there to your chosen model provider. If that model is an online service, the provider receives this text.
- **Not sent:** project file contents, file names, or song and video titles. Project folders are only read after you pick them, and only statistics are kept locally.
- **Desktop edition:** the plugin does not download or install the desktop edition. Install it yourself from the official page; the plugin only connects to it locally.

