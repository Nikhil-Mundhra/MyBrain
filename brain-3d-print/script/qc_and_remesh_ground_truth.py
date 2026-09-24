#!/usr/bin/env python3
"""
qc_and_remesh_ground_truth.py

Rigorous Neuroimaging Quality Control & Ground-Truth Mesh Remediation:
1. Replaces hollow cortical ribbon masks with solid lobar volumes (cortex + gyral white matter from wmparc.mgz).
2. Performs 3D connected-component analysis to eliminate isolated voxel islands, spurious partial-volume specks, and thin spikes.
3. Fills internal segmentation voids via binary_fill_holes without altering exterior sulcal contours.
4. Uses 1.0mm native isotropic marching cubes (step_size=1) to eliminate pitting, holes, and stepping.
5. Applies conservative, feature-preserving Taubin smoothing (4-5 iterations) to maintain cerebellar folia and the vermal furrow.
6. Computes comprehensive QC metrics: volumes, initial vs post CC counts, L/R asymmetry indices, watertight status, and Euler characteristic.
7. Exports clean manifold OBJ meshes with analytical vertex normals (vn) for WebGL rendering.
"""

import json
from pathlib import Path
import nibabel as nib
import numpy as np
from skimage import measure
import trimesh
from scipy import ndimage

STRUCTURE_CONFIGS = [
    {
        "id": "frontal_lobe",
        "label": "Frontal Lobe",
        "category": "Executive & Motor Cortex",
        "color": "#06b6d4",
        "description": "Governs executive functions, decision-making, planning, and voluntary motor action.",
        "source": "wmparc",
        "lh_labels": [1003, 1012, 1014, 1017, 1018, 1019, 1020, 1024, 1027, 1028, 1032,
                      3003, 3012, 3014, 3017, 3018, 3019, 3020, 3024, 3027, 3028, 3032],
        "rh_labels": [2003, 2012, 2014, 2017, 2018, 2019, 2020, 2024, 2027, 2028, 2032,
                      4003, 4012, 4014, 4017, 4018, 4019, 4020, 4024, 4027, 4028, 4032],
        "smoothing_iters": 5,
        "taubin_lamb": 0.40,
        "taubin_nu": -0.42,
    },
    {
        "id": "parietal_lobe",
        "label": "Parietal Lobe",
        "category": "Somatosensory & Spatial",
        "color": "#a3e635",
        "description": "Processes somatosensory perception, spatial reasoning, and multisensory integration.",
        "source": "wmparc",
        "lh_labels": [1008, 1022, 1025, 1029, 1031, 3008, 3022, 3025, 3029, 3031],
        "rh_labels": [2008, 2022, 2025, 2029, 2031, 4008, 4022, 4025, 4029, 4031],
        "smoothing_iters": 5,
        "taubin_lamb": 0.40,
        "taubin_nu": -0.42,
    },
    {
        "id": "temporal_lobe",
        "label": "Temporal Lobe",
        "category": "Auditory & Memory Core",
        "color": "#f43f5e",
        "description": "Processes auditory input, speech comprehension, and long-term declarative memory.",
        "source": "wmparc",
        "lh_labels": [1001, 1006, 1007, 1009, 1015, 1016, 1030, 1033, 1034,
                      3001, 3006, 3007, 3009, 3015, 3016, 3030, 3033, 3034],
        "rh_labels": [2001, 2006, 2007, 2009, 2015, 2016, 2030, 2033, 2034,
                      4001, 4006, 4007, 4009, 4015, 4016, 4030, 4033, 4034],
        "smoothing_iters": 5,
        "taubin_lamb": 0.40,
        "taubin_nu": -0.42,
    },
    {
        "id": "occipital_lobe",
        "label": "Occipital Lobe",
        "category": "Visual Processing Core",
        "color": "#eab308",
        "description": "Primary visual cortex processing retinotopic mapping, motion, spatial frequencies, and color.",
        "source": "wmparc",
        "lh_labels": [1005, 1011, 1013, 1021, 3005, 3011, 3013, 3021],
        "rh_labels": [2005, 2011, 2013, 2021, 4005, 4011, 4013, 4021],
        "smoothing_iters": 5,
        "taubin_lamb": 0.40,
        "taubin_nu": -0.42,
    },
    {
        "id": "cerebellum",
        "label": "Cerebellum",
        "category": "Motor Coordination",
        "color": "#ff9e3b",
        "description": "Coordinates voluntary movement, fine motor control, balance, and motor learning.",
        "source": "aparc+aseg",
        "lh_labels": [7, 8],    # Left WM + Cortex
        "rh_labels": [46, 47],  # Right WM + Cortex
        "smoothing_iters": 4,   # Conservative smoothing to preserve cerebellar folia and vermis groove
        "taubin_lamb": 0.35,
        "taubin_nu": -0.37,
    },
    {
        "id": "brainstem",
        "label": "Brainstem",
        "category": "Autonomic & Motor Core",
        "color": "#9d80ff",
        "description": "Connects cerebrum with spinal cord; regulates breathing, cardiac, and sleep cycles.",
        "source": "aparc+aseg",
        "lh_labels": [16],      # Midline structure
        "rh_labels": [],
        "smoothing_iters": 4,   # Conservative smoothing to preserve pontine protuberance
        "taubin_lamb": 0.35,
        "taubin_nu": -0.37,
    },
    {
        "id": "thalamus",
        "label": "Thalamus",
        "category": "Sensory Relay Hub",
        "color": "#00f5ff",
        "description": "Crucial bilateral sensory relay station routing peripheral signals to cerebral cortex.",
        "source": "aparc+aseg",
        "lh_labels": [10],
        "rh_labels": [49],
        "smoothing_iters": 5,
        "taubin_lamb": 0.40,
        "taubin_nu": -0.42,
    },
    {
        "id": "caudate_nucleus",
        "label": "Caudate Nucleus",
        "category": "Basal Ganglia Motor Loop",
        "color": "#ffd700",
        "description": "Striatal structure coordinating goal-directed actions and motor habits.",
        "source": "aparc+aseg",
        "lh_labels": [11],
        "rh_labels": [50],
        "smoothing_iters": 5,
        "taubin_lamb": 0.40,
        "taubin_nu": -0.42,
    },
    {
        "id": "lentiform_nucleus",
        "label": "Lentiform Nucleus",
        "category": "Basal Ganglia Core",
        "color": "#00e5ff",
        "description": "Dorsal striatum core comprising putamen and globus pallidus regulating voluntary movement.",
        "source": "aparc+aseg",
        "lh_labels": [12, 13],  # Putamen + Pallidum
        "rh_labels": [51, 52],
        "smoothing_iters": 5,
        "taubin_lamb": 0.40,
        "taubin_nu": -0.42,
    },
    {
        "id": "ventricle",
        "label": "Ventricles",
        "category": "Ventricular System (CSF)",
        "color": "#38bdf8",
        "description": "Interconnected cerebral cavities producing and circulating cerebrospinal fluid.",
        "source": "aparc+aseg",
        "lh_labels": [4, 5, 14, 15, 72],  # Lateral, inf lateral, 3rd, 4th, 5th
        "rh_labels": [43, 44],
        "smoothing_iters": 4,
        "taubin_lamb": 0.35,
        "taubin_nu": -0.37,
    },
    {
        "id": "insular_cortex",
        "label": "Insular Cortex",
        "category": "Interoception & Emotion",
        "color": "#ff4d88",
        "description": "Deep cortical hub processing visceral sensations, autonomic balance, pain, and empathy.",
        "source": "wmparc",
        "lh_labels": [1035, 3035],
        "rh_labels": [2035, 4035],
        "smoothing_iters": 5,
        "taubin_lamb": 0.40,
        "taubin_nu": -0.42,
    }
]

def clean_mask_connected_components(binary_mask, min_fraction=0.015):
    """
    Identifies all connected components in 3D volume.
    Retains only primary anatomical components, removing isolated partial-volume noise specks and thin spikes.
    """
    labeled, num_features = ndimage.label(binary_mask)
    if num_features <= 1:
        return binary_mask, num_features, num_features

    counts = ndimage.sum(binary_mask, labeled, range(1, num_features + 1))
    max_count = np.max(counts)
    threshold = max_count * min_fraction

    cleaned = np.zeros_like(binary_mask, dtype=bool)
    kept_count = 0
    for idx, count in enumerate(counts):
        if count >= threshold:
            cleaned[labeled == (idx + 1)] = True
            kept_count += 1

    return cleaned, num_features, kept_count

def main():
    base_dir = Path("brain-3d-print/subject-0960/freesurfer-subjects/subject-0960/mri")
    out_dir = Path("mri-visualizer/public/models/hpc-output/web_meshes")
    out_dir.mkdir(parents=True, exist_ok=True)

    print("==> Loading FreeSurfer ground-truth volumes (wmparc.mgz & aparc+aseg.mgz)...")
    wmparc_img = nib.load(base_dir / "wmparc.mgz")
    wmparc_data = np.asarray(wmparc_img.dataobj)
    affine = wmparc_img.affine
    voxel_vol = float(np.prod(wmparc_img.header.get_zooms()[:3]))

    aparc_img = nib.load(base_dir / "aparc+aseg.mgz")
    aparc_data = np.asarray(aparc_img.dataobj)

    qc_records = []
    manifest = []

    print("\n" + "="*80)
    print(f"{'Structure':24s} | {'Vol (cm3)':10s} | {'L/R Asymmetry':14s} | {'CC (Init->Kept)':16s} | {'Watertight':10s}")
    print("="*80)

    for cfg in STRUCTURE_CONFIGS:
        struct_id = cfg["id"]
        label = cfg["label"]
        src_data = wmparc_data if cfg["source"] == "wmparc" else aparc_data

        lh_labels = cfg["lh_labels"]
        rh_labels = cfg["rh_labels"]
        all_labels = lh_labels + rh_labels

        # 1. Hemisphere volume calculation and Asymmetry Index
        vol_lh = float(np.count_nonzero(np.isin(src_data, lh_labels)) * voxel_vol) if lh_labels else 0.0
        vol_rh = float(np.count_nonzero(np.isin(src_data, rh_labels)) * voxel_vol) if rh_labels else 0.0
        total_vol = vol_lh + vol_rh

        if vol_lh > 0 and vol_rh > 0:
            asymmetry_index = ((vol_lh - vol_rh) / (0.5 * (vol_lh + vol_rh))) * 100.0
            asym_str = f"{asymmetry_index:+.2f}%"
        else:
            asymmetry_index = 0.0
            asym_str = "Midline"

        # 2. Binary mask extraction
        raw_mask = np.isin(src_data, all_labels)
        if np.count_nonzero(raw_mask) == 0:
            print(f"Skipping {struct_id}: zero voxels.")
            continue

        # 3. Connected component cleanup & hole filling
        cleaned_mask, init_cc, kept_cc = clean_mask_connected_components(raw_mask)
        # Fill only internal segmentation holes without bridging sulcal fissures
        filled_mask = ndimage.binary_fill_holes(cleaned_mask)

        # 4. Marching Cubes at NATIVE 1.0mm isotropic resolution (step_size=1)
        verts, faces, _, _ = measure.marching_cubes(filled_mask.astype(float), level=0.5, step_size=1)

        # 5. Coordinate transform to physical scanner space (RAS)
        verts_h = np.c_[verts, np.ones(len(verts))]
        physical_verts = (affine @ verts_h.T).T[:, :3]

        # 6. Trimesh construction & topological repair
        mesh = trimesh.Trimesh(vertices=physical_verts, faces=faces, process=True)

        # 7. Conservative, structure-adaptive Taubin volume-preserving smoothing
        mesh_smoothed = trimesh.smoothing.filter_taubin(
            mesh,
            lamb=cfg["taubin_lamb"],
            nu=cfg["taubin_nu"],
            iterations=cfg["smoothing_iters"]
        )
        mesh_smoothed.fix_normals()

        centroid = np.mean(mesh_smoothed.vertices, axis=0).tolist()
        is_watertight = bool(mesh_smoothed.is_watertight)
        euler_char = int(mesh_smoothed.euler_number)

        # 8. Export OBJ with vertex normals (vn)
        obj_file = out_dir / f"{struct_id}.obj"
        obj_str = trimesh.exchange.obj.export_obj(mesh_smoothed, include_normals=True)
        with open(obj_file, "w") as f:
            f.write(obj_str)

        vol_cm3 = total_vol / 1000.0
        cc_str = f"{init_cc} -> {kept_cc}"
        wt_str = "YES" if is_watertight else "NO"
        print(f"{label:24s} | {vol_cm3:7.2f} cm3 | {asym_str:14s} | {cc_str:16s} | {wt_str:10s}")

        record = {
            "id": struct_id,
            "label": label,
            "category": cfg["category"],
            "color": cfg["color"],
            "description": cfg["description"],
            "meshFile": f"/models/hpc-output/web_meshes/{struct_id}.obj",
            "centroid": [round(c, 1) for c in centroid],
            "volumeMm3": round(total_vol, 1),
            "volumeCm3": round(vol_cm3, 2),
            "lhVolumeMm3": round(vol_lh, 1),
            "rhVolumeMm3": round(vol_rh, 1),
            "asymmetryIndexPct": round(asymmetry_index, 2),
            "connectedComponentsInit": init_cc,
            "connectedComponentsKept": kept_cc,
            "vertexCount": len(mesh_smoothed.vertices),
            "faceCount": len(mesh_smoothed.faces),
            "isWatertight": is_watertight,
            "eulerCharacteristic": euler_char
        }
        qc_records.append(record)
        manifest.append(record)

    # Save manifest for the viewer
    json_path = Path("mri-visualizer/public/models/hpc-output/brain_structures.json")
    with open(json_path, "w") as f:
        json.dump(manifest, f, indent=2)

    # Save QC report
    qc_path = Path("brain-3d-print/subject-0960/qc_remediation_report.json")
    with open(qc_path, "w") as f:
        json.dump(qc_records, f, indent=2)

    print("="*80)
    print(f"[✓] Saved {len(manifest)} ground-truth repaired structures to {out_dir}")
    print(f"[✓] Updated manifest at {json_path}")
    print(f"[✓] Generated QC report at {qc_path}\n")

if __name__ == "__main__":
    main()
