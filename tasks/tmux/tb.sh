#!/bin/bash

if [ -z "$TMUX" ]; then
  SESSION=$(basename "$PWD" | tr . - | tr ' ' - | tr ':' - | tr '[:upper:]' '[:lower:]')
else
  SESSION="$(tmux display-message -p '#S')"
fi

WAIT="read -n 1 -srp 'Press any key to exit...'"
NOTIFICATION="tmux display-message '$1 in $SESSION has finished.'"
COMMAND="bash -c \"$@ ; $NOTIFICATION ; $WAIT\""

if ! tmux has-session "-t=$SESSION" 2> /dev/null; then
  tmux new-session -d -s "$SESSION" -c "$RESULT" "$COMMAND"
else
 tmux new-window -d -t "$SESSION:" -n "Background $1" "$COMMAND"
fi
