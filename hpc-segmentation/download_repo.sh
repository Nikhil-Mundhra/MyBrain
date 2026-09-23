#!/usr/bin/env bash
# ==============================================================================
# download_repo.sh
# Download and unpack wasserth/TotalSegmentator repository using curl.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${SCRIPT_DIR}/TotalSegmentator"
ARCHIVE_URL="https://github.com/wasserth/TotalSegmentator/archive/refs/heads/master.tar.gz"
TEMP_ARCHIVE="${SCRIPT_DIR}/totalsegmentator_master.tar.gz"

echo "==> Downloading TotalSegmentator repository archive from GitHub via curl..."
echo "    URL: ${ARCHIVE_URL}"

curl -L --fail --progress-bar "${ARCHIVE_URL}" -o "${TEMP_ARCHIVE}"

echo "==> Unpacking archive into ${TARGET_DIR}..."
mkdir -p "${TARGET_DIR}"
tar -xzf "${TEMP_ARCHIVE}" --strip-components=1 -C "${TARGET_DIR}"

echo "==> Cleaning up archive..."
rm -f "${TEMP_ARCHIVE}"

echo "==> TotalSegmentator successfully downloaded to:"
echo "    ${TARGET_DIR}"
ls -la "${TARGET_DIR}" | head -n 12
