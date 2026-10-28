import numpy as np
import torch
from PIL import Image

# Define the image path
image_path = "noot-noot.png"

pil_image = Image.open(image_path)
numpy_array = np.array(pil_image)
torch_tensor = torch.from_numpy(numpy_array)

del image_path

raise Exception('debug here')