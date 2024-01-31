# Dotfiles
This repository contains my dotfiles, managed via... Ansible. Weird, I know. But it is also amazing as it allows me to have my devbox ready to go with a simple a command, not only the dotfiles, but also the programs and utils that I use on my daily basis.

## Install
If you already have Ansible, it is as simple as doing:
```bash
ansible-pull -U https://github.com/claudio4/dotfiles.git --ask-become-pass
```

If you are in a completely bare system, you can use the `bootstrap.sh` script.
```
# You can also use https://cl4.es/env.sh for less typing, it redirects to the same file.
wget -O- https://raw.githubusercontent.com/claudio4/dotfiles/master/bootstrap.sh | bash

# You can also send arugments, for example tags
wget -O- https://cl4.es/env.sh | bash -- -t server

# Also, if you are not in an interactive enviroment
wget -O- https://cl4.es/env.sh | bash -- -y
```
