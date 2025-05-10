FROM docker.io/library/fedora:latest

RUN dnf install -y ansible sudo rsync
WORKDIR /work

RUN groupadd --gid 1000 ansible && \
    adduser --uid 1000 --gid 1000  ansible && \
    usermod -aG wheel ansible && \
    echo '%wheel ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown ansible:ansible /work

USER ansible

CMD ["/bin/bash"]
