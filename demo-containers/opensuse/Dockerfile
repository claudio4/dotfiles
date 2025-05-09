FROM registry.opensuse.org/opensuse/tumbleweed:latest

RUN zypper ref && \
    zypper install -y -n ansible sudo

WORKDIR /work

RUN groupadd --gid 1000 ansible && \
    useradd --uid 1000 --gid 1000 -m ansible && \
    groupadd wheel || true && \
    usermod -aG wheel ansible && \
    echo '%wheel ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown ansible:ansible /work

USER ansible

CMD ["/bin/bash"]
