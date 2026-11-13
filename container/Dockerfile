# The image of the containers that sessions work in (see containers.js): what a session needs, a Docker of its
# own for the project's services, and Claude Code.
FROM docker:dind AS dind

# Debian, with a current Python.
FROM python:3.13-slim

ENV DEBIAN_FRONTEND=noninteractive

# What sessions use (git, gh, jq, curl), and what the two repositories below need (certificates, gnupg to
# look at a key before it is trusted).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg git gh jq procps less openssh-client xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Docker's engine, command line, Buildx and Compose, from Docker's own repository for Debian.
# https://docs.docker.com/engine/install/debian/
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && printf 'Types: deb\nURIs: https://download.docker.com/linux/debian\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
         "$(. /etc/os-release && echo "$VERSION_CODENAME")" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Node.js: for a project's front end, and for the hooks of Claude Code plugins, which are scripts for it. The
# newest release of its long-term line, from nodejs.org, checked against the checksums published beside it.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/* \
    && cd /tmp \
    && arch=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/') \
    && curl -fsSLO https://nodejs.org/dist/latest-v26.x/SHASUMS256.txt \
    && f=$(grep -o "node-v[0-9.]*-linux-$arch\.tar\.xz" SHASUMS256.txt | head -1) \
    && curl -fsSLO "https://nodejs.org/dist/latest-v26.x/$f" \
    && grep " $f\$" SHASUMS256.txt | sha256sum -c - \
    && tar -xJf "$f" -C /usr/local --strip-components=1 --no-same-owner --exclude='*/CHANGELOG.md' --exclude='*/README.md' \
    && rm -f "$f" SHASUMS256.txt && node --version && npm --version

# The start script of Docker's own Docker-in-Docker image: it prepares this container's control groups and
# mounts for a Docker inside it.
COPY --from=dind /usr/local/bin/dind /usr/local/bin/dind

# Sessions do not run as root. The docker group owns the socket of the Docker inside. The folders made here are
# where the volumes go that all containers share: Claude Code's configuration and login, GitHub's login, and
# the download caches of npm and pip.
# ponytail: no sudo. What a project needs beyond this image comes from pip, from npm, or from a container of
# the Docker inside. Give `agent` sudo if sessions keep asking for apt.
RUN useradd --create-home --shell /bin/bash --groups docker agent \
    && mkdir -p /work /home/agent/.claude /home/agent/.config/gh /home/agent/.npm /home/agent/.cache/pip \
    && chown -R agent:agent /work /home/agent

# git: a push to GitHub asks gh for the login. /src is the folder on the computer that the repository is cloned
# from; it belongs to another user, which git refuses unless it is told.
RUN git config --system credential.https://github.com.helper '!gh auth git-credential' \
    && git config --system --add safe.directory /src \
    && git config --system --add safe.directory /src/.git

# One folder for all of Claude Code's configuration, .claude.json included: the volume the containers share.
ENV CLAUDE_CONFIG_DIR=/home/agent/.claude

VOLUME /var/lib/docker
ENTRYPOINT ["dind"]
CMD ["dockerd", "--host=unix:///var/run/docker.sock"]

# Claude Code, from Anthropic's signed repository. The build stops unless the key is the one key the
# documentation names. A package from this repository does not update itself, so this comes last: the app hands
# in the version of Claude Code it found on the computer, and with a new one Docker builds this layer again,
# which installs the newest.
# https://code.claude.com/docs/en/setup#install-with-linux-package-managers
ARG CLAUDE_CODE=latest
RUN echo "Claude Code on the computer: $CLAUDE_CODE" \
    && curl -fsSL https://downloads.claude.ai/keys/claude-code.asc -o /etc/apt/keyrings/claude-code.asc \
    && test "$(gpg --show-keys --with-colons /etc/apt/keyrings/claude-code.asc | awk -F: '$1=="pub"{n++} $1=="fpr"&&!p{p=$10} END{print n":"p}')" = "1:31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE" \
    && echo "deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/latest latest main" > /etc/apt/sources.list.d/claude-code.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends claude-code \
    && rm -rf /var/lib/apt/lists/* \
    && claude --version
