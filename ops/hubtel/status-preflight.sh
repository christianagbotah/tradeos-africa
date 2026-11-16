#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo 'usage: status-preflight.sh /absolute/path/to/server-private-env' >&2
  exit 64
fi
path="$1"
if [[ "$path" != /* || ! -f "$path" || -L "$path" ]]; then
  echo 'Private environment file unavailable or unsafe' >&2
  exit 1
fi
for key in TRADEOS_HUBTEL_API_ID TRADEOS_HUBTEL_API_KEY TRADEOS_HUBTEL_COLLECTION_ACCOUNT; do
  if awk -F= -v key="$key" '$1==key && length($2)>0 {found=1} END {exit !found}' "$path"; then
    printf '%s: present (value not shown)\n' "$key"
  else
    printf '%s: absent or empty\n' "$key"
  fi
done
printf 'Outbound IPv4: '
curl -4 --fail --silent --show-error --max-time 8 'https://ifconfig.me' || echo '[unable to determine]'
printf '\nHubtel hostname: '
getent ahostsv4 api-txnstatus.hubtel.com | awk 'NR==1{print $1}' || true
code="$(curl --silent --show-error --max-time 8 --output /dev/null --write-out '%{http_code}' 'https://api-txnstatus.hubtel.com/' || true)"
printf 'Anonymous TLS connectivity: HTTP %s (NOT an authenticated payment-status check)\n' "$code"
echo 'Stop: status cannot be certified until a real authenticated test transaction succeeds.'
