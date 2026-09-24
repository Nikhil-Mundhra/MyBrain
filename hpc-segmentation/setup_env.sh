#!/usr/bin/env bash
# ==============================================================================
# setup_env.sh
# NYU Abu Dhabi Jubail HPC: Conda & PyTorch environment setup for TotalSegmentator.
#
# IMPORTANT: As per Jubail policy, environments & packages must be installed in
# $SCRATCH (/scratch/<NetID>/) to avoid depleting the 50GB $HOME quota.
# ==============================================================================

set -euo pipefail

if [ -z "${SCRATCH:-}" ]; then
  echo "[-] ERROR: \$SCRATCH environment variable is not defined."
  echo "    Please run this script on NYUAD Jubail HPC (e.g., login node or srun session)."
  exit 1
fi

ENV_DIR="${SCRATCH}/conda_envs/totalseg"
WEIGHTS_DIR="${SCRATCH}/.totalsegmentator/nnunet/results/nnUNet/3d_fullres"

echo "=================================================================="
echo " NYU Abu Dhabi Jubail HPC - TotalSegmentator Environment Setup"
echo " Target Environment: ${ENV_DIR}"
echo " Model Cache Path  : ${WEIGHTS_DIR}"
echo "=================================================================="

# 1. Load centralized Miniconda module
echo "==> Loading Jubail miniconda module..."
module purge
module load miniconda
# Ensure conda functions are available in non-interactive shell
source "$(conda info --base)/etc/profile.d/conda.sh" 2>/dev/null || source ~/.bashrc

# 2. Create conda environment in $SCRATCH
if [ -d "${ENV_DIR}" ]; then
  echo "==> Conda environment already exists at ${ENV_DIR}. Activating..."
else
  echo "==> Creating new Python 3.10 environment in \$SCRATCH..."
  mkdir -p "$(dirname "${ENV_DIR}")"
  conda create -y --prefix "${ENV_DIR}" python=3.10
fi

conda activate "${ENV_DIR}"

# 3. Install PyTorch with CUDA support (CUDA 11.8 / 12.1 compatible with Jubail A100 & V100 nodes)
echo "==> Installing PyTorch with CUDA acceleration..."
pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu118

# 4. Install imaging and mesh generation libraries for 3D web export
echo "==> Installing dcm2niix, nibabel, pydicom, scikit-image, trimesh, and scipy..."
conda install -y -c conda-forge dcm2niix 2>/dev/null || true
pip install --no-cache-dir nibabel pydicom scikit-image trimesh scipy

# 5. Install TotalSegmentator (from local repo or PyPI)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "${SCRIPT_DIR}/TotalSegmentator" ]; then
  echo "==> Installing TotalSegmentator from local repository (${SCRIPT_DIR}/TotalSegmentator)..."
  pip install --no-cache-dir -e "${SCRIPT_DIR}/TotalSegmentator"
else
  echo "==> Installing TotalSegmentator from PyPI..."
  pip install --no-cache-dir TotalSegmentator
fi

# 6. Create scratch directory for weights and purge caches to preserve file quota
mkdir -p "${WEIGHTS_DIR}"
mkdir -p "${SCRATCH}/totalseg_logs"

echo "==> Cleaning package manager caches to preserve $SCRATCH / $HOME quotas..."
conda clean -a -y || true
pip cache purge || true

echo "=================================================================="
echo " [✓] Environment setup complete!"
echo " Activate anytime using:"
echo "     module load miniconda"
echo "     source ~/.bashrc"
echo "     conda activate ${ENV_DIR}"
echo "=================================================================="
