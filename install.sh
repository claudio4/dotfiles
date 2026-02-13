#!/bin/sh
set -eu

DOTFILES_REPO="${DOTFILES_REPO:-https://github.com/claudio4/dotfiles.git}"
DOTFILES_BRANCH="${DOTFILES_BRANCH:-v3}"
DOTFILES_DIR="${DOTFILES_DIR:-$HOME/dev/claudio4/dotfiles}"

# --- Resolve SCRIPT_DIR -------------------------------------------------------
# Detect if we're running from the repo on disk, or piped/sourced
# (e.g. `curl ... | bash`, `bash <(wget ...)`, `eval <(curl ...)`)

SCRIPT_DIR=""

# $0 points to a real file — check if it lives alongside install.ts
if [ -f "$0" ]; then
    CANDIDATE="$(cd "$(dirname "$0")" && pwd)"
    if [ -f "$CANDIDATE/install.ts" ]; then
        SCRIPT_DIR="$CANDIDATE"
    fi
fi

# If we couldn't resolve it, we're being piped/sourced — clone the repo
if [ -z "$SCRIPT_DIR" ]; then
    echo "Bootstrap mode: no local checkout detected."

    if ! command -v git >/dev/null 2>&1; then
        echo "Error: git is required in bootstrap mode." >&2
        exit 1
    fi

    if [ -d "$DOTFILES_DIR/.git" ]; then
        echo "Updating existing dotfiles clone in $DOTFILES_DIR ..."
        git -C "$DOTFILES_DIR" pull --quiet
    else
        echo "Cloning dotfiles into $DOTFILES_DIR ..."
        mkdir -p "$(dirname "$DOTFILES_DIR")"
        git clone -b "$DOTFILES_BRANCH" "$DOTFILES_REPO" "$DOTFILES_DIR"
    fi

    SCRIPT_DIR="$DOTFILES_DIR"

    if [ ! -f "$SCRIPT_DIR/install.ts" ]; then
        echo "Error: install.ts not found in $SCRIPT_DIR after clone." >&2
        exit 1
    fi
fi

# --- Locate or download Bun ---------------------------------------------------

BUN=""

# 1) Check if bun is already in PATH
if command -v bun >/dev/null 2>&1; then
    BUN="bun"
# 2) Check if a local bun binary exists in the script directory
elif [ -x "$SCRIPT_DIR/bun" ]; then
    BUN="$SCRIPT_DIR/bun"
fi

# 3) If still not found, download it
if [ -z "$BUN" ]; then
    echo "Bun not found. Downloading..."

    # Check for required tools before starting the download
    if ! command -v unzip >/dev/null 2>&1; then
        echo "Error: unzip is required to extract the Bun binary but was not found." >&2
        exit 1
    fi

    if command -v curl >/dev/null 2>&1; then
        DOWNLOADER="curl"
    elif command -v wget >/dev/null 2>&1; then
        DOWNLOADER="wget"
    else
        echo "Error: Neither curl nor wget is available." >&2
        exit 1
    fi

    # Detect OS
    OS="$(uname -s)"
    case "$OS" in
        Linux)  OS_TAG="linux" ;;
        Darwin) OS_TAG="darwin" ;;
        *)
            echo "Error: Unsupported operating system: $OS" >&2
            exit 1
            ;;
    esac

    # Detect architecture
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64|amd64)   ARCH_TAG="x64" ;;
        aarch64|arm64)   ARCH_TAG="aarch64" ;;
        *)
            echo "Error: Unsupported architecture: $ARCH" >&2
            exit 1
            ;;
    esac

    TARGET="bun-${OS_TAG}-${ARCH_TAG}"
    URL="https://github.com/oven-sh/bun/releases/latest/download/${TARGET}.zip"
    ZIP_PATH="$SCRIPT_DIR/${TARGET}.zip"

    echo "Downloading Bun from $URL ..."

    if [ "$DOWNLOADER" = "curl" ]; then
        curl -fsSL -o "$ZIP_PATH" "$URL"
    else
        wget -qO "$ZIP_PATH" "$URL"
    fi

    # Extract the binary
    unzip -oqj "$ZIP_PATH" "${TARGET}/bun" -d "$SCRIPT_DIR"
    chmod +x "$SCRIPT_DIR/bun"

    # Clean up the zip
    rm -f "$ZIP_PATH"

    echo "Bun downloaded successfully to $SCRIPT_DIR/bun"
    BUN="$SCRIPT_DIR/bun"
fi

# --- Run install.ts -----------------------------------------------------------

# shellcheck disable=SC2086
exec "$BUN" run "$SCRIPT_DIR/install.ts" ${DOTFILES_ARGS:-} "$@"
