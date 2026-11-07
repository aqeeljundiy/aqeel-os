---
name: dokploy-deploy
description: Use when the person wants a site, draft or branch online on their Dokploy server. Deploy it in the previews project and send a link you checked loads.
---

# Dokploy: deploy and preview sites

Put a site or a git branch online on the person's Dokploy server and send a preview link. Also covers reading apps, deploys, logs and domains there.

## Local values
Everything specific to this install is in references/local.md next to this skill (kept on this server, never shared): the Dokploy URL, where the API token is stored, the previews project name, which domains may be used, and anything that must not be touched. Example:

```
- DOKPLOY_URL: https://dokploy.acme.com
- Token: saved secret DOKPLOY_TOKEN (read from the secret store, never print it)
- Previews project: "Agent previews"
- Domain for previews: Dokploy's generated host by default; acme.com only when asked
- Do not touch: project "Control panel" (the agent's own server)
- Client hosting not to use for previews: Acme's other host
```

## API basics
- Call `$DOKPLOY_URL/api/<procedure>` with header `x-api-key: <token>`. Never print the token.
- GET takes input fields as query params; POST takes JSON. The full list: `GET /api/settings.getOpenApiDocument`.
- Use `curl`. If the host is behind Cloudflare, scripting libraries with a bare user agent can get `error code: 1010`. Build long JSON bodies into a file and POST with `-d @file`.
- On `Input validation failed / BAD_REQUEST`, print `data.zodError.fieldErrors` instead of guessing. It names every field the schema wants, including siblings the docs leave out.
- If the server only answers on a named URL and not its raw IP from where you run, that is a routing matter, not a firewall. Do not ask the person to open ports.
- More traps: references/api-gotchas.md.

## Rules
- Previews live in one previews project. Create it once if missing (`project.create {name}`; it gets a "production" environment). Make, change, redeploy and delete apps there freely.
- Ask first before you delete, stop or redeploy anything outside that project, or change its settings, env vars or domains. Never touch the project that runs the agent itself.
- Reading anything (status, logs, settings) needs no permission, but never repeat other projects' secrets or env values.
- A client's own hosting is only used when the person says so; previews go on Dokploy.

## Make a preview from a git branch
1. `project.all` gives the previews project's environmentId.
2. `application.create {name, environmentId}` gives applicationId and appName.
3. Source:
   - `github.githubProviders` lists GitHub connections; `github.getGithubRepositories {githubId}` shows which repos each can see. Then `application.saveGithubProvider {applicationId, githubId, owner, repository, branch, buildPath:"/", triggerType:"push"}`. Every push to that branch redeploys.
   - Repo not visible: tell the person which repo, and that they can add it to the GitHub app's repository access. Or, with their OK, use `application.saveGitProvider` with an https URL.
4. Build: `application.saveBuildType {applicationId, buildType:"nixpacks"}` (fill other required fields with "" or null as the schema says). Most Node sites build with nixpacks. With a Dockerfile: `application.update {applicationId, buildType:"dockerfile", dockerfile:"Dockerfile", sourceType}`.
   Before a Dockerfile build, check every `COPY` source path exists in git. A missing committed folder (for example `public/`) fails the last layer after an otherwise good build. Commit a placeholder file rather than editing the Dockerfile.
5. Env vars if needed: `application.saveEnvironment {applicationId, env:"KEY=value\n...", buildArgs:null, buildSecrets:null, createEnvFile:false}`. All three siblings are required. Use preview or test values; ask before using production keys.
   An app that needs its own database: `postgres.create {name, appName, databaseName, databaseUser, databasePassword, dockerImage:"postgres:16", environmentId}`, then `postgres.deploy {postgresId}`. The connection host is the RETURNED appName (Dokploy adds a suffix), so build the URL from the response.
6. Address: default to Dokploy's throwaway domain. `domain.generateDomain {appName}` only RETURNS a hostname; pass it to `domain.create {applicationId, host, port, https, certificateType, domainType:"application"}` to make it live. Use the person's own domain only when they ask in that message and local.md allows it.
7. `application.deploy {applicationId}`, then poll `deployment.all {applicationId}` until status is "done" or "error". On error, read the build log (`deployment.readLogs`) before guessing a cause.
8. Open the link yourself and check it loads before sending it. If you cannot reach it from where you run, say so and verify another way; never claim a preview works unseen.
9. Reply with the link and what it shows. Offer to delete it when no longer needed (`application.delete`).
