FROM docker.io/library/debian:latest
RUN apt-get update && apt-get install -y ansible  sudo && rm -rf /var/lib/apt/lists/*

WORKDIR /work

RUN groupadd --gid 1000 ansible && \
    adduser --disabled-password --gecos '' --uid 1000 --gid 1000 ansible && \
    usermod -aG sudo ansible && \
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    chown ansible:ansible /work

USER ansible

CMD ["/bin/bash"]
