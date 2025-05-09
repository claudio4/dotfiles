FROM docker.io/library/archlinux:latest

RUN pacman -Syu --noconfirm && pacman -S --noconfirm ansible sudo && rm -rf /var/lib/pacman/sync/*


WORKDIR /work

RUN groupadd --gid 1000 ansible && \
    useradd --uid 1000 --gid 1000 --groups wheel ansible && \
    mkdir /home/ansible && \
    echo '%wheel ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown ansible:ansible /work /home/ansible

USER ansible

CMD ["/bin/bash"]
