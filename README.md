# Dotfiles

This repository contains my dotfiles, managed via... Ansible. Weird, I know.
But it is also amazing as it allows me to have my dev machine ready to go with
a simple a command, not only the dotfiles, but also the programs and utils that
I use on my daily basis.

## Install

The best way to apply these dotfiles is with the install script.
It will install any missing dependency for the playbook to run (including Ansible)
and it will guide you trough the installation.

```bash
# If you are in an interactive shell the script will ask you for settings.
# In that note, the process substitution is important to keep the interactivity.
# BTW, cl4.es/env.sh redirects to the bootstrap script in this repository, you
# can use the raw github link directly if you prefer.
bash <(wget -qO- https://cl4.es/env.sh)
```

You can also set all options before hand with either environment variables or
arguments. You can get more details from the script help with `--help`

```bash
./install.sh --help

# You can also do it without downloading the script before hand
bash <(wget -qO- https://cl4.es/env.sh) -h

```

### Can I use this playbook to setup a remote server?

Yes, of course. Just be sure to create a hosts file and set the group you want
to target with the `-l` flag. Here is an example:

```bash
# Create hosts file
echo -e '[remote]\nmy.server.address\n' >> hosts.ini
# Run the playbook
ansible-playbook server.yml -K -i hosts.ini -l remote -t server
```
