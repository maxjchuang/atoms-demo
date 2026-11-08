# atoms-v03 image inputs

Only new atoms-v03 tags/resources are owned here. Cached atoms-review derived images are not used.

- Node26.5.0 Debian bookworm-slim, official Docker Library mirror: public.ecr.aws/docker/library/node index sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb; selected linux/arm64/v8 sha256:9e5d714311940c098479ec352029af6df1d9a2dc4269b29373c616f51640dd67. Supervisor independently resolved upstream nodejs/docker-node source defa701ab674e5a90ce5adf718bca41b91a46794:26/bookworm-slim.
- Official Playwright1.56.1 noble image, documented at https://playwright.dev/docs/docker : mcr.microsoft.com/playwright:v1.56.1-noble index sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a; selected linux/arm64 sha256:0dbd754198e27995355163ddb7e4e0d727eb841eade98df3432cd4daea772e91. Read-only registry resolution recorded /tmp/atoms-v03-playwright-base-manifest.log. Copy the pinned Node/npm into that browser-system base; verify actual runtime Node/browser/sandbox, not image env version strings.

The initial direct Docker Hub Node pull timed out (record /tmp/atoms-v03-dockerio-first-failure.log). The subsequent from-Node Playwright install build timed out after its exact15min bound with Chromium download showing100%; this is not a sandbox failure and cannot distinguish EOF/extract from that log. That failed build's progress is /tmp/atoms-v03-job-build-progress.log and result /tmp/atoms-v03-job-image-build-second.log. Supervisor approved one <=15min alternate using the matching official preinstalled browser; no policy is relaxed and no host/review-image fallback exists.

Tool versions/lock, public template/lock and the complete white-listed build context hash bind the newly built image. No key/.env/native-home/user data is copied. Readiness remains false until actual offline install, sandboxed Chromium and full isolation probes pass.
