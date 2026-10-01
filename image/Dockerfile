# Root filesystem for the browser sandbox.
# CheerpX runs 32-bit x86 Linux, so this must be an i386 userland.
# Debian 12 (bookworm) is the last release with full i386 support.
FROM --platform=linux/386 i386/debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# The slim image strips man pages; learners want `man`, so keep them
# (docs and most locales stay excluded to keep the image small).
RUN find /etc/dpkg/dpkg.cfg.d -type f -exec sed -i '/\/usr\/share\/man/d' {} + \
 && printf 'path-exclude=/usr/share/doc/*\npath-include=/usr/share/doc/*/copyright\npath-exclude=/usr/share/locale/*\npath-include=/usr/share/locale/en*\n' \
      > /etc/dpkg/dpkg.cfg.d/01-sandbox-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash bash-completion coreutils util-linux procps findutils grep sed gawk less man-db manpages \
    git nano vim-tiny tree tmux curl wget ca-certificates file bc \
    python3 jq zip unzip tar gzip bzip2 xz-utils \
    make gcc libc6-dev \
    sudo locales \
 && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
 && (update-alternatives --set vi /usr/bin/vim.tiny 2>/dev/null || true) \
 && ln -sf /usr/bin/vim.tiny /usr/local/bin/vim \
 && apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /var/log/*.log /tmp/*

# Unprivileged learner account (uid/gid 1000 is what the app runs as).
RUN useradd -m -s /bin/bash -u 1000 user \
 && echo "user ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/user \
 && chmod 0440 /etc/sudoers.d/user \
 && echo sandbox > /etc/hostname

# Learning content
COPY lessons/ /home/user/lessons/

# Friendly prompt and a git identity so commits work offline out of the box.
RUN echo 'PS1="\[\e[1;32m\]\u@sandbox\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ "' >> /home/user/.bashrc \
 && git config --system init.defaultBranch main \
 && git config --system user.name "Learner" \
 && git config --system user.email "learner@example.com" \
 && chown -R user:user /home/user

USER user
WORKDIR /home/user
CMD ["/bin/bash", "--login"]
