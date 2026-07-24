# consoleize

make wow awesome on deck/gabecube, linux/wsl focused

A lightweight console app that sets up and maintains World of Warcraft for controller
play: it installs and updates an opinionated addon loadout (ConsolePort, DynamicCam,
DialogueUI) straight into your WoW `Interface/AddOns` folder.

## Features

- **homepage** — welcome message, per-addon install status with last-modified dttm,
  blinking `UPDATE AVAILABLE` badges, and the exact paths consoleize reads/writes
- **check for updates** — polls the addons' public GitHub mirrors for new releases
  (never auto-applies)
- **update addons** — downloads and installs missing/outdated addons with loading bars
- **consoleize me** — one-shot: latest of every approved addon + local profile defaults
- **settings** — debug mode (verbose file logging), check-for-updates-on-launch,
  reset account
- first-time setup detects common install locations (Steam native, Steam/Proton
  compatdata incl. Steam Deck, Lutris)

## Quick start (Steam Deck / Linux / WSL)

One line, copy-paste into a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/auto-dan/consoleize/main/setup.sh | bash
```

This installs [Bun](https://bun.sh) (user-level, no sudo — safe for the Deck's read-only
filesystem), downloads consoleize to `~/consoleize`, installs dependencies, and launches
first-time setup. Re-run the same line any time to launch consoleize again.

First launch walks you through creating a local account (username + WoW AddOns path).
Everything is stored locally — nothing is uploaded:

| what   | where                                                   |
| ------ | ------------------------------------------------------- |
| config | `~/.config/consoleize/config.json`                      |
| logs   | `~/.local/state/consoleize/consoleize.log` (debug mode) |

## Manual run

```sh
bun install
bun run dev
```

## Build a standalone binary

```sh
npm run build   # typechecks, then compiles to dist/consoleize
./dist/consoleize
```

## Profiles hook (optional)

`consoleize me` also applies local defaults: drop files into `profiles/` mirroring
your WoW flavor root (e.g. `profiles/WTF/...`) and they are copied over
`<WoW>/_retail_/`. Empty by default.

## Addon sources

Addons are pulled from their public GitHub mirrors or official CurseForge packages (no
API key needed). Addons installed from raw GitHub sources get their `.pkgmeta` libraries
(Ace3 etc.) resolved automatically.

| addon       | source                                |
| ----------- | ------------------------------------- |
| ConsolePort | GitHub: `seblindfors/ConsolePort`     |
| DynamicCam  | CurseForge package (project `101120`) |
| DialogueUI  | GitHub: `Peterodox/YUI-Dialogue`      |

## Development

```sh
npm test              # run tests
npm run test:watch    # tests in watch mode
npm run test:coverage # tests with coverage
npm run lint          # eslint
npm run lint:fix      # eslint --fix
npm run typecheck     # tsc --noEmit
npm run watch         # dev with reload
```
