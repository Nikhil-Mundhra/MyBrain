#!/bin/bash
# ==============================================================================
# submit_job.slurm
# NYU Abu Dhabi Jubail HPC: TotalSegmentator 16 Brain Structures Slurm Job
#
# Partitions & Hardware (as per Jubail CRC documentation):
# - Partition : nvidia
# - Hardware  : NVIDIA A100 GPU (40GB/80GB VRAM)
# - Run path  : Strictly executed from $SCRATCH to protect $HOME quotas
# ==============================================================================

#SBATCH -J totalseg_brain16
#SBATCH -p nvidia
#SBATCH --gres=gpu:a100:1
#SBATCH -c 8
#SBATCH --mem=32G
#SBATCH -t 03:00:00
#SBATCH -o /scratch/%u/totalseg_logs/%x_%j.out
#SBATCH -e /scratch/%u/totalseg_logs/%x_%j.err

set -euo pipefail

# 1. Environment & Path Sanity
USER_NETID="$(whoami)"
SCRATCH="/scratch/${USER_NETID}"
WORK_DIR="${SCRATCH}/MyBrain_HPC"
ENV_DIR="${SCRATCH}/conda_envs/totalseg"
LOG_DIR="${SCRATCH}/totalseg_logs"

mkdir -p "${LOG_DIR}"

echo "=================================================================="
echo " NYU Abu Dhabi Jubail HPC - TotalSegmentator Job"
echo " Job ID          : ${SLURM_JOB_ID:-local}"
echo " Node            : ${SLURMD_NODENAME:-local}"
echo " GPU Assigned    : ${CUDA_VISIBLE_DEVICES:-0}"
echo " Scratch Dir     : ${SCRATCH}"
echo " Start Time      : $(date)"
echo "=================================================================="

# 2. Load Modules & Activate Environment
module purge
module load miniconda
source "$(conda info --base)/etc/profile.d/conda.sh" 2>/dev/null || source ~/.bashrc

if [ ! -d "${ENV_DIR}" ]; then
  echo "[-] ERROR: Conda environment not found at ${ENV_DIR}."
  echo "    Please run './setup_env.sh' once before submitting."
  exit 1
fi

conda activate "${ENV_DIR}"

# 3. Direct all model weights and caches to $SCRATCH (avoids filling $HOME)
export TOTALSEG_WEIGHTS_PATH="${SCRATCH}/.totalsegmentator/nnunet/results/nnUNet/3d_fullres"
export TORCH_HOME="${SCRATCH}/.cache/torch"
mkdir -p "${TOTALSEG_WEIGHTS_PATH}" "${TORCH_HOME}"

# Set academic license (using -sv to skip re-validation on compute nodes)
totalseg_set_license -l aca_1ESXEYFSEVVS2S -sv 2>/dev/null || true

# 4. Resolve Input Scan (default to subject-0960 or user passed argument)
# In Slurm, $SLURM_SUBMIT_DIR points to the directory from which sbatch was invoked
if [ -n "${SLURM_SUBMIT_DIR:-}" ]; then
  SCRIPT_DIR="${SLURM_SUBMIT_DIR}"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INPUT_SCAN="${1:-${REPO_DIR}/mri-visualizer/public/scans/subject-0960-t1w.dcm}"

if [ ! -f "${INPUT_SCAN}" ]; then
  echo "[-] Input scan not found at: ${INPUT_SCAN}"
  echo "    Usage: sbatch submit_job.slurm /path/to/scan.nii.gz"
  exit 1
fi

# 5. Prepare Job Workspace in $SCRATCH
JOB_SCRATCH="${SCRATCH}/totalseg_run_${SLURM_JOB_ID:-test}"
MASKS_DIR="${JOB_SCRATCH}/masks_16structures"
MESHES_DIR="${JOB_SCRATCH}/web_meshes"
mkdir -p "${MASKS_DIR}" "${MESHES_DIR}"

# Convert DICOM to NIfTI if needed (TotalSegmentator accepts NIfTI or DICOM folder)
PREPARED_SCAN="${INPUT_SCAN}"
if [[ "${INPUT_SCAN}" == *.dcm ]]; then
  echo "==> Converting single enhanced DICOM to NIfTI..."
  if command -v dcm2niix &>/dev/null; then
    echo "    Using dcm2niix for true anatomical orientation and scanner affine..."
    dcm2niix -b y -z y -o "${JOB_SCRATCH}" -f "input_converted" "${INPUT_SCAN}"
    CONVERTED_FILE=$(find "${JOB_SCRATCH}" -name "input_converted*.nii.gz" | head -n 1)
    if [ -n "${CONVERTED_FILE}" ] && [ -f "${CONVERTED_FILE}" ]; then
      PREPARED_SCAN="${CONVERTED_FILE}"
    fi
  else
    echo "    dcm2niix not found; converting with pydicom and nibabel keeping header geometry..."
    python3 -c "
import nibabel as nib
import pydicom
import numpy as np

dcm = pydicom.dcmread('${INPUT_SCAN}')
data = dcm.pixel_array

# Determine pixel spacing & slice thickness
ps = getattr(dcm, 'PixelSpacing', [1.0, 1.0])
st = getattr(dcm, 'SliceThickness', getattr(dcm, 'SpacingBetweenSlices', 1.0))
dx, dy = float(ps[0]), float(ps[1])
dz = float(st)

# Build anatomical affine preserving voxel scale
affine = np.diag([dx, dy, dz, 1.0])

# Match 3D volume axis ordering
if data.ndim == 3:
    # If shape is (slices, rows, cols), transpose to (cols, rows, slices) standard NIfTI orientation
    if data.shape[0] < data.shape[1] and data.shape[0] < data.shape[2]:
        data = np.transpose(data, (2, 1, 0))

img = nib.Nifti1Image(data, affine)
nib.save(img, '${JOB_SCRATCH}/input_converted.nii.gz')
print('Converted DICOM to ${JOB_SCRATCH}/input_converted.nii.gz with spacing (${dx}, ${dy}, ${dz})')
" 2>/dev/null || true

    if [ -f "${JOB_SCRATCH}/input_converted.nii.gz" ]; then
      PREPARED_SCAN="${JOB_SCRATCH}/input_converted.nii.gz"
    fi
  fi
fi

echo "==> Running TotalSegmentator for 16 Brain Structures..."
echo "    Scan: ${PREPARED_SCAN}"
echo "    Task: brain_structures"

# Execute TotalSegmentator with GPU acceleration and threshold retention
TotalSegmentator \
  -i "${PREPARED_SCAN}" \
  -o "${MASKS_DIR}" \
  --task brain_structures \
  --device gpu \
  --nr_thr_saving 1

echo "==> Converting 16 binary masks to web-ready 3D OBJ meshes & manifest..."
python3 "${SCRIPT_DIR}/export_structures.py" \
  -i "${MASKS_DIR}" \
  -o "${MESHES_DIR}" \
  -p "/models/hpc-output/web_meshes/"

# 6. Bundle results into web archive for local download
ARCHIVE_NAME="${JOB_SCRATCH}/brain_structures_web.tar.gz"
tar -czf "${ARCHIVE_NAME}" -C "${MESHES_DIR}" .

echo "=================================================================="
echo " [✓] Segmentation & Mesh Extraction Complete!"
echo " Results available at:"
echo "     Meshes & Manifest: ${MESHES_DIR}"
echo "     Download Archive : ${ARCHIVE_NAME}"
echo " Download to your local Mac using:"
echo "     scp ${USER_NETID}@jubail.abudhabi.nyu.edu:${ARCHIVE_NAME} ./mri-visualizer/public/models/"
echo " End Time: $(date)"
echo "=================================================================="
