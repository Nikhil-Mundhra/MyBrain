#!/usr/bin/env python3
"""
export_structures.py
Extract 3D polygonal surface meshes (.obj) from TotalSegmentator brain_structures masks
and generate a web manifest (brain_structures.json) with centroids and holographic color schemes.
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Supported structure metadata mapping
# Covers both TotalSegmentator v2 class_map['brain_structures'] and subcortical conventions
STRUCTURE_METADATA = {
    # TotalSegmentator 16 brain structures:
    "brainstem": {
        "label": "Brainstem",
        "category": "Autonomic & Motor Core",
        "color": "#8d70ff",
        "description": "Connects cerebrum with spinal cord; regulates breathing, cardiac, and sleep cycles."
    },
    "subarachnoid_space": {
        "label": "Subarachnoid Space",
        "category": "CSF Compartment",
        "color": "#4da2ff",
        "description": "Interval between arachnoid membrane and pia mater containing CSF."
    },
    "venous_sinuses": {
        "label": "Venous Sinuses",
        "category": "Vascular Drainage",
        "color": "#ff3366",
        "description": "Endothelial-lined vascular channels draining venous blood from brain."
    },
    "septum_pellucidum": {
        "label": "Septum Pellucidum",
        "category": "Limbic Partition",
        "color": "#39ff14",
        "description": "Thin triangular double membrane separating anterior horns of lateral ventricles."
    },
    "cerebellum": {
        "label": "Cerebellum",
        "category": "Motor Coordination",
        "color": "#ff9233",
        "description": "Crucial structure coordinating voluntary movements, balance, and motor learning."
    },
    "caudate_nucleus": {
        "label": "Caudate Nucleus",
        "category": "Basal Ganglia Motor Loop",
        "color": "#ffd156",
        "description": "Striatal structure coordinating goal-directed actions and cognitive feedback."
    },
    "lentiform_nucleus": {
        "label": "Lentiform Nucleus",
        "category": "Basal Ganglia Core",
        "color": "#00f0ff",
        "description": "Comprises putamen and globus pallidus regulating voluntary movement."
    },
    "insular_cortex": {
        "label": "Insular Cortex",
        "category": "Interoception & Emotion",
        "color": "#ff5f8e",
        "description": "Deep cortical hub processing visceral sensations, pain, empathy, and taste."
    },
    "internal_capsule": {
        "label": "Internal Capsule",
        "category": "White Matter Pathway",
        "color": "#bcf34b",
        "description": "Major two-way highway of white matter axons connecting cortex and brainstem."
    },
    "ventricle": {
        "label": "Ventricles",
        "category": "Ventricular System (CSF)",
        "color": "#28d7ff",
        "description": "Interconnected cavities producing and circulating cerebrospinal fluid."
    },
    "central_sulcus": {
        "label": "Central Sulcus",
        "category": "Motor-Sensory Boundary",
        "color": "#ff5500",
        "description": "Prominent anatomical boundary separating primary motor and somatosensory cortices."
    },
    "frontal_lobe": {
        "label": "Frontal Lobe",
        "category": "Executive & Motor Cortex",
        "color": "#28d7ff",
        "description": "Governs executive functions, decision-making, planning, and voluntary motor action."
    },
    "parietal_lobe": {
        "label": "Parietal Lobe",
        "category": "Somatosensory & Spatial",
        "color": "#bcf34b",
        "description": "Processes somatosensory perception, spatial reasoning, and multisensory integration."
    },
    "occipital_lobe": {
        "label": "Occipital Lobe",
        "category": "Visual Processing Core",
        "color": "#ffd156",
        "description": "Primary visual cortex processing retinotopic mapping, color, and motion."
    },
    "temporal_lobe": {
        "label": "Temporal Lobe",
        "category": "Auditory & Memory Core",
        "color": "#ff5f8e",
        "description": "Processes auditory input, speech comprehension, and long-term memory."
    },
    "thalamus": {
        "label": "Thalamus",
        "category": "Sensory Relay Hub",
        "color": "#00f0ff",
        "description": "Crucial central relay station routing signals to the cerebral cortex."
    },
    # Subcortical bilateral labels (if present)
    "thalamus_left": {"label": "Left Thalamus", "category": "Sensory Relay", "color": "#28d7ff", "description": "Sensory relay station routing signals to cerebral cortex."},
    "thalamus_right": {"label": "Right Thalamus", "category": "Sensory Relay", "color": "#28d7ff", "description": "Sensory relay station routing signals to cerebral cortex."},
    "hippocampus_left": {"label": "Left Hippocampus", "category": "Memory & Navigation", "color": "#bcf34b", "description": "Consolidation of short-term memory to long-term memory."},
    "hippocampus_right": {"label": "Right Hippocampus", "category": "Memory & Navigation", "color": "#bcf34b", "description": "Memory consolidation and spatial mapping."},
    "amygdala_left": {"label": "Left Amygdala", "category": "Emotion & Valence", "color": "#ff5f8e", "description": "Core limbic structure processing emotion and fear responses."},
    "amygdala_right": {"label": "Right Amygdala", "category": "Emotion & Valence", "color": "#ff5f8e", "description": "Autonomic fear conditioning and reward learning."},
    "putamen_left": {"label": "Left Putamen", "category": "Motor Control", "color": "#00f0ff", "description": "Dorsal striatum coordinating fine motor movements."},
    "putamen_right": {"label": "Right Putamen", "category": "Motor Control", "color": "#00f0ff", "description": "Motor cortex interface for voluntary motor control."},
    "pallidum_left": {"label": "Left Pallidum", "category": "Motor Inhibition", "color": "#ff9233", "description": "Voluntary movement regulation via GABAergic inhibition."},
    "pallidum_right": {"label": "Right Pallidum", "category": "Motor Inhibition", "color": "#ff9233", "description": "Basal output nucleus modulating motor execution."},
    "accumbens_left": {"label": "Left Accumbens", "category": "Reward & Motivation", "color": "#39ff14", "description": "Mesolimbic dopamine pathway governing motivation."},
    "accumbens_right": {"label": "Right Accumbens", "category": "Reward & Motivation", "color": "#39ff14", "description": "Reward learning and incentive salience."},
}

FALLBACK_PALETTE = [
    "#28d7ff", "#bcf34b", "#ff5f8e", "#ffd156", "#8d70ff",
    "#00f0ff", "#ff9233", "#39ff14", "#4da2ff", "#ff3366"
]

def export_mesh_obj(verts, faces, obj_path):
    """Write vertices and faces to Wavefront OBJ format."""
    with open(obj_path, "w") as f:
        f.write("# Wavefront OBJ exported by TotalSegmentator MyBrain Pipeline\n")
        for v in verts:
            f.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
        for face in faces:
            f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")

def process_masks(input_dir, output_dir, web_prefix="/models/brain-structures/"):
    try:
        import nibabel as nib
        import numpy as np
        from skimage import measure
    except ImportError as e:
        print(f"[-] Missing dependency: {e}. Please run inside the totalseg environment.")
        sys.exit(1)

    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    manifest = []
    print(f"==> Searching for brain structure masks in {input_path}...")

    nii_files = list(input_path.glob("*.nii*"))
    if not nii_files:
        print(f"[-] No NIfTI files found in {input_path}")
        return

    for idx, nii_file in enumerate(sorted(nii_files)):
        stem = nii_file.name.replace(".nii.gz", "").replace(".nii", "").lower()
        if stem.startswith("input_") or stem == "preview":
            continue

        meta = None
        for key, val in STRUCTURE_METADATA.items():
            if key == stem or key in stem:
                meta = val
                matched_key = key
                break

        if not meta:
            matched_key = stem
            meta = {
                "label": stem.replace("_", " ").title(),
                "category": "Brain Structure",
                "color": FALLBACK_PALETTE[idx % len(FALLBACK_PALETTE)],
                "description": f"Volumetric segmentation mask for {stem}."
            }

        print(f"    Processing {meta['label']} ({nii_file.name})...")

        try:
            img = nib.load(str(nii_file))
            data = img.get_fdata()
            voxel_sizes = img.header.get_zooms()[:3]
            voxel_count = int(np.count_nonzero(data > 0.5))

            if voxel_count < 10:
                print(f"    [!] Structure {matched_key} has only {voxel_count} voxels, skipping.")
                continue

            verts, faces, normals, values = measure.marching_cubes(data > 0.5, step_size=1)
            affine = img.affine
            verts_homogeneous = np.c_[verts, np.ones(len(verts))]
            physical_verts = (affine @ verts_homogeneous.T).T[:, :3]

            centroid = np.mean(physical_verts, axis=0).tolist()
            volume_mm3 = float(voxel_count * np.prod(voxel_sizes))

            obj_filename = f"{matched_key}.obj"
            obj_path = output_path / obj_filename
            export_mesh_obj(physical_verts, faces, str(obj_path))

            manifest.append({
                "id": matched_key,
                "label": meta["label"],
                "category": meta["category"],
                "color": meta["color"],
                "description": meta["description"],
                "meshFile": f"{web_prefix.rstrip('/')}/{obj_filename}",
                "centroid": [round(c, 2) for c in centroid],
                "volumeMm3": round(volume_mm3, 1),
                "vertexCount": len(physical_verts),
                "faceCount": len(faces)
            })
            print(f"    [✓] Exported {meta['label']} ({len(physical_verts)} vertices, {len(faces)} faces)")
        except Exception as err:
            print(f"    [-] Error meshing {matched_key}: {err}")

    # Write manifest JSON
    manifest_path = output_path / "brain_structures.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n[✓] Successfully exported {len(manifest)} brain structure meshes and manifest to:")
    print(f"    {manifest_path}")

def main():
    parser = argparse.ArgumentParser(description="Export 3D meshes for TotalSegmentator brain structures")
    parser.add_argument("-i", "--input-dir", required=True, help="Directory containing TotalSegmentator output NIfTI masks")
    parser.add_argument("-o", "--output-dir", required=True, help="Directory to save .obj meshes and manifest JSON")
    parser.add_argument("-p", "--web-prefix", default="/models/brain-structures/", help="Web URL prefix for mesh files in manifest (e.g., /models/brain-structures/ or /models/hpc-output/web_meshes/)")
    args = parser.parse_args()

    process_masks(args.input_dir, args.output_dir, web_prefix=args.web_prefix)

if __name__ == "__main__":
    main()
