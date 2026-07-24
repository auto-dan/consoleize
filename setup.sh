#!/usr/bin/env bash
#
# consoleize setup - one-liner install for Steam Deck / Linux / WSL:
#
#   curl -fsSL https://raw.githubusercontent.com/auto-dan/consoleize/main/setup.sh | bash
#
# What it does (everything stays in your home dir, no sudo needed - safe for
# the Steam Deck's read-only filesystem):
#   1. installs the Bun runtime to ~/.bun (skipped if already present)
#   2. downloads consoleize to ~/consoleize (skipped if already there)
#   3. installs dependencies
#   4. launches the app (first-time setup: name + WoW addons folder)
#
# Re-run the same one-liner any time to launch consoleize again.
#
# Optional overrides:
#   CONSOLEIZE_REPO=owner/repo CONSOLEIZE_REF=branch CONSOLEIZE_DIR=/path bash setup.sh
#
set -euo pipefail

REPO="${CONSOLEIZE_REPO:-auto-dan/consoleize}"
REF="${CONSOLEIZE_REF:-main}"
INSTALL_DIR="${CONSOLEIZE_DIR:-$HOME/consoleize}"

info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31m==> %s\033[0m\n' "$*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || die "curl is required (install it and retry)"
command -v tar >/dev/null 2>&1 || die "tar is required (install it and retry)"

# --- 1. Bun ------------------------------------------------------------------
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  info "installing bun (user-level, no sudo)..."
  curl -fsSL https://bun.sh/install | bash
  hash -r
fi
command -v bun >/dev/null 2>&1 || die "bun installation failed - see output above"
info "bun $(bun --version) ready"

# --- 2. consoleize source ----------------------------------------------------
if [ -f "$INSTALL_DIR/package.json" ]; then
  info "found existing install at $INSTALL_DIR"
else
  info "downloading consoleize ($REPO@$REF)..."
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" \
    -o "$tmp_dir/consoleize.tar.gz" ||
    die "download failed - check that $REPO ($REF) exists and is public"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$tmp_dir/consoleize.tar.gz" -C "$INSTALL_DIR" --strip-components=1
  rm -rf "$tmp_dir"
  trap - EXIT
fi

# --- 3. dependencies ---------------------------------------------------------
info "installing dependencies..."
cd "$INSTALL_DIR"
bun install --silent || die "dependency install failed"

# --- 4. launch ---------------------------------------------------------------
info "starting consoleize - first-time setup asks for your name + WoW folder"
printf '\nrun it again later with:\n  cd %s && bun run dev\n\n' "$INSTALL_DIR"

# When run via `curl | bash`, stdin is the pipe, not the terminal - re-attach
# to /dev/tty (when openable) so the interactive menu works.
if (exec </dev/tty) 2>/dev/null; then
  exec bun run dev < /dev/tty
else
  exec bun run dev
fi
