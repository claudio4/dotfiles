#!/bin/bash

temp_file=$(mktemp -t neovide-env-XXXXXXXXXX.sh)

echo '#!/bin/bash' >>"$temp_file"
# Write all envvarss
env | grep -v '^_' | sed 's/^\([^=]\+\)=\(.*\)$/ export \1="\2"/' >>"$temp_file"
echo -e 'exec nvim $@' >>"$temp_file"
chmod +x "$temp_file"

neovideDir="$(wslpath -w "$(dirname "$(which neovide.exe)")")"
powershell.exe "Start-Process -FilePath \"$neovideDir\\neovide.exe\"  -ArgumentList \"--wsl --neovim-bin $temp_file $@\""
sleep 3 && rm "$temp_file" &
