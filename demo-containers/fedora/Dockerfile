FROM scratch AS SRC
ADD "https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip" /bun-linux-x64.zip

FROM docker.io/library/fedora:latest

RUN dnf install -y sudo unzip && dnf clean all && rm -rf /var/cache/dnf

RUN --mount=from=SRC,target=/src  unzip -j /src/bun-linux-x64.zip bun-linux-x64/bun -d /usr/local/bin && \
    chmod +x /usr/local/bin/bun

WORKDIR /work

RUN groupadd --gid 1000 ansible && \
    adduser --uid 1000 --gid 1000  ansible && \
    usermod -aG wheel ansible && \
    echo '%wheel ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown ansible:ansible /work

USER ansible

CMD ["/bin/bash"]
