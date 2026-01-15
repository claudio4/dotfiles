FROM scratch AS SRC
ADD "https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip" /bun-linux-x64.zip

FROM docker.io/library/debian:latest
RUN apt-get update && apt-get install -y sudo adduser unzip && rm -rf /var/lib/apt/lists/*

RUN --mount=from=SRC,target=/src  unzip -j /src/bun-linux-x64.zip bun-linux-x64/bun -d /usr/local/bin && \
    chmod +x /usr/local/bin/bun

WORKDIR /work

RUN groupadd --gid 1000 user && \
    adduser --disabled-password --gecos '' --uid 1000 --gid 1000 user && \
    usermod -aG sudo user && \
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown user:user /work

USER user

CMD ["/bin/bash"]
