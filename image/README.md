# Disk image

The sandbox boots a Debian **i386** root filesystem packed as an ext2 image.
The image is read-only for every visitor; each session writes to its own
IndexedDB overlay that is deleted on Stop.

Until you host your own, the app uses the public WebVM Debian image (fine for
evaluation). Build this one to control the package list, lessons and size.

## Build

Requirements: Docker (Docker Desktop on Windows/macOS). Nothing else; the
ext2 step runs inside a container.

```bash
cd image
./build-ext2.sh v1 900M        # -> image/out/rootfs-v1.ext2
```

- `Dockerfile` installs bash, coreutils, git, nano, vim (tiny), tree, tmux,
  python3, jq, gcc/make, man pages and the lessons in `lessons/`.
- The rootfs is streamed from `docker export` into `mkfs.ext2 -d`, so owners
  and permissions are preserved even on Windows hosts.
- Keep it small: every block a learner touches is downloaded on first launch.
  Drop `gcc libc6-dev` (~150 MB) if you don't teach C. Shrink `SIZE` to the
  smallest value that still leaves free space for learners' files.

Always bump the version (`v2`, `v3`, …) when you change the image. The file is
cached as immutable, so an in-place update would mix old and new blocks.

## Test locally

```bash
npm run serve:image                       # serves image/out on :8081 with range + CORS + CORP
NEXT_PUBLIC_IMAGE_URL=http://localhost:8081/rootfs-v1.ext2 npm run dev
```

`NEXT_PUBLIC_IMAGE_TYPE` defaults to `bytes` (HttpBytesDevice) whenever
`NEXT_PUBLIC_IMAGE_URL` is set.

Acceptance: the VM boots, and `git --version; python3 --version; tree --version; jq --version; tmux -V` all succeed.

## Host it on a CDN

The server must:

| Requirement | Header / setting |
|---|---|
| Range requests | `Accept-Ranges: bytes`, answers `Range:` with `206` |
| CORS | `Access-Control-Allow-Origin: https://your-site` (or `*`), expose `Content-Range, Content-Length` |
| Cross-origin isolation | `Cross-Origin-Resource-Policy: cross-origin` (the app sends COEP `require-corp`) |
| Caching | `Cache-Control: public, max-age=31536000, immutable` |

### Cloudflare R2

1. Create a bucket, upload `rootfs-v1.ext2`, and connect a custom domain
   (public `r2.dev` URLs are rate limited).
2. Bucket → Settings → CORS policy:

   ```json
   [{ "AllowedOrigins": ["https://your-site.example"], "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["Range"], "ExposeHeaders": ["Content-Range", "Content-Length", "Accept-Ranges"],
      "MaxAgeSeconds": 86400 }]
   ```
3. Add a Transform Rule (Modify Response Header) on the domain that sets
   `Cross-Origin-Resource-Policy: cross-origin` and the `Cache-Control` above.

### AWS S3 + CloudFront

1. Upload with `aws s3 cp out/rootfs-v1.ext2 s3://bucket/ --cache-control "public, max-age=31536000, immutable"`.
2. Add the same CORS rules to the bucket.
3. In CloudFront, forward the `Origin` and `Range` headers (or use the
   `CORS-S3Origin` origin request policy) and attach a response headers policy
   that adds `Cross-Origin-Resource-Policy: cross-origin`.

Check it from a terminal:

```bash
curl -sI -r 0-1023 -H "Origin: https://your-site.example" https://cdn.example/rootfs-v1.ext2
# expect: 206, Content-Range, Access-Control-Allow-Origin, Cross-Origin-Resource-Policy: cross-origin
```

Then set `NEXT_PUBLIC_IMAGE_URL=https://cdn.example/rootfs-v1.ext2` and redeploy.

Never put secrets in the image: anyone can download it.
