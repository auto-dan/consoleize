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
- **consoleize me** — one-shot: latest of every approved addon + curated addon
  settings (DynamicCam camera rules, ConsolePort bindings, DialogueUI options)
- **settings** — debug mode (verbose file logging + maintainer capture tool),
  check-for-updates-on-launch, reset account
- first-time setup detects common install locations (Steam native, Steam/Proton
  compatdata incl. Steam Deck, Lutris)

## Prerequisites

consoleize manages addons _inside_ an existing World of Warcraft install, so first you
need the game itself:

1. **Install World of Warcraft** (Battle.net via Steam/Proton or Lutris). On Steam Deck,
   the community tool
   [NonSteamLaunchers](https://github.com/moraroy/NonSteamLaunchers-On-Steam-Deck) makes
   installing Battle.net (and adding it as a launcher in Game Mode) much easier:

   ```sh
   /bin/bash -c 'curl -Ls https://raw.githubusercontent.com/moraroy/NonSteamLaunchers-On-Steam-Deck/main/NonSteamLaunchers.sh | nohup /bin/bash -s -- "Battle.net"'
   ```

2. **Run WoW at least once** — log in and reach the character select screen. This makes
   the game create its folder structure (`_retail_/Interface/AddOns`, `WTF`, etc.), which
   consoleize needs before it can do anything useful.

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

## Opinionated defaults

`consoleize me` applies the curated addon settings shipped in `profiles/`:
SavedVariables for every managed addon, copied into each account folder under
`<WoW>/_retail_/WTF/Account/`. The `__ACCOUNT__` placeholder in
`profiles/WTF/Account/__ACCOUNT__/` expands per account, so defaults land where
the game reads them no matter the account name — and no personal data (account
name, character/realm keys, AceDB `profileKeys`) ever ships in the repo.

You can also drop your own files into `profiles/` mirroring the WoW flavor root
(e.g. `profiles/WTF/Config.wtf`); plain files are copied over `<WoW>/_retail_/`
verbatim.

**Maintainers:** enable debug mode in settings to reveal **capture local
defaults**, which rebuilds `profiles/` from your own SavedVariables — scrubbed
of personal data — so curated changes ship with a commit.

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
