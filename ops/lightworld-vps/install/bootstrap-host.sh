#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  printf 'bootstrap-host.sh must run as root\n' >&2
  exit 77
fi

usage() {
  printf 'usage: bootstrap-host.sh [--tradeos]\n' >&2
}

if [[ "$#" -gt 1 ]]; then usage; exit 64; fi
mode="${1:-}"
if [[ -n "$mode" && "$mode" != '--tradeos' ]]; then usage; exit 64; fi

install -d -o root -g root -m 0755 /opt/github-runners
install -d -o root -g root -m 0755 /etc/lightworld-deploy
install -d -o root -g root -m 0755 /etc/lightworld-deploy/apps.d
install -d -o root -g root -m 0755 /var/lib/lightworld-deploy
install -d -o root -g root -m 0755 /var/lib/lightworld-deploy/runners
install -d -o root -g root -m 0755 /var/lock/lightworld-deploy

if [[ "$mode" == '--tradeos' ]]; then
  if ! id lwrun_tradeos >/dev/null 2>&1; then
    useradd --system --create-home \
      --home-dir /var/lib/lightworld-deploy/runners/lwrun_tradeos \
      --shell /usr/sbin/nologin \
      --user-group lwrun_tradeos
  fi

  install -d -o root -g root -m 0755 /opt/github-runners/christianagbotah
  install -d -o root -g root -m 0755 /opt/github-runners/christianagbotah/tradeos-africa
  install -d -o lwrun_tradeos -g lwrun_tradeos -m 0750 \
    /opt/github-runners/christianagbotah/tradeos-africa/staging
  install -d -o lwrun_tradeos -g lwrun_tradeos -m 0750 \
    /var/lib/lightworld-deploy/runners/lwrun_tradeos
fi

printf 'Lightworld runner host bootstrap complete\n'
