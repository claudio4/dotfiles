function svim --wraps=vim --description 'Executes vim with sudo prileges while loading user config'
    sudo -E vim $argv;
end
