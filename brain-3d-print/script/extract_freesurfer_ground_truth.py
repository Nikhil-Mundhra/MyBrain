#!/usr/bin/env python3
"""
extract_freesurfer_ground_truth.py
Extracts full physiological volume 3D meshes from FreeSurfer's gold-standard aparc+aseg.mgz
for subject-0960, applies volume-preserving Taubin smoothing, and computes vertex normals (vn)
for silky-smooth WebGL rendering in Niivue.
"""

import os
import json
from pathlib import Path
import nibabel as nib
import numpy as np
from skimage import measure
import trimesh

# Structures, color schemes, and FreeSurfer aparc+aseg label definitions
STRUCTURE_DEFS = {
    "brainstem": {
        "label": "Brainstem",
        "category": "Autonomic & Motor Core",
        "color": "#9d80ff",
        "description": "Connects cerebrum with spinal cord; regulates breathing, cardiac, and sleep cycles.",
        "labels": [16]
    },
    "cerebellum": {
        "label": "Cerebellum",
        "category": "Motor Coordination",
        "color": "#ff9e3b",
        "description": "Coordinates voluntary movement, fine motor control, balance, and motor learning.",
        "labels": [7, 8, 46, 47]  # Left/Right cerebellum cortex + white matter
    },
    "thalamus": {
        "label": "Thalamus",
        "category": "Sensory Relay Hub",
        "color": "#00f5ff",
        "description": "Crucial bilateral sensory relay station routing peripheral signals to cerebral cortex.",
        "labels": [10, 49]
    },
    "caudate_nucleus": {
        "label": "Caudate Nucleus",
        "category": "Basal Ganglia Motor Loop",
        "color": "#ffd700",
        "description": "Striatal structure coordinating goal-directed actions and motor habits.",
        "labels": [11, 50]
    },
    "lentiform_nucleus": {
        "label": "Lentiform Nucleus",
        "category": "Basal Ganglia Core",
        "color": "#00e5ff",
        "description": "Dorsal striatum core comprising putamen and globus pallidus regulating voluntary movement.",
        "labels": [12, 13, 51, 52]  # Putamen + Pallidum bilateral
    },
    "ventricle": {
        "label": "Ventricles",
        "category": "Ventricular System (CSF)",
        "color": "#38bdf8",
        "description": "Interconnected cerebral cavities producing and circulating cerebrospinal fluid.",
        "labels": [4, 5, 14, 15, 43, 44, 72]  # Lateral ventricles, 3rd, 4th, inf lat vent
    },
    "insular_cortex": {
        "label": "Insular Cortex",
        "category": "Interoception & Emotion",
        "color": "#ff4d88",
        "description": "Deep cortical hub processing visceral sensations, autonomic balance, pain, and empathy.",
        "labels": [1035, 2035]
    },
    "frontal_lobe": {
        "label": "Frontal Lobe",
        "category": "Executive & Motor Cortex",
        "color": "#06b6d4",
        "description": "Governs executive functions, decision-making, planning, and voluntary motor action.",
        "labels": [
            1003, 1012, 1014, 1017, 1018, 1019, 1020, 1024, 1027, 1028, 1032,
            2003, 2012, 2014, 2017, 2018, 2019, 2020, 2024, 2027, 2028, 2032
        ]
    },
    "parietal_lobe": {
        "label": "Parietal Lobe",
        "category": "Somatosensory & Spatial",
        "color": "#a3e635",
        "description": "Processes somatosensory perception, spatial reasoning, and multisensory integration.",
        "labels": [
            1008, 1022, 1025, 1029, 1031,
            2008, 2022, 2025, 2029, 2031
        ]
    },
    "temporal_lobe": {
        "label": "Temporal Lobe",
        "category": "Auditory & Memory Core",
        "color": "#f43f5e",
        "description": "Processes auditory input, speech comprehension, and long-term declarative memory.",
        "labels": [
            1001, 1006, 1007, 1009, 1015, 1016, 1030, 1033, 1034,
            2001, 2006, 2007, 2009, 2015, 2016, 2030, 2033, 2034
        ]
    }
}

def main():
    mgz_path = "brain-3d-print/subject-0960/freesurfer-subjects/subject-0960/mri/aparc+aseg.mgz"
    output_dir = Path("mri-visualizer/public/models/hpc-output/web_meshes")
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"==> Loading FreeSurfer ground-truth parcellation from {mgz_path}...")
    mgz = nib.load(mgz_path)
    data = np.asarray(mgz.dataobj)
    affine = mgz.affine
    voxel_vol = float(np.prod(mgz.header.get_zooms()[:3]))

    manifest = []

    for struct_id, info in STRUCTURE_DEFS.items():
        print(f"--> Extracting & Smoothing {info['label']}...")
        mask = np.isin(data, info["labels"])
        voxel_count = int(np.count_nonzero(mask))
        if voxel_count == 0:
            print(f"    [!] Skipping {struct_id}: 0 voxels found.")
            continue

        # Extract isosurface mesh with Marching Cubes
        step = 2 if voxel_count > 50000 else 1
        verts, faces, _, _ = measure.marching_cubes(mask.astype(float), level=0.5, step_size=step)

        # Transform vertices to physical scanner space using affine
        verts_h = np.c_[verts, np.ones(len(verts))]
        physical_verts = (affine @ verts_h.T).T[:, :3]

        # Construct trimesh object
        mesh = trimesh.Trimesh(vertices=physical_verts, faces=faces, process=True)

        # Apply Taubin smoothing: eliminates voxel staircasing terraces without volume shrinkage
        # 10 iterations with lamb=0.5, nu=-0.53 preserves volume curvature perfectly
        mesh_smoothed = trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=-0.53, iterations=12)

        # Ensure normals are recalculated for smooth Phong/Gouraud shading in WebGL
        mesh_smoothed.fix_normals()

        centroid = np.mean(mesh_smoothed.vertices, axis=0).tolist()
        volume_mm3 = float(voxel_count * voxel_vol)

        obj_file = output_dir / f"{struct_id}.obj"
        # Export with include_normals=True (writes 'vn' and 'f v//vn')
        obj_content = trimesh.exchange.obj.export_obj(mesh_smoothed, include_normals=True)
        with open(obj_file, "w") as f:
            f.write(obj_content)

        manifest.append({
            "id": struct_id,
            "label": info["label"],
            "category": info["category"],
            "color": info["color"],
            "description": info["description"],
            "meshFile": f"/models/hpc-output/web_meshes/{struct_id}.obj",
            "centroid": [round(c, 2) for c in centroid],
            "volumeMm3": round(volume_mm3, 1),
            "vertexCount": len(mesh_smoothed.vertices),
            "faceCount": len(mesh_smoothed.faces)
        })

        print(f"    [✓] {info['label']}: Volume={volume_mm3:,.1f} mm³ | Verts={len(mesh_smoothed.vertices):,} (with smooth normals)")

    # Write manifest
    manifest_path = output_dir / "brain_structures.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n[✓] Successfully exported {len(manifest)} smoothed anatomical structures with normals to {output_dir}")

if __name__ == "__main__":
    main()
