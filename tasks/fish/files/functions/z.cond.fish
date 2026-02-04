# Lazy loads zoxide

function z
    functions -e z
    zoxide init fish | source
    z $argv
end
