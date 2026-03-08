# Keybinds
fish_vi_key_bindings
bind ctrl-h backward-kill-bigword
bind --mode insert ctrl-h backward-kill-bigword
bind ctrl-delete kill-bigword
bind --mode insert ctrl-delete kill-bigword

# Set prompt colors
set -g hydro_color_pwd brblue
set -g hydro_color_prompt brgreen
set fish_greeting

# Sets default editor
set -gx EDITOR {% $.nvim ? "nvim" : "vim" %}

# Enable multicd using just dots
abbr --add dotdot --regex '^\.\.+$' --function multicd

{%! if ($.wsl) { %}
# Propagate PWD change to Windows Terminal
__register_windows_terminal_hook
{%! } %}
