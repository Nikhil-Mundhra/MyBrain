#!/usr/bin/env python3
"""
export_structures.py
Extract 3D polygonal surface meshes (.obj) from the 16 TotalSegmentator brain_structures masks
and generate a web manifest (brain_structures.json) with centroids and holographic color schemes.
"""

import argparse
import json
import os
import sys
from pathlib import Path

STRUCTURE_METADATA = {
    "brainstem": {
        "label": "Brainstem",
        "category": "Autonomic & Motor Core",
        "color": "#8d70ff", # Neon purple
        "description": "Connects cerebrum with spinal cord; regulates breathing, cardiac, and sleep cycles."
    },
    "thalamus_left": {
        "label": "Left Thalamus",
        "category": "Sensory Relay",
        "color": "#28d7ff", # Neon cyan
        "description": "Crucial sensory relay station routing signals to the cerebral cortex."
    },
    "thalamus_right": {
        "label": "Right Thalamus",
        "category": "Sensory Relay",
        "color": "#28d7ff",
        "description": "Right hemisphere counterpart routing sensory information and alertness."
    },
    "hippocampus_left": {
        "label": "Left Hippocampus",
        "category": "Memory & Navigation",
        "color": "#bcf34b", # Electric lime
        "description": "Critical for consolidation of short-term memory to long-term memory and spatial navigation."
    },
    "hippocampus_right": {
        "label": "Right Hippocampus",
        "category": "Memory & Navigation",
        "color": "#bcf34b",
        "description": "Right hippocampal formation governing non-verbal, spatial, and facial memory."
    },
    "amygdala_left": {
        "label": "Left Amygdala",
        "category": "Emotion & Threat Processing",
        "color": "#ff5f8e", # Cyber pink
        "description": "Core limbic structure processing emotion, fear responses, and emotional valence."
    },
    "amygdala_right": {
        "label": "Right Amygdala",
        "category": "Emotion & Threat Processing",
        "color": "#ff5f8e",
        "description": "Right amygdala mediating autonomic fear conditioning and reward learning."
    },
    "caudate_left": {
        "label": "Left Caudate",
        "category": "Basal Ganglia Motor Loop",
        "color": "#ffd156", # Amber gold
        "description": "Striatal structure coordinating goal-directed actions and cognitive feedback."
    },
    "caudate_right": {
        "label": "Right Caudate",
        "category": "Basal Ganglia Motor Loop",
        "color": "#ffd156",
        "description": "Regulates motor planning, procedural learning, and spatial working memory."
    },
    "putamen_left": {
        "label": "Left Putamen",
        "category": "Motor Control & Dopamine",
        "color": "#00f0ff", # Vivid blue
        "description": "Major component of dorsal striatum orchestrating fine motor movements and reinforcement."
    },
    "putamen_right": {
        "label": "Right Putamen",
        "category": "Motor Control & Dopamine",
        "color": "#00f0ff",
        "description": "Directly interfaces motor cortex for limb motor execution and stimulus-action loops."
    },
    "pallidum_left": {
        "label": "Left Pallidum (Globus Pallidus)",
        "category": "Motor Inhibition",
        "color": "#ff9233", # Orange flame
        "description": "Regulates voluntary movement via tonic GABAergic inhibitory projection to thalamus."
    },
    "pallidum_right": {
        "label": "Right Pallidum (Globus Pallidus)",
        "category": "Motor Inhibition",
        "color": "#ff9233",
        "description": "Right basal output nucleus modulating smooth execution of voluntary motor patterns."
    },
    "accumbens_left": {
        "label": "Left Nucleus Accumbens",
        "category": "Ventral Striatum & Reward",
        "color": "#39ff14", # Bright neon green
        "description": "Key hub in the mesolimbic dopamine pathway governing motivation, reward, and pleasure."
    },
    "accumbens_right": {
        "label": "Right Nucleus Accumbens",
        "category": "Ventral Striatum & Reward",
        "color": "#39ff14",
        "description": "Reinforcement learning hub mediating hedonic reactions and incentive salience."
    },
    "ventricle_lateral_left": {
        "label": "Left Lateral Ventricle",
        "category": "Ventricular System (CSF)",
        "color": "#4da2ff", # Sky blue
        "description": "C-shaped cavity circulating cerebrospinal fluid providing mechanical cushion and metabolic clearance."
    },
    "ventricle_lateral_right": {
        "label": "Right Lateral Ventricle",
        "category": "Ventricular System (CSF)",
        "color": "#4da2ff",
        "description": "Right cerebral cavity circulating CSF and maintaining intracranial hydrostatic balance."
    },
}

def export_mesh_obj(verts, faces, obj_path):
    """Write vertices and faces to Wavefront OBJ format."""
    with open(obj_path, "w") as f:
        f.write("# Wavefront OBJ exported by TotalSegmentator MyBrain Pipeline\n")
        for v in verts:
            f.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
        for face in faces:
            # OBJ uses 1-based indexing
            f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")

def process_masks(input_dir, output_dir):
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
    print(f"==> Searching for 16 brain structures in {input_path}...")

    # Look for individual nifti mask files (e.g. thalamus_left.nii.gz)
    nii_files = list(input_path.glob("*.nii*"))
    if not nii_files:
        print(f"[-] No NIfTI files found in {input_path}")
        return

    for nii_file in sorted(nii_files):
        # Extract structure key from filename
        stem = nii_file.name.replace(".nii.gz", "").replace(".nii", "")
        # Find matching structure key
        matched_key = None
        for key in STRUCTURE_METADATA.keys():
            if key in stem.lower():
                matched_key = key
                break

        if not matched_key:
            continue

        meta = STRUCTURE_METADATA[matched_key]
        print(f"    Processing {meta['label']} ({nii_file.name})...")

        img = nib.load(str(nii_file))
        data = img.get_fdata()
        voxel_sizes = img.header.get_zooms()[:3]

        if np.count_nonzero(data) < 10:
            print(f"    [!] Structure {matched_key} has too few voxels, skipping mesh generation.")
            continue

        # Extract isosurface with Marching Cubes
        try:
            verts, faces, normals, values = measure.marching_cubes(data > 0.5, step_size=1)
            # Transform vertices to physical mm coordinates using affine matrix
            affine = img.affine
            verts_homogeneous = np.c_[verts, np.ones(len(verts))]
            physical_verts = (affine @ verts_homogeneous.T).T[:, :3]

            centroid = np.mean(physical_verts, axis=0).tolist()
            volume_mm3 = float(np.count_nonzero(data) * np.prod(voxel_sizes))

            obj_filename = f"{matched_key}.obj"
            obj_path = output_path / obj_filename
            export_mesh_obj(physical_verts, faces, str(obj_path))

            manifest.append({
                "id": matched_key,
                "label": meta["label"],
                "category": meta["category"],
                "color": meta["color"],
                "description": meta["description"],
                "meshFile": obj_filename,
                "centroid": [round(c, 2) for c in centroid],
                "volumeMm3": round(volume_mm3, 1),
                "vertexCount": len(physical_verts),
                "faceCount": len(faces)
            })
        except Exception as err:
            print(f"    [-] Error meshing {matched_key}: {err}")

    # Write manifest JSON
    manifest_path = output_path / "brain_structures.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n[✓] Successfully exported {len(manifest)} brain structure meshes and manifest to:")
    print(f"    {manifest_path}")

def main():
    parser = argparse.ArgumentParser(description="Export 3D meshes for TotalSegmentator brain_structures")
    parser.add_argument("-i", "--input-dir", required=True, help="Directory containing TotalSegmentator output NIfTI masks")
    parser.add_argument("-o", "--output-dir", required=True, help="Directory to save .obj meshes and manifest JSON")
    args = parser.parse_args()

    process_masks(args.input_dir, args.output_dir)

if __name__ == "__main__":
    main()
