{%! if ($.homebrew) { %}
if not set --query HOMEBREW_PREFIX
    set --global --export HOMEBREW_PREFIX "{% $.homebrew %}"
    set --global --export HOMEBREW_CELLAR "{% $.homebrew %}/Cellar"
    set --global --export HOMEBREW_REPOSITORY "{% $.homebrew %}"

    fish_add_path --global --move --path "{% $.homebrew %}/bin" "{% $.homebrew %}/sbin"

    if test -n "$MANPATH[1]"
        set --global --export MANPATH '' $MANPATH
    end

    if not contains "{% $.homebrew %}/share/info" $INFOPATH
        set --global --export INFOPATH {% $.homebrew %}/share/info $INFOPATH
    end
end

{%! } if ($.go) { %}
if set --query GOPATH
    fish_add_path --global --path $GOPATH/bin
end

{%! } %}

if test -d "$HOME/.local/bin"
    fish_add_path --global --path $HOME/.local/bin
end
