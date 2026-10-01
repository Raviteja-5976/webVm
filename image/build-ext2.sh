#!/usr/bin/env bash
# Build the Debian i386 rootfs and pack it into an ext2 disk image.
#
#   ./build-ext2.sh [version] [size]     e.g. ./build-ext2.sh v1 900M
#
# Needs only Docker. The rootfs is never unpacked on the host: `docker export`
# is streamed into a helper container that runs mkfs.ext2, so file ownership
# and permissions survive even on Windows/macOS hosts.
set -euo pipefail

cd "$(dirname "$0")"
VERSION="${1:-v1}"
SIZE="${2:-900M}"
TAG="browser-linux-rootfs:${VERSION}"
OUT="out/rootfs-${VERSION}.ext2"

mkdir -p out
echo "==> Building ${TAG} (linux/386)"
docker build --platform linux/386 -t "${TAG}" .

CID="$(docker create --platform linux/386 "${TAG}")"
trap 'docker rm -f "${CID}" >/dev/null 2>&1 || true' EXIT

echo "==> Packing ${OUT} (${SIZE})"
# MSYS_NO_PATHCONV stops Git Bash on Windows from rewriting /out into a Windows path.
docker export "${CID}" | MSYS_NO_PATHCONV=1 docker run --rm -i -v "$(pwd)/out:/out" debian:bookworm-slim sh -euc "
  apt-get update -qq >/dev/null && apt-get install -y -qq e2fsprogs >/dev/null
  mkdir /rootfs && tar -x -p --numeric-owner -C /rootfs
  # Docker bind-mounts these at runtime; give the VM sane defaults.
  echo 'nameserver 127.0.0.1' > /rootfs/etc/resolv.conf
  printf '127.0.0.1 localhost sandbox\n' > /rootfs/etc/hosts
  echo sandbox > /rootfs/etc/hostname
  rm -f /out/$(basename "${OUT}")
  mkfs.ext2 -q -b 4096 -L sandbox -d /rootfs /out/$(basename "${OUT}") ${SIZE}
  e2fsck -fn /out/$(basename "${OUT}") >/dev/null && echo 'filesystem check: clean'
"

ls -lh "${OUT}"
echo "==> Built ${OUT}"
echo "    Local test:  npm run serve:image   then   NEXT_PUBLIC_IMAGE_URL=http://localhost:8081/rootfs-${VERSION}.ext2 npm run dev"
