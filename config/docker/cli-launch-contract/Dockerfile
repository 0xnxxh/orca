ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

ARG LIBASOUND_PACKAGE=libasound2t64

ENV DEBIAN_FRONTEND=noninteractive

# Why this set and no more: it is what Electron needs to *link*. The contract
# under test is that a text-only CLI command never initializes Chromium, so the
# image deliberately ships no display server and no FUSE.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    "${LIBASOUND_PACKAGE}" \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    procps \
    util-linux \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash orca

COPY config/docker/cli-launch-contract/run-cli-case.sh /usr/local/bin/run-cli-case

ENTRYPOINT ["/usr/local/bin/run-cli-case"]
