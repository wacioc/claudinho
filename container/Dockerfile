# The image of the containers that sessions work in (see containers.js): what a session needs, a Docker of its
# own for the project's services, the tools the folder names for itself, and Claude Code. The layers are in the
# order of how seldom they change: what every folder shares first, then the folder's tools, then Claude Code.
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

# What sessions asked for beyond that: sudo, the tools that unpack what toolchains come in, and the system
# libraries a headless Chromium needs, as Playwright itself lists them for this system (about a hundred packages,
# 350 MB). The browser is not in the image: a project fetches the one its Playwright version wants, into a
# volume the containers share.
# https://playwright.dev/docs/browsers#install-system-dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends sudo unzip zip \
    && npx -y playwright@latest install-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# mise, which installs the tools a folder names in its mise.toml (further down), from mise's own package
# repository. The build stops unless the key is the release key that mise's documentation names.
# https://mise.jdx.dev/installing-mise.html
RUN curl -fsSL https://mise.jdx.dev/gpg-key.pub -o /etc/apt/keyrings/mise.asc \
    && test "$(gpg --show-keys --with-colons /etc/apt/keyrings/mise.asc | awk -F: '$1=="pub"{n++} $1=="fpr"&&!p{p=$10} END{print n":"p}')" = "1:24853EC9F655CE80B48E6C3A8B81C9D17413A06D" \
    && echo "deb [signed-by=/etc/apt/keyrings/mise.asc arch=$(dpkg --print-architecture)] https://mise.jdx.dev/deb stable main" > /etc/apt/sources.list.d/mise.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mise \
    && rm -rf /var/lib/apt/lists/* \
    && mise --version

# The start script of Docker's own Docker-in-Docker image: it prepares this container's control groups and
# mounts for a Docker inside it.
COPY --from=dind /usr/local/bin/dind /usr/local/bin/dind

# Sessions do not run as root, and may become root: a project's set-up asks for system packages now and then,
# and the container is the session's own. The docker group owns the socket of the Docker inside. The folders
# made here are where the volumes go that all containers share: Claude Code's configuration and login, GitHub's
# login, and the download caches of npm, pip, uv and Playwright's browsers. /opt/mise is where a folder's tools
# are installed, in the image.
RUN useradd --create-home --shell /bin/bash --groups docker agent \
    && echo 'agent ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/agent && chmod 440 /etc/sudoers.d/agent \
    && mkdir -p /work /opt/mise /home/agent/.claude /home/agent/.config/gh /home/agent/.npm /home/agent/.cache/pip /home/agent/.cache/uv /home/agent/.cache/ms-playwright \
    && chown -R agent:agent /work /opt/mise /home/agent

# git: a push to GitHub asks gh for the login. /src is the folder on the computer that the repository is cloned
# from; it belongs to another user, which git refuses unless it is told.
RUN git config --system credential.https://github.com.helper '!gh auth git-credential' \
    && git config --system --add safe.directory /src \
    && git config --system --add safe.directory /src/.git

# One folder for all of Claude Code's configuration, .claude.json included: the volume the containers share.
ENV CLAUDE_CONFIG_DIR=/home/agent/.claude
# mise: the tools go into the image, are found without a shell that was set up for them, and the files that
# name them are taken at their word, as everything else in the folder is.
ENV MISE_DATA_DIR=/opt/mise MISE_YES=1 MISE_TRUSTED_CONFIG_PATHS=/work PATH=/opt/mise/shims:$PATH

# The tools of the folder this image is for: what its mise.toml or .tool-versions names. The app puts those
# files into tools/ when it builds (see containers.js), and builds again when one of them has changed. They lie
# in /work, above every clone, so a session finds the tools whatever its branch holds, and a file of the clone
# itself comes before them. With no such file, tools/ is empty: that is the image all other folders share.
# What mise downloaded to install them is removed in the same step: it keeps a copy, which for Flutter is 1.5 GB
# that the image would carry for nothing.
# ponytail: one layer for all of a folder's tools, so a change of one version fetches all of them again. Give
# this step a cache for mise's downloads, outside the image, if that takes too long.
COPY --chown=agent:agent tools/ /work/
USER agent
# Flutter publishes its SDK for Linux on x64 only, and Docker on a Mac with Apple silicon builds arm64 images:
# there mise has no download for it and stops. Flutter's git repository runs there, at the tag of the version
# the folder names: the flutter command fetches the Dart SDK of this system when it first starts, and
# `mise link` makes that the version mise has, so `mise install` skips it here and in every container.
# https://mise.jdx.dev/cli/link.html
# ponytail: each container's first `flutter create` or `flutter test` still fetches about 170 MB of engine
# files. Run `flutter precache` here with the platforms sessions need if that wait matters.
RUN cd /work && if [ "$(uname -m)" = aarch64 ] && v=$(mise current flutter 2>/dev/null) && [ -n "$v" ]; then \
      git clone -q -c advice.detachedHead=false --depth 1 -b "$v" https://github.com/flutter/flutter.git "/opt/mise/flutter-$v" \
      && "/opt/mise/flutter-$v/bin/flutter" --version --suppress-analytics \
      && mise link "flutter@$v" "/opt/mise/flutter-$v"; fi
RUN cd /work && if [ -e mise.toml ] || [ -e .mise.toml ] || [ -e .tool-versions ]; then mise install && mise ls && rm -rf /home/agent/.cache/mise; fi
USER root

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
