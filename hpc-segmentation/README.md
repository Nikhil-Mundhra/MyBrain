# NYU Abu Dhabi Jubail HPC - TotalSegmentator Brain Structures Workflow

This module provides scripts to execute [wasserth/TotalSegmentator](https://github.com/wasserth/TotalSegmentator) on the **NYU Abu Dhabi Jubail HPC** cluster (`nvidia` GPU partition) to segment **16 volumetric brain structures** and export them into web-ready 3D meshes for interactive hand gesture pull-out exploration in the Next.js visualizer.

## The 16 Segmented Brain Structures

| Structure ID | Label | Category | Color |
|---|---|---|---|
| `brainstem` | Brainstem | Autonomic & Motor Core | Neon Purple (`#8d70ff`) |
| `thalamus_left` | Left Thalamus | Sensory Relay Hub | Neon Cyan (`#28d7ff`) |
| `thalamus_right` | Right Thalamus | Sensory Relay Hub | Neon Cyan (`#28d7ff`) |
| `hippocampus_left` | Left Hippocampus | Memory & Navigation | Electric Lime (`#bcf34b`) |
| `hippocampus_right` | Right Hippocampus | Memory & Navigation | Electric Lime (`#bcf34b`) |
| `amygdala_left` | Left Amygdala | Emotion & Valence | Cyber Pink (`#ff5f8e`) |
| `amygdala_right` | Right Amygdala | Emotion & Valence | Cyber Pink (`#ff5f8e`) |
| `caudate_left` | Left Caudate | Basal Ganglia Motor Loop | Amber Gold (`#ffd156`) |
| `caudate_right` | Right Caudate | Basal Ganglia Motor Loop | Amber Gold (`#ffd156`) |
| `putamen_left` | Left Putamen | Motor Control & Dopamine | Vivid Blue (`#00f0ff`) |
| `putamen_right` | Right Putamen | Motor Control & Dopamine | Vivid Blue (`#00f0ff`) |
| `pallidum_left` | Left Pallidum (GP) | Motor Inhibition Gate | Orange Flame (`#ff9233`) |
| `pallidum_right` | Right Pallidum (GP) | Motor Inhibition Gate | Orange Flame (`#ff9233`) |
| `accumbens_left` | Left Nucleus Accumbens | Ventral Striatum / Reward | Bright Green (`#39ff14`) |
| `accumbens_right` | Right Nucleus Accumbens | Ventral Striatum / Reward | Bright Green (`#39ff14`) |
| `ventricle_lateral_left` | Left Lateral Ventricle | Ventricular System (CSF) | Sky Blue (`#4da2ff`) |
| `ventricle_lateral_right` | Right Lateral Ventricle | Ventricular System (CSF) | Sky Blue (`#4da2ff`) |

---

## Jubail HPC Execution Guide

### 1. Log in to Jubail & Sync Workspace
Log in to a Jubail login node:
```bash
ssh <NetID>@jubail.abudhabi.nyu.edu
```

Copy `MyBrain` (or `hpc-segmentation/`) to your personal `$SCRATCH` directory:
```bash
# As strictly mandated by CRC policy: NEVER run jobs in /home
cd $SCRATCH
# Clone or copy your MyBrain repo
git clone https://github.com/Nikhil-Mundhra/MyBrain.git
cd MyBrain/hpc-segmentation
```

### 2. Download TotalSegmentator Repository (via `curl`)
```bash
./download_repo.sh
```

### 3. One-Time Environment Setup
Sets up Python 3.10, PyTorch with CUDA 11.8, TotalSegmentator, and meshing libraries in `$SCRATCH/conda_envs/totalseg`:
```bash
./setup_env.sh
```

### 4. Submit Slurm GPU Batch Job
Submits the job requesting an **NVIDIA A100 GPU** on the `nvidia` partition:
```bash
sbatch submit_job.slurm
```
*(Optionally pass a custom NIfTI scan: `sbatch submit_job.slurm /scratch/$USER/data/my_scan.nii.gz`)*

### 5. Monitor Job Status
```bash
# Check queue
squeue -u $USER

# Follow live output logs
tail -f /scratch/$USER/totalseg_logs/totalseg_brain16_*.out
```

### 6. Transfer Results to Web Visualizer
Once the job completes, download the generated meshes archive to your local workstation:
```bash
# On your local Mac:
scp <NetID>@jubail.abudhabi.nyu.edu:/scratch/<NetID>/totalseg_run_*/brain_structures_web.tar.gz ./mri-visualizer/public/models/
tar -xzf ./mri-visualizer/public/models/brain_structures_web.tar.gz -C ./mri-visualizer/public/models/brain-structures/
```
The Next.js visualizer will immediately detect the 16 meshes and allow you to interactively pull them out using hand gestures.
