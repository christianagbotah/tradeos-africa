#!/usr/bin/env bash
set -euo pipefail

# CI-built pilot ONLY. Intentionally contains no VPS extract/switch capability.
# Run after building apps/web and apps/system-admin in TRADEOS_CI_ARTIFACT=1
# mode and building apps/api plus its workspace packages.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
sha="${1:-}"
output="${2:-}"
if [[ "${CI:-}" != 'true' || ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Requires CI=true and the full verified GitHub SHA' >&2
  exit 64
fi
if [[ -z "$output" || "$output" != /* || "$output" == '/' || "$output" == "$repo_root"* ]]; then
  echo 'Output must be an absolute CI temporary path outside the repository' >&2
  exit 64
fi
if [[ "${TRADEOS_CI_ARTIFACT:-}" != '1' || "${TRADEOS_RELEASE_SHA:-}" != "$sha" ]]; then
  echo 'Refusing to package bundles without the matching CI release identity' >&2
  exit 64
fi
if [[ -n "${GITHUB_SHA:-}" && "${GITHUB_SHA,,}" != "$sha" ]]; then
  echo 'Requested source SHA does not match GitHub Actions checkout' >&2
  exit 64
fi
if [[ -z "${RUNNER_TEMP:-}" || "$RUNNER_TEMP" != /* || "$output" != "$RUNNER_TEMP/"* ]]; then
  echo 'Artifacts must be created only inside the GitHub runner temporary directory' >&2
  exit 64
fi

for app in web system-admin; do
  if [[ ! -d "$repo_root/apps/$app/.next/standalone" || ! -d "$repo_root/apps/$app/.next/static" ]]; then
    echo "Missing CI standalone output for $app" >&2
    exit 65
  fi
done
if [[ ! -f "$repo_root/apps/api/dist/server.js" || ! -d "$repo_root/packages/db/migrations" ]]; then
  echo 'Missing compiled API or migrations' >&2
  exit 65
fi

mkdir -p -- "$output"
work="$(mktemp -d "$RUNNER_TEMP/tradeos-artifact-pilot.XXXXXXXX")"
trap 'rm -rf -- "$work"' EXIT
stage="$work/bundle"
mkdir -p "$stage/apps/api" "$stage/apps/web" "$stage/apps/system-admin" \
  "$stage/packages/db" "$stage/bin"

# The official source-light launchers resolve their runtime from their own
# bundle path and load the production environment from a separate file.
# No pnpm installation, Next CLI or checkout is needed after CI packaging.
cp -a -- "$repo_root/ops/release/runtime/bin/." "$stage/bin/"
for script in start-api.sh start-web.sh start-system-admin.sh runtime-env.sh; do
  if [[ ! -f "$stage/bin/$script" || ! -x "$stage/bin/$script" ]]; then
    echo "Missing executable source-light runtime launcher $script" >&2
    exit 65
  fi
done

# API: isolated pnpm production dependency graph; no dev/test checkout shipped.
# --legacy is required for pnpm 10 workspaces without injected dependencies.
pnpm --filter @tradeos/api deploy --prod --legacy "$work/api-deploy"
cp -a -- "$work/api-deploy/dist" "$work/api-deploy/node_modules" \
  "$work/api-deploy/package.json" "$stage/apps/api/"
# pnpm --legacy deploy may retain an internal self-package link pointing to
# the former monorepo layout. Rebase ONLY this known self-alias to the isolated
# API package root; do not ignore other broken or externally escaping links.
self_alias="$stage/apps/api/node_modules/.pnpm/node_modules/@tradeos/api"
if [[ -L "$self_alias" ]]; then
  rm -- "$self_alias"
  ln -s -- ../../../../ "$self_alias"
fi

# Both Next traced standalone bundles are produced in GitHub, never on VPS.
for app in web system-admin; do
  cp -a -- "$repo_root/apps/$app/.next/standalone/." "$stage/apps/$app/"
  if [[ -f "$stage/apps/$app/apps/$app/server.js" ]]; then
    server_relative="apps/$app/server.js"
  elif [[ -f "$stage/apps/$app/server.js" ]]; then
    server_relative="server.js"
  else
    echo "No standalone server.js found for $app" >&2
    exit 65
  fi
  mkdir -p -- "$(dirname "$stage/apps/$app/$server_relative")/.next"
  cp -a -- "$repo_root/apps/$app/.next/static" \
    "$(dirname "$stage/apps/$app/$server_relative")/.next/static"
  if [[ -d "$repo_root/apps/$app/public" ]]; then
    cp -a -- "$repo_root/apps/$app/public" "$(dirname "$stage/apps/$app/$server_relative")/public"
  fi
  printf '%s\n' "$server_relative" > "$stage/apps/$app/entrypoint.txt"
done

cp -a -- "$repo_root/packages/db/migrations" "$stage/packages/db/"
# Not an executable deployment recipe: current production launcher remains in
# place until a separate migration with proven auth, migration & rollback safety.
node - "$stage/manifest.json" "$sha" <<'NODE'
const fs=require('node:fs');
const [file, sha]=process.argv.slice(2);
fs.writeFileSync(file,JSON.stringify({
  schemaVersion:1,
  type:'TRADEOS_CI_RUNTIME_ARTIFACT_PILOT',
  deployable:false,
  sourceCommit:sha,
  buildLocation:'GitHub Actions ubuntu-latest',
  requiredNodeMajor:22,
  includes:['API production runtime','Web standalone runtime','Admin standalone runtime','SQL migrations','Node 22 source-light launchers'],
  excludes:['environment files','database contents','uploads','payment records','rollback snapshots'],
},null,2)+'\n');
NODE

# Validate expected payload and reject accidental secret/development sources.
node - "$stage" <<'NODE'
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2]);
for(const p of ['apps/api/dist/server.js','apps/api/node_modules','apps/web/entrypoint.txt',
  'apps/system-admin/entrypoint.txt','packages/db/migrations','manifest.json',
  'bin/start-api.sh','bin/start-web.sh','bin/start-system-admin.sh','bin/runtime-env.sh']) {
  if(!fs.existsSync(path.join(root,p))) throw new Error('Missing runtime payload '+p);
}
for(const app of ['web','system-admin']){
  const rel=fs.readFileSync(path.join(root,'apps',app,'entrypoint.txt'),'utf8').trim();
  if(!['server.js',`apps/${app}/server.js`].includes(rel) ||
      !fs.existsSync(path.join(root,'apps',app,rel))) throw new Error('Unsafe Next server entrypoint');
}
// Third-party runtime dependencies may legitimately contain folders named src
// or test. Reject our OWN source trees and release-local credential files.
for(const p of ['apps/api/src','apps/api/test','apps/web/app','apps/system-admin/app',
                'node_modules','.git','.env','.env.staging','.env.local']){
  if(fs.existsSync(path.join(root,p))) throw new Error('Development/private payload: '+p);
}
function visit(dir){
  for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const name=path.join(dir,item.name);
    if(item.isSymbolicLink()){
      const resolved=fs.realpathSync(name);
      if(resolved!==root&&!resolved.startsWith(root+path.sep)) throw new Error('External runtime symlink '+name);
    }else if(item.isDirectory()) visit(name);
  }
}
visit(root);
NODE

archive="$output/tradeos-runtime-pilot-$sha.tar.gz"
# Deterministic metadata: archive can be independently rehashed upon retrieval.
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -czf "$archive" -C "$stage" .
(
  cd "$output"
  sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256"
  sha256sum --check "$(basename "$archive").sha256"
)
cp -- "$stage/manifest.json" "$output/tradeos-runtime-pilot-$sha.manifest.json"
printf 'ARTIFACT_PILOT=%s\n' "$archive"
du -h "$archive"
