FROM docker.io/library/archlinux:latest

RUN pacman -Syu --noconfirm && pacman -S --noconfirm bun sudo && rm -rf /var/lib/pacman/sync/*


WORKDIR /work

RUN groupadd --gid 1000 user && \
    useradd --uid 1000 --gid 1000 --groups wheel user && \
    mkdir /home/user && \
    echo '%wheel ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown user:user /work /home/user

USER user

CMD ["/bin/bash"]
