# atoms-v03 image inputs

Only new atoms-v03 tags/resources are owned here. Cached atoms-review derived images are not used.

- Node26.5.0 Debian bookworm-slim, official Docker Library mirror: public.ecr.aws/docker/library/node index sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb; selected linux/arm64/v8 sha256:9e5d714311940c098479ec352029af6df1d9a2dc4269b29373c616f51640dd67. Supervisor independently resolved upstream nodejs/docker-node source defa701ab674e5a90ce5adf718bca41b91a46794:26/bookworm-slim.
- Official Playwright1.56.1 noble image, documented at https://playwright.dev/docs/docker : mcr.microsoft.com/playwright:v1.56.1-noble index sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a; selected linux/arm64 sha256:0dbd754198e27995355163ddb7e4e0d727eb841eade98df3432cd4daea772e91. Read-only registry resolution recorded /tmp/atoms-v03-playwright-base-manifest.log. Copy the pinned Node/npm into that browser-system base; verify actual runtime Node/browser/sandbox, not image env version strings.

The initial direct Docker Hub Node pull timed out (record /tmp/atoms-v03-dockerio-first-failure.log). The subsequent from-Node Playwright install build timed out after its exact15min bound with Chromium download showing100%; this is not a sandbox failure and cannot distinguish EOF/extract from that log. That failed build's progress is /tmp/atoms-v03-job-build-progress.log and result /tmp/atoms-v03-job-image-build-second.log. Supervisor approved one <=15min alternate using the matching official preinstalled browser; no policy is relaxed and no host/review-image fallback exists.

Tool versions/lock, public template/lock and the complete white-listed build context hash bind the newly built image. No key/.env/native-home/user data is copied. Readiness remains false until actual offline install, sandboxed Chromium and full isolation probes pass.

## Native AMD64 addition (2026-11-09)

Read-only official registry manifest resolution confirmed the same pinned indexes contain:

- Node26.5.0 bookworm-slim Linux/AMD64 child `sha256:607728e8751f69809c871e2cfa65d645f51ffacb5a0e9fc60f4cb7404ee5c16a`.
- Playwright1.56.1 noble Linux/AMD64 child `sha256:42f02d323c310069b4d54c94bd91a608966a486c3492c48ae0b1cea747ec5ca2`.

`src/isolation/platform.ts` retains both ARM64 and AMD64 child pins. Agent image builders select the actual Docker daemon platform and pass exact child manifests with `--platform`; job source-context hashing also includes the selected platform/pins. Dockerfile defaults use the already frozen multi-platform indexes. Metadata checks require inspected image architecture, measured job Node architecture and daemon architecture to agree; emulation is not an accepted readiness proof. Clean reports use measured job platform and compare it to the frozen toolchain. New private probe receipts bind the measured platform, so older receipts lacking that field are not ready. All eleven OS gates and the existing seccomp, two-UID, resource, offline and cancellation policies remain unchanged.

Manifest lookup is source provenance only, not image-build, sandbox or deployment success. Fresh native builds and all actual probes are still required on each target daemon.

The current native builders use the canonical official `docker.io/library/node` repository for both architecture pins. The original ECR mirror source returned 401 in the current environment; the supervisor successfully pulled and verified the exact AMD64 child from Docker Hub. Registry spelling changed, not image content, version or verification requirements.
