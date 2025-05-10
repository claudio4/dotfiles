function __register_windows_terminal_hook
    if test -n "$WT_SESSION"
        function __windows_terminal_pwd_hook --on-variable PWD
            printf "\e]9;9;%s\e\\" (wslpath -w "$PWD")
        end
    end
end
