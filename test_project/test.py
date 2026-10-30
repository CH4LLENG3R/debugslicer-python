import numpy as np
import torch
from PIL import Image
import nibabel as nib

def argb_image():
    # Define the image path
    image_path = "noot-noot.png"

    pil_image = Image.open(image_path)
    numpy_array = np.array(pil_image)
    torch_tensor = torch.from_numpy(numpy_array)
    del image_path

    raise Exception('debug here')

def volume():
    volume_path = "mri.nii.gz"

    # 1. Load as a Nibabel Nifti1Image (The medical 3D equivalent to a PIL Image)
    nifti_image = nib.load(volume_path)
    numpy_array = nifti_image.get_fdata()
    torch_tensor = torch.from_numpy(numpy_array)

    del volume_path

    raise Exception('debug here')

# argb_image()
volume()