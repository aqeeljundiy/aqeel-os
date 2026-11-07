# Dokploy API gotchas

Learned the hard way. Procedure names can change between Dokploy versions; confirm with `settings.getOpenApiDocument`.

## Calling the API
- Use curl. Behind Cloudflare, some scripting libraries' default user agent gets `error 1010`.
- On `BAD_REQUEST`, read `data.zodError.fieldErrors`. The docs often omit required siblings.
- Responses can echo passwords (for example `postgres.deploy`). Write them to a file, never print them.

## Required fields the docs leave out
- `application.saveEnvironment` also needs `buildArgs`, `buildSecrets`, `createEnvFile` (null or false is fine).
- `application.saveGitProvider` also needs `watchPaths` and `enableSubmodules`.
- `domain.generateDomain`: POST `{appName}` only. Adding `serverId:null` fails validation.
- `mounts.update` needs `serviceType` and the service id, or it silently keeps the old path.

## Logs
- Build logs: `GET deployment.readLogs?deploymentId=..&tail=N`. Other names (readLog, getLog) 404. Read logs before guessing causes.
- Runtime logs: `GET application.readLogs?applicationId=..&tail=N&search=..`.
- Containers: `docker.getContainersByAppNameMatch?appName=..`.
- To confirm what was built, read the build step in the log rather than fetching big JS bundles.

## Sources and builds
- Private repo owned by another account: the GitHub app may LIST it but cloning fails with `Repository not found`. Fix: `saveGitProvider` with a custom URL that carries a token from the secret store (`https://x-access-token:<token>@github.com/owner/repo.git`). Never print that URL.
- Static Vite or React previews build fastest as a Dockerfile (node build, then nginx:alpine on port 80). Create the domain with port 80.
- A demo build of an app that needs a backend: add a build-time demo flag that mocks API calls with sample data, and serve it from a separate `Dockerfile.<name>-demo` (never named `Dockerfile`, so the real deploy does not pick it up). Point Dokploy at it with `application.update {buildType:"dockerfile", dockerfile:"Dockerfile.<name>-demo"}`.
- Some popular images stop pulling over time. If a pull fails, look for a maintained mirror image and check its data path and env names, which often differ.
- Build locally first when you can, so Dokploy builds are not your test loop.

## Domains and reachability
- Generated hosts (wildcard DNS names) embed the server IP. If your own network exit cannot reach them, check from outside with a public HTTP checker (pace requests, they rate-limit) or ask the person to open the link.
- A wildcard certificate on a proxy usually covers one subdomain level only, not deeper.

## Local tooling
- A stale npm proxy setting breaks installs with errors like ECONNREFUSED. Override with `--proxy=null --https-proxy=null --registry=https://registry.npmjs.org/`.
- Fetching many files from a live site in parallel can get your IP blocked. Keep it to a few at a time.
