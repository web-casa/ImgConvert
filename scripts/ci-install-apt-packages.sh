#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0

set -Eeuo pipefail

readonly update_attempts=3
readonly update_timeout_seconds=180
readonly update_kill_after_seconds=30
readonly install_timeout_seconds=600
readonly install_kill_after_seconds=30
readonly apt_mirror_file="/etc/apt/apt-mirrors.txt"

mirror_backup_path=""
mirror_replacement_path=""

prefer_official_ubuntu_archive() {
  if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]]; then
    return
  fi
  if ! sudo test -r "${apt_mirror_file}"; then
    return
  fi
  if ! sudo grep -qF "azure.archive.ubuntu.com" "${apt_mirror_file}"; then
    return
  fi

  mirror_backup_path="$(mktemp)"
  mirror_replacement_path="$(mktemp)"
  sudo cat "${apt_mirror_file}" | tee "${mirror_backup_path}" >/dev/null
  sed 's/azure\.archive\.ubuntu\.com/archive.ubuntu.com/g' "${mirror_backup_path}" >"${mirror_replacement_path}"
  sudo cp "${mirror_replacement_path}" "${apt_mirror_file}"
  trap restore_ubuntu_runner_mirror EXIT
  echo "temporarily preferring archive.ubuntu.com over azure.archive.ubuntu.com on this GitHub runner"
}

# shellcheck disable=SC2317
restore_ubuntu_runner_mirror() {
  local exit_status=$?
  local restore_status=0
  if [[ -n "${mirror_backup_path}" ]]; then
    if ! sudo cp "${mirror_backup_path}" "${apt_mirror_file}"; then
      echo "failed to restore the GitHub runner apt mirror file" >&2
      restore_status=1
    fi
  fi
  rm -f "${mirror_backup_path}" "${mirror_replacement_path}"
  if (( exit_status != 0 )); then
    exit "${exit_status}"
  fi
  exit "${restore_status}"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/ci-install-apt-packages.sh <package> [<package> ...]

Installs fixed Ubuntu CI build dependencies. apt-get update is retried up to
three times, with a 180-second timeout per attempt; package installation has a
ten-minute timeout. This helper is for GitHub-hosted CI only and requires sudo.
EOF
  exit 0
fi

if (( $# == 0 )); then
  echo "ci apt bootstrap requires at least one package name" >&2
  exit 64
fi

prefer_official_ubuntu_archive

for ((attempt = 1; attempt <= update_attempts; attempt += 1)); do
  echo "apt-get update attempt ${attempt}/${update_attempts} (timeout: ${update_timeout_seconds}s)"
  if sudo env DEBIAN_FRONTEND=noninteractive timeout --kill-after="${update_kill_after_seconds}s" "${update_timeout_seconds}s" apt-get update; then
    break
  else
    update_status=$?
  fi

  if (( attempt == update_attempts )); then
    echo "apt-get update failed after ${update_attempts} bounded attempt(s) (exit ${update_status})" >&2
    exit "${update_status}"
  fi

  backoff_seconds=$((attempt * 5))
  echo "apt-get update failed (exit ${update_status}); retrying in ${backoff_seconds}s" >&2
  sleep "${backoff_seconds}"
done

echo "apt-get install ${*} (timeout: ${install_timeout_seconds}s)"
if sudo env DEBIAN_FRONTEND=noninteractive timeout --kill-after="${install_kill_after_seconds}s" "${install_timeout_seconds}s" apt-get install -y --no-install-recommends "$@"; then
  exit 0
else
  install_status=$?
fi

echo "apt-get install failed after ${install_timeout_seconds}s or with exit ${install_status}" >&2
exit "${install_status}"
