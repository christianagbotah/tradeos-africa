#!/usr/bin/env bash
set -euo pipefail

lightworld_die() {
  printf 'lightworld-deploy: %s\n' "$*" >&2
  return 1
}

is_test_mode() {
  [[ "${LIGHTWORLD_TEST_MODE:-0}" == "1" ]]
}

validate_identifier() {
  local value="${1-}"
  local label="${2:-identifier}"
  if [[ ! "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
    lightworld_die "invalid ${label}: ${value}"
    return 1
  fi
}

validate_sha() {
  local value="${1-}"
  if [[ ! "$value" =~ ^[0-9a-fA-F]{40}$ ]]; then
    lightworld_die "invalid commit SHA"
    return 1
  fi
}

require_absolute_path() {
  local value="$1"
  local label="$2"
  if [[ "$value" != /* || "$value" == *$'\n'* ]]; then
    lightworld_die "${label} must be an absolute path"
    return 1
  fi
}

_lightworld_registry_root() {
  if is_test_mode; then
    if (( EUID == 0 )); then
      lightworld_die "test registry override is forbidden for root"
      return 1
    fi
    if [[ -z "${LIGHTWORLD_REGISTRY_ROOT:-}" || "${LIGHTWORLD_REGISTRY_ROOT}" != /* ]]; then
      lightworld_die "test registry root must be an absolute path"
      return 1
    fi
    printf '%s\n' "$LIGHTWORLD_REGISTRY_ROOT"
    return 0
  fi
  printf '%s\n' '/etc/lightworld-deploy/apps.d'
}

_lightworld_assert_config_permissions() {
  local file="$1"
  local owner mode perm
  owner="$(stat -c '%u' -- "$file")" || return 1
  mode="$(stat -c '%a' -- "$file")" || return 1
  perm=$((8#$mode))

  if is_test_mode; then
    if (( EUID == 0 )); then
      lightworld_die "test configuration cannot be loaded by root"
      return 1
    fi
    if [[ "$owner" != "$EUID" ]]; then
      lightworld_die "test configuration must be owned by the test user"
      return 1
    fi
  elif [[ "$owner" != "0" ]]; then
    lightworld_die "configuration must be owned by root"
    return 1
  fi

  if (( perm & 022 )); then
    lightworld_die "configuration must not be group/other writable"
    return 1
  fi
}

load_app_config() {
  local app="$1"
  local environment="$2"
  local root file
  validate_identifier "$app" 'app' || return 1
  validate_identifier "$environment" 'environment' || return 1
  root="$(_lightworld_registry_root)" || return 1
  file="${root}/${app}.${environment}.conf"
  if [[ ! -f "$file" || -L "$file" ]]; then
    lightworld_die "configuration not found: ${app}.${environment}"
    return 1
  fi
  _lightworld_assert_config_permissions "$file" || return 1

  # shellcheck disable=SC1090
  source "$file"

  : "${GITHUB_REPO:?configuration missing GITHUB_REPO}"
  : "${CANONICAL_MAIN_URL:?configuration missing CANONICAL_MAIN_URL}"
  : "${MAIN_VERIFY_MODE:?configuration missing MAIN_VERIFY_MODE}"
}

require_release_config() {
  : "${APP_USER:?configuration missing APP_USER}"
  : "${RUNNER_USER:?configuration missing RUNNER_USER}"
  : "${RELEASE_ROOT:?configuration missing RELEASE_ROOT}"
  : "${CURRENT_LINK:?configuration missing CURRENT_LINK}"
  : "${ENV_FILE:?configuration missing ENV_FILE}"
  : "${PROCESS_MANAGER:?configuration missing PROCESS_MANAGER}"
  : "${PROCESS_NAMES:?configuration missing PROCESS_NAMES}"
  : "${LOCAL_HEALTH_URLS:?configuration missing LOCAL_HEALTH_URLS}"
  : "${PUBLIC_HEALTH_URLS:=}"
  : "${RUNTIME_FAMILY:?configuration missing RUNTIME_FAMILY}"
  : "${MIGRATION_MODE:?configuration missing MIGRATION_MODE}"

  require_absolute_path "$RELEASE_ROOT" 'RELEASE_ROOT'
  require_absolute_path "$CURRENT_LINK" 'CURRENT_LINK'
  require_absolute_path "$ENV_FILE" 'ENV_FILE'
  if [[ "$RELEASE_ROOT" == '/' || "$CURRENT_LINK" == '/' ]]; then
    lightworld_die 'release paths may not be filesystem root'
    return 1
  fi
  if ! id "$APP_USER" >/dev/null 2>&1; then
    lightworld_die "APP_USER does not exist"
    return 1
  fi
  if ! id "$RUNNER_USER" >/dev/null 2>&1; then
    lightworld_die "RUNNER_USER does not exist"
    return 1
  fi
  if is_test_mode; then
    if [[ "$APP_USER" != "$(id -un)" ]]; then
      lightworld_die 'test APP_USER must be the current non-root user'
      return 1
    fi
    if [[ "$RUNNER_USER" != "$(id -un)" ]]; then
      lightworld_die 'test RUNNER_USER must be the current non-root user'
      return 1
    fi
  else
    if (( EUID != 0 )); then
      lightworld_die 'production deployment commands must run as root'
      return 1
    fi
    if [[ "$RUNNER_USER" == 'root' ]]; then
      lightworld_die 'RUNNER_USER must be non-root'
      return 1
    fi
  fi
}

run_git_as_runner() {
  local workspace="$1"
  shift
  if is_test_mode; then
    git -C "$workspace" "$@"
    return $?
  fi
  runuser -u "$RUNNER_USER" -- git -C "$workspace" "$@"
}

_normalize_github_repo() {
  local raw="$1"
  raw="${raw%.git}"
  raw="${raw#git@github.com:}"
  raw="${raw#ssh://git@github.com/}"
  raw="${raw#https://github.com/}"
  raw="${raw#http://github.com/}"
  raw="${raw#git://github.com/}"
  printf '%s\n' "$raw"
}

assert_workspace_identity() {
  local workspace="$1"
  local expected_repo="$2"
  local expected_sha="$3"
  local inside head origin normalized workspace_owner expected_owner
  require_absolute_path "$workspace" 'workspace' || return 1
  if [[ ! -d "$workspace" ]]; then
    lightworld_die "workspace does not exist"
    return 1
  fi
  workspace_owner="$(stat -c '%U' -- "$workspace" 2>/dev/null || true)"
  expected_owner="$RUNNER_USER"
  if [[ "$workspace_owner" != "$expected_owner" ]]; then
    lightworld_die "workspace owner does not match configured runner user"
    return 1
  fi
  inside="$(run_git_as_runner "$workspace" rev-parse --is-inside-work-tree 2>/dev/null || true)"
  if [[ "$inside" != 'true' ]]; then
    lightworld_die "workspace is not a Git worktree"
    return 1
  fi
  head="$(run_git_as_runner "$workspace" rev-parse HEAD 2>/dev/null || true)"
  if [[ "${head,,}" != "${expected_sha,,}" ]]; then
    lightworld_die "workspace HEAD does not match requested SHA"
    return 1
  fi
  origin="$(run_git_as_runner "$workspace" remote get-url origin 2>/dev/null || true)"
  normalized="$(_normalize_github_repo "$origin")"
  if [[ "$normalized" != "$expected_repo" ]]; then
    lightworld_die "workspace origin repository does not match configured repository"
    return 1
  fi
}

verify_canonical_main_sha() {
  local requested_sha="$1"
  local remote_output remote_sha
  case "$MAIN_VERIFY_MODE" in
    public-ls-remote|deploy-key) ;;
    *) lightworld_die "unsupported MAIN_VERIFY_MODE"; return 1 ;;
  esac

  if [[ "${LIGHTWORLD_TEST_MAIN_LOOKUP_FAIL:-0}" == '1' ]]; then
    lightworld_die 'canonical main could not be resolved'
    return 1
  fi

  if ! is_test_mode && [[ "$MAIN_VERIFY_MODE" == 'public-ls-remote' ]]; then
    if [[ ! "$CANONICAL_MAIN_URL" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]]; then
      lightworld_die "public canonical URL must be an HTTPS GitHub repository"
      return 1
    fi
  elif is_test_mode && (( EUID == 0 )); then
    lightworld_die "test canonical-main override is forbidden for root"
    return 1
  fi

  remote_output="$(git ls-remote "$CANONICAL_MAIN_URL" refs/heads/main 2>/dev/null || true)"
  remote_sha="$(awk 'NR == 1 {print $1}' <<<"$remote_output")"
  if [[ ! "$remote_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
    lightworld_die "canonical main could not be resolved"
    return 1
  fi
  if [[ "${remote_sha,,}" != "${requested_sha,,}" ]]; then
    lightworld_die "requested SHA is not canonical main"
    return 1
  fi
}

_lightworld_lock_root() {
  if is_test_mode; then
    if (( EUID == 0 )); then
      lightworld_die "test lock override is forbidden for root"
      return 1
    fi
    printf '%s\n' "${LIGHTWORLD_LOCK_ROOT:-${TMPDIR:-/tmp}/lightworld-deploy-locks}"
  else
    printf '%s\n' '/var/lock/lightworld-deploy'
  fi
}

acquire_global_lock() {
  local lock_root fd
  lock_root="$(_lightworld_lock_root)" || return 1
  mkdir -p -- "$lock_root"
  exec {fd}>"${lock_root}/heavy-deploy.lock"
  if ! flock -n "$fd"; then
    lightworld_die "heavy deployment lock is already held"
    return 1
  fi
  LIGHTWORLD_GLOBAL_LOCK_FD="$fd"
}

acquire_app_lock() {
  local app="$1"
  local environment="$2"
  local lock_root lock_file fd
  validate_identifier "$app" 'app' || return 1
  validate_identifier "$environment" 'environment' || return 1
  lock_root="$(_lightworld_lock_root)" || return 1
  mkdir -p -- "$lock_root"
  lock_file="${lock_root}/${app}.${environment}.lock"
  exec {fd}>"$lock_file"
  if ! flock -n "$fd"; then
    lightworld_die "application deployment lock is already held"
    return 1
  fi
  LIGHTWORLD_APP_LOCK_FD="$fd"
}

metadata_dir() {
  printf '%s/.lightworld\n' "$RELEASE_ROOT"
}

read_metadata_sha() {
  local name="$1"
  local file value
  file="$(metadata_dir)/${name}"
  [[ -f "$file" ]] || return 1
  IFS= read -r value < "$file" || true
  validate_sha "$value" >/dev/null 2>&1 || return 1
  printf '%s\n' "${value,,}"
}

write_metadata_sha() {
  local name="$1"
  local sha="$2"
  local dir tmp
  validate_sha "$sha" || return 1
  dir="$(metadata_dir)"
  mkdir -p -- "$dir"
  tmp="${dir}/.${name}.$$"
  printf '%s\n' "${sha,,}" > "$tmp"
  chmod 0644 "$tmp"
  mv -f -- "$tmp" "${dir}/${name}"
}

assert_env_outside_workspace() {
  local workspace="$1"
  local env_real workspace_real
  if [[ ! -f "$ENV_FILE" ]]; then
    lightworld_die 'configured environment file does not exist'
    return 1
  fi
  env_real="$(realpath -- "$ENV_FILE")"
  workspace_real="$(realpath -- "$workspace")"
  case "$env_real" in
    "$workspace_real"|"$workspace_real"/*)
      lightworld_die 'environment file must be outside Git workspace'
      return 1
      ;;
  esac
  LIGHTWORLD_ENV_REAL="$env_real"
}

run_as_app_user() {
  local cwd="$1"
  shift
  if is_test_mode; then
    (cd "$cwd" && "$@")
    return $?
  fi
  runuser -u "$APP_USER" -- bash -c 'cd "$1"; shift; exec "$@"' bash "$cwd" "$@"
}

prepare_release_source() {
  local workspace="$1"
  local sha="$2"
  local release_dir group
  release_dir="${RELEASE_ROOT}/${sha,,}"
  mkdir -p -- "$RELEASE_ROOT" "$(metadata_dir)"

  if [[ -e "$release_dir" || -L "$release_dir" ]]; then
    if [[ -L "$CURRENT_LINK" && "$(realpath -- "$CURRENT_LINK" 2>/dev/null || true)" == "$(realpath -- "$release_dir" 2>/dev/null || true)" ]]; then
      lightworld_die 'refusing to replace the currently active release directory'
      return 1
    fi
    rm -rf -- "$release_dir"
  fi
  mkdir -p -- "$release_dir"
  if is_test_mode; then
    git -C "$workspace" archive --format=tar "$sha" | tar --exclude='.env' --exclude='.env.*' -C "$release_dir" -xf -
  else
    runuser -u "$RUNNER_USER" -- git -C "$workspace" archive --format=tar "$sha" | tar --exclude='.env' --exclude='.env.*' -C "$release_dir" -xf -
  fi

  assert_env_outside_workspace "$workspace" || return 1
  ln -s -- "$LIGHTWORLD_ENV_REAL" "$release_dir/.env.staging"

  if ! is_test_mode; then
    group="$(id -gn "$APP_USER")"
    chown -hR "$APP_USER:$group" "$release_dir"
  fi
  printf '%s\n' "$release_dir"
}

run_release_build() {
  local release_dir="$1"
  case "$RUNTIME_FAMILY" in
    test)
      if ! is_test_mode; then
        lightworld_die 'test runtime is forbidden in production'
        return 1
      fi
      if [[ "${LIGHTWORLD_TEST_BUILD_FAIL:-0}" == '1' ]]; then
        lightworld_die 'simulated build failure'
        return 1
      fi
      run_as_app_user "$release_dir" /usr/bin/env touch .lightworld-build-complete
      ;;
    pnpm-node)
      run_as_app_user "$release_dir" /usr/bin/env pnpm install --frozen-lockfile
      run_as_app_user "$release_dir" /usr/bin/env pnpm build
      ;;
    *)
      lightworld_die "unsupported RUNTIME_FAMILY: $RUNTIME_FAMILY"
      return 1
      ;;
  esac

  case "$MIGRATION_MODE" in
    manual) ;;
    *)
      lightworld_die "unsupported migration mode; automatic migration is disabled"
      return 1
      ;;
  esac
}

activate_release_target() {
  local target="$1"
  local parent tmp
  if [[ ! -d "$target" ]]; then
    lightworld_die "release target does not exist"
    return 1
  fi
  parent="$(dirname "$CURRENT_LINK")"
  mkdir -p -- "$parent"
  if [[ -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then
    lightworld_die 'CURRENT_LINK exists and is not a symlink'
    return 1
  fi
  tmp="${CURRENT_LINK}.next.$$"
  rm -f -- "$tmp"
  ln -s -- "$target" "$tmp"
  mv -Tf -- "$tmp" "$CURRENT_LINK"
}

restart_configured_processes() {
  local process
  local -a processes
  read -r -a processes <<<"$PROCESS_NAMES"
  if (( ${#processes[@]} == 0 )); then
    lightworld_die 'no process names configured'
    return 1
  fi
  for process in "${processes[@]}"; do
    validate_identifier "$process" 'process name' || return 1
    case "$PROCESS_MANAGER" in
      test)
        if ! is_test_mode; then
          lightworld_die 'test process manager is forbidden in production'
          return 1
        fi
        : "${LIGHTWORLD_TEST_RESTART_LOG:?test restart log is required}"
        printf '%s\n' "$process" >> "$LIGHTWORLD_TEST_RESTART_LOG"
        ;;
      pm2)
        /usr/bin/env pm2 restart "$process"
        ;;
      *)
        lightworld_die "unsupported PROCESS_MANAGER: $PROCESS_MANAGER"
        return 1
        ;;
    esac
  done
}

health_check_url() {
  local url="$1"
  if is_test_mode; then
    if [[ "${LIGHTWORLD_TEST_HEALTH_FAIL:-0}" == '1' ]]; then
      return 1
    fi
    [[ "$url" == test://* ]] && return 0
  fi
  curl --fail --silent --show-error --max-time 8 --retry 2 --retry-delay 1 --output /dev/null -- "$url"
}

verify_configured_health() {
  local scope url
  local -a urls
  for scope in LOCAL_HEALTH_URLS PUBLIC_HEALTH_URLS; do
    read -r -a urls <<<"${!scope:-}"
    for url in "${urls[@]}"; do
      [[ -n "$url" ]] || continue
      if ! health_check_url "$url"; then
        lightworld_die "health check failed: $url"
        return 1
      fi
    done
  done
}

print_health_summary() {
  local scope url label
  local -a urls
  for scope in LOCAL_HEALTH_URLS PUBLIC_HEALTH_URLS; do
    label="${scope%%_*}"
    label="${label,,}"
    read -r -a urls <<<"${!scope:-}"
    for url in "${urls[@]}"; do
      [[ -n "$url" ]] || continue
      if health_check_url "$url"; then
        printf 'health[%s]=ok %s\n' "$label" "$url"
      else
        printf 'health[%s]=fail %s\n' "$label" "$url"
      fi
    done
  done
}
