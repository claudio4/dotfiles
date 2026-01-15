FROM scratch AS SRC
ADD "https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip" /bun-linux-x64.zip

FROM registry.opensuse.org/opensuse/tumbleweed:latest

RUN zypper ref && \
    zypper install -y -n unzip sudo && \
    zypper clean --all


RUN --mount=from=SRC,target=/src  unzip -j /src/bun-linux-x64.zip bun-linux-x64/bun -d /usr/local/bin && \
    chmod +x /usr/local/bin/bun

WORKDIR /work

RUN groupadd --gid 1000 user && \
    useradd --uid 1000 --gid 1000 -m user && \
    groupadd wheel || true && \
    usermod -aG wheel user && \
    echo '%wheel ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown user:user /work

USER user

CMD ["/bin/bash"]
