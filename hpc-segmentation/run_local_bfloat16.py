#!/usr/bin/env python3
"""
run_local_bfloat16.py
Executes TotalSegmentator Task 409 (brain_structures) using torch.autocast with bfloat16 mixed precision.
Guarded with if __name__ == '__main__' to satisfy macOS multiprocessing 'spawn' start method.
"""

import multiprocessing
import os
import sys
from pathlib import Path
import torch

def setup_bfloat16_patch():
    import nnunetv2.inference.predict_from_raw_data as nnunet_predict
    original_predict = nnunet_predict.nnUNetPredictor.predict_sliding_window_return_logits

    def predict_with_bfloat16(self, input_image):
        device_type = self.device.type if hasattr(self.device, "type") else str(self.device)
        if device_type in ["cpu", "mps"]:
            autocast_ctx = torch.autocast(device_type="cpu", dtype=torch.bfloat16)
        else:
            autocast_ctx = torch.autocast(device_type="cuda", dtype=torch.bfloat16)

        with autocast_ctx:
            return original_predict(self, input_image)

    nnunet_predict.nnUNetPredictor.predict_sliding_window_return_logits = predict_with_bfloat16
    print("    [✓] Patched nnUNetPredictor with bfloat16 autocast context.")

def main():
    multiprocessing.freeze_support()
    print("==> Configuring PyTorch bfloat16 mixed precision...")
    print(f"    PyTorch version: {torch.__version__}")
    print(f"    Apple Silicon MPS available: {torch.backends.mps.is_available()}")

    setup_bfloat16_patch()

    from totalsegmentator.python_api import totalsegmentator
    from totalsegmentator.config import set_license_number

    # Set academic license
    set_license_number("aca_1ESXEYFSEVVS2S")

    input_scan = "local_run/input_converted.nii.gz"
    output_dir = "local_run/masks_16structures"
    os.makedirs(output_dir, exist_ok=True)

    print("==> Starting TotalSegmentator task: brain_structures")
    print(f"    Input scan : {input_scan}")
    print(f"    Output dir : {output_dir}")
    print("    Precision  : bfloat16 (mixed precision)")

    totalsegmentator(
        input=input_scan,
        output=output_dir,
        task="brain_structures",
        device="cpu",
        nr_thr_saving=1,
    )

    print("\n==> Generating web-ready 3D meshes and manifest...")
    import export_structures
    export_structures.process_masks(
        input_dir=output_dir,
        output_dir="mri-visualizer/public/models/hpc-output/web_meshes",
        web_prefix="/models/hpc-output/web_meshes/"
    )
    print("[✓] Finished successfully!")

if __name__ == "__main__":
    main()
