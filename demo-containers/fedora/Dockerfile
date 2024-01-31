FROM docker.io/library/fedora:latest

RUN dnf install -y ansible sudo
RUN groupadd --gid 1000 ansible && \
    adduser --uid 1000 --gid 1000  ansible && \
    usermod -aG wheel ansible && \
    echo '%wheel ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

WORKDIR /work
CMD ["/bin/bash"]
