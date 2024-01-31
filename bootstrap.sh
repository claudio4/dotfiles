#!/bin/bash
set -e



install_package() {
    if ! command -v sudo &> /dev/null; then
        echo "sudo is not installed. Please manually install $1."
        exit 1
    fi


    if command -v zypper &> /dev/null; then
        sudo zypper install "$1" -y
    elif command -v apt &> /dev/null; then
        sudo apt install "$1" -y
    elif command -v dnf &> /dev/null; then
        sudo dnf install "$1" -y
    elif command -v pacman &> /dev/null; then
        sudo pacman -Sy "$1" --noconfirm
    else
        echo "Unable to install package. No supported package manager found."
        exit 1
    fi
}




# Check if Ansible is installed
if ! command -v ansible &> /dev/null; then
   install_package ansible
fi

# Check if git is installed
if ! command -v git &> /dev/null; then
   install_package git
fi


if [ -z $PS1 ]; then
    echo "About to run ansible-pull -U https://github.com/claudio4/dotfiles.git --ask-become-pass $@"
    read -p "Continue? (y/n) " -n 1 -r
    echo    # move to a new line
    if [[ ! $REPLY =~ ^[Yy]$ ]]
    then
        exit 1
    fi
    ask_pass="--ask-become-pass"
else
    echo "Running ansible-pull -U https://github.com/claudio4/dotfiles.git \"$@\""
    ask_pass=""
fi

if [[ -n $TAGS ]]; then
    # Split the TAGS variable by spaces and prepend each tag with -t
    IFS=' ' read -ra ADDR <<< "$TAGS"
    tags=""
    for i in "${ADDR[@]}"; do
        tags+=" -t $i"
    done
fi

# Run Ansible playbook using ansible-pull
ansible-pull -U https://github.com/claudio4/dotfiles.git local.yaml $ask_pass $tags
