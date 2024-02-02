# Dotfiles
This repository contains my dotfiles, managed via... Ansible. Weird, I know.
But it is also amazing as it allows me to have my dev machine ready to go with
a simple a command, not only the dotfiles, but also the programs and utils that
I use on my daily basis.

## Install
If you already have Ansible, it is as simple as doing:
```bash
# Directly from the remote repo.
ansible-pull -U https://github.com/claudio4/dotfiles.git --ask-become-pass
# If you already have a local copy of the repo.
ansible-playbook local.yml -K
```

If you are in a completely bare system, you can use the `bootstrap.sh` script.
```bash
# If you are in an interactive shell, you will be asked for tags.
# In that note, the eval is important to keep the interactivity.
# BTW, cl4.es/env.sh redirects to the bootstrap script in this repository, you
# can use the raw github link directly if you prefer.
eval "$(wget -qO- https://cl4.es/env.sh)"

# You can also set tags before hand
TAGS="server lazygit" eval "$(wget -qO- https://cl4.es/env.sh)"

# If you are setting the flags before hand you might not need an interactive shell so you can do
TAGS="server lazygit" wget -qO- https://raw.githubusercontent.com/claudio4/dotfiles/master/install.sh | bash
```
### Can I this playbook to setup a remote server?
Yes, of course. Just be sure to create a hosts file and set the group you want
to target with the `-l` flag. Here is an example
```bash
# Create hosts file
echo -e '[remote]\nmy.server.address\n' >> hosts.ini
# Run the playbook
ansible-playbook local.yml -K -i hosts.ini -l remote -t server
```
