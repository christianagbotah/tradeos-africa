#!/bin/bash
set -euo pipefail
# Hosted-runner-only fixture. Never execute against real installed paths.
(( EUID == 0 )) || exit 64
source_script="$(realpath "$(dirname "$0")/../ops/release/upgrade-root-signed-extractor.sh")"
fixture="$(mktemp -d /root/tradeos-extractor-qa.XXXXXXXX)"
cleanup(){ [[ "$fixture" == /root/tradeos-extractor-qa.* && -d "$fixture" && ! -L "$fixture" ]] && rm -rf --one-file-system -- "$fixture"; }
trap cleanup EXIT
checkout="$fixture/source"
root="$fixture/tools"
locks="$fixture/locks"
bin="$fixture/bin"
mkdir -p "$checkout/ops/release" "$root" "$locks" "$bin"
files=(verify-attested-runtime-release.sh inspect-ci-artifact-pilot.py
  rehearse-ci-artifact-pilot.py rehearse-signed-runtime-release.py
  check-promotion-migrations.mjs check-promotion-finance.mjs
  check-signed-release-readiness.mjs check-root-backup-evidence.py
  signed-release-intake.sh signed-release-activate.sh activate-signed-runtime.mjs
  controlled-cutover.mjs release-retention-plan.mjs verify-runtime-tree.mjs
  root-signed-intake-entrypoint.sh root-signed-activate-entrypoint.sh)
for name in "${files[@]}"; do printf 'fixture source %s\n' "$name" > "$checkout/ops/release/$name"; done
git -C "$checkout" init -q
git -C "$checkout" -c user.name=QA -c user.email=qa@example.invalid add .
git -C "$checkout" -c user.name=QA -c user.email=qa@example.invalid commit -qm initial
old="$(git -C "$checkout" rev-parse HEAD)"
for kind in intake activate; do
  current="$root/tradeos-signed-$kind"
  mkdir -m 0755 "$current"
  selected=(verify-attested-runtime-release.sh inspect-ci-artifact-pilot.py
    rehearse-ci-artifact-pilot.py rehearse-signed-runtime-release.py
    check-promotion-migrations.mjs check-promotion-finance.mjs
    check-signed-release-readiness.mjs check-root-backup-evidence.py)
  if [[ "$kind" == intake ]]; then selected+=(signed-release-intake.sh)
  else selected+=(signed-release-activate.sh activate-signed-runtime.mjs controlled-cutover.mjs release-retention-plan.mjs verify-runtime-tree.mjs); fi
  for name in "${selected[@]}"; do install -m 0644 "$checkout/ops/release/$name" "$current/$name"; done
  install -m 0755 "$checkout/ops/release/root-signed-$kind-entrypoint.sh" "$bin/lightworld-tradeos-signed-$kind"
  printf '%s\n' "$old" > "$current/installer-source-commit"
  sha256sum "$bin/lightworld-tradeos-signed-$kind" | cut -d' ' -f1 > "$current/entrypoint-sha256"
  (cd "$current" && sha256sum "${selected[@]}" installer-source-commit entrypoint-sha256 > SHA256SUMS)
done
printf 'fixture extractor updated\n' > "$checkout/ops/release/rehearse-ci-artifact-pilot.py"
git -C "$checkout" -c user.name=QA -c user.email=qa@example.invalid commit -qam extractor
sha="$(git -C "$checkout" rev-parse HEAD)"
# Exercise actual script with only fixed root paths mapped into the fixture
# and GitHub main lookup replaced by a deterministic local function.
# A second test-only function simulates failure after the old directory moves.
python3 - "$source_script" "$fixture" "$sha" <<'PY'
import pathlib,sys
source=pathlib.Path(sys.argv[1]).read_text()
root,sha=sys.argv[2:]
for before,after in {
    'ROOT=/usr/local/libexec/lightworld-deploy':f'ROOT={root}/tools',
    'LOCK_DIR=/var/lock/lightworld-deploy':f'LOCK_DIR={root}/locks',
    'ENTRY="/usr/local/sbin/lightworld-tradeos-signed-$kind"':f'ENTRY="{root}/bin/lightworld-tradeos-signed-$kind"',
    'trusted_chain /usr/local/sbin':f'trusted_chain {root}/bin',
}.items():
    assert source.count(before)==1,before
    source=source.replace(before,after)
marker='umask 077\n'
assert source.count(marker)==1
source=source.replace(marker,marker+f'gh() {{ printf "%s\\n" "{sha}"; }}\n'
    + 'mv() { if [[ "${QA_FAIL_MOVE:-0}" == 1 && "$*" == *"/.tradeos-signed-activate-extractor."* && "$*" == *"/tradeos-signed-activate" ]]; then return 73; fi; /usr/bin/mv "$@"; }\n')
pathlib.Path(root,'exercise.sh').write_text(source)
PY
exercise="$fixture/exercise.sh"
check(){ (cd "$1" && sha256sum -c --strict --status SHA256SUMS); }
run(){ /bin/bash "$exercise" "$1" "$checkout" "$sha" "$2"; }
reject(){ local code="$1"; shift; set +e; "$@"; local got=$?; set -e; [[ "$got" == "$code" ]] || { echo "Expected $code got $got" >&2; exit 1; }; }
intake="$root/tradeos-signed-intake"
activate="$root/tradeos-signed-activate"
# Tampered bytes rejected with no change to original installed directory.
cp "$intake/check-promotion-finance.mjs" "$fixture/original"
printf 'tamper\n' >> "$intake/check-promotion-finance.mjs"
reject 65 run intake --check
install -m 0644 "$fixture/original" "$intake/check-promotion-finance.mjs"
check "$intake"
run intake --check
[[ ! -e "$intake-extractor-rollback" ]]
# App and global locks must refuse upgrade without replacing tools.
(
  flock -n 9
  reject 75 run intake --upgrade
) 9>"$locks/heavy-deploy.lock"
(
  flock -n 9
  reject 75 run intake --upgrade
) 9>"$locks/tradeos-africa.staging.lock"
[[ "$(cat "$intake/installer-source-commit")" == "$old" ]]
run intake --upgrade
check "$intake"
check "$intake-extractor-rollback"
[[ "$(cat "$intake/installer-source-commit")" == "$sha" ]]
[[ "$(cat "$intake-extractor-rollback/installer-source-commit")" == "$old" ]]
cmp "$intake/rehearse-ci-artifact-pilot.py" "$checkout/ops/release/rehearse-ci-artifact-pilot.py"
for name in "$intake"/*; do
  case "$(basename "$name")" in rehearse-ci-artifact-pilot.py|installer-source-commit|SHA256SUMS) continue;; esac
  cmp "$name" "$intake-extractor-rollback/$(basename "$name")"
done
reject 65 run intake --upgrade
# Fault injection between moves must restore the original valid toolset.
QA_FAIL_MOVE=1 reject 73 run activate --upgrade
check "$activate"
[[ "$(cat "$activate/installer-source-commit")" == "$old" ]]
[[ ! -e "$activate-extractor-rollback" ]]
run activate --upgrade
check "$activate"
check "$activate-extractor-rollback"
[[ "$(cat "$activate/installer-source-commit")" == "$sha" ]]
echo 'Isolated extractor upgrade, tamper refusal, lock contention, rollback and retry passed.'
