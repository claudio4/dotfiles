export SSH_AUTH_SOCK="$XDG_RUNTIME_DIR/wsl2-ssh-pageant.sock"
{% if not uses_systemd %}
if ! ss -a | grep -q "$SSH_AUTH_SOCK"; then
    rm -f "$SSH_AUTH_SOCK"
    wsl2_ssh_pageant_bin="$HOME/.local/bin/wsl2-ssh-pageant.exe"
    if test -x "$wsl2_ssh_pageant_bin"; then
        (setsid nohup socat UNIX-LISTEN:"$SSH_AUTH_SOCK,fork" EXEC:"$wsl2_ssh_pageant_bin" >/dev/null 2>&1 &)
    else
        echo >&2 "WARNING: $wsl2_ssh_pageant_bin is not executable."
    fi
    unset wsl2_ssh_pageant_bin
fi
{% endif %}
