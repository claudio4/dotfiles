FROM docker.io/library/debian:latest
RUN apt-get update && apt-get install -y ansible  sudo && rm -rf /var/lib/apt/lists/* && \
    adduser --disabled-password --gecos '' ansible && \
    usermod -aG sudo ansible && \
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

WORKDIR /work
CMD ["/bin/bash"]
