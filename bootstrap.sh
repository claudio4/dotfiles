# Check if curl or wget is available
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl -fssL"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget -qO-"
else
    echo "Please install either curl or wget to make HTTP request."
    exit 1
fi

# Prompt the user for tags if running interactively and there is no tags defined.
if [ -t 0 ] && [ -z "$TAGS" ]; then
    echo "Enter tags (separated by spaces) (ej. workstation server):"
    read -r TAGS
    export TAGS="$TAGS"
fi

bash -c "$($DOWNLOADER https://raw.githubusercontent.com/claudio4/dotfiles/master/install.sh)"
