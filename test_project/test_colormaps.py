"""Sample arrays for testing colormaps and, later, the 3D render. Only needs NumPy.

Run it under the debugger: it raises at the end so that every array stays
inspectable in the Variables pane.
"""
import numpy as np

# Every dimension has a different size, so the views are easy to tell apart.
SHAPE = (64, 80, 96)


def grid(shape=SHAPE):
    return np.ogrid[tuple(slice(0, size) for size in shape)]


def sphere(center, radius, shape=SHAPE):
    h, w, d = grid(shape)
    return (h - center[0]) ** 2 + (w - center[1]) ** 2 + (d - center[2]) ** 2 <= radius ** 2


def box(start, stop, shape=SHAPE):
    mask = np.zeros(shape, dtype=bool)
    mask[start[0]:stop[0], start[1]:stop[1], start[2]:stop[2]] = True
    return mask


# --- Continuous values ---

def gradient():
    """A float32 ramp from 0 to 1 along all three axes."""
    h, w, d = grid()
    return ((h / (SHAPE[0] - 1) + w / (SHAPE[1] - 1) + d / (SHAPE[2] - 1)) / 3).astype(np.float32)


def gaussian_blobs():
    """Overlapping soft blobs in float64, with a smooth falloff to 0."""
    h, w, d = grid()
    blobs = [((20, 25, 30), 10, 1.0), ((40, 50, 50), 14, 0.7), ((30, 60, 75), 8, 0.4)]
    return sum(
        height * np.exp(-((h - c[0]) ** 2 + (w - c[1]) ** 2 + (d - c[2]) ** 2) / (2 * sigma ** 2))
        for c, sigma, height in blobs
    )


def ripples():
    """Signed float32 rings around 0, for diverging colormaps."""
    h, w, d = grid()
    radius = np.sqrt((h - SHAPE[0] / 2) ** 2 + (w - SHAPE[1] / 2) ** 2 + (d - SHAPE[2] / 2) ** 2)
    return (np.sin(radius / 2.5) * np.exp(-radius / 40)).astype(np.float32)


def wide_range():
    """Values spanning 0 to 1e6, where a linear colormap only shows the brightest part."""
    return (10.0 ** (gradient() * 6)).astype(np.float64) - 1


def with_invalid_values():
    """A gradient holding a block of NaN and blocks of both infinities."""
    values = gradient().copy()
    values[10:20, 10:30, 10:40] = np.nan
    values[30:40, 10:30, 10:40] = np.inf
    values[45:55, 10:30, 10:40] = -np.inf
    return values


def gradient_2d():
    """A 2D float32 image, for the single view."""
    h, w = grid(SHAPE[:2])
    return (np.sin(h / 8) * np.cos(w / 11)).astype(np.float32)


# --- Integer labels: 0 is the background. Later labels overwrite earlier ones where they overlap ---

def touching_shapes():
    """uint8 labels 1 to 6, in groups that touch each other along their surfaces."""
    labels = np.zeros(SHAPE, dtype=np.uint8)
    # Two overlapping spheres, which meet in a flat disc
    labels[sphere((32, 22, 25), 15)] = 1
    labels[sphere((32, 44, 25), 15)] = 2
    # Two boxes sharing a whole face, with a smaller box resting on one of them
    labels[box((12, 8, 56), (32, 40, 88))] = 3
    labels[box((32, 8, 56), (52, 40, 88))] = 4
    labels[box((20, 40, 64), (44, 52, 80))] = 5
    # A sphere pushed into the corner where two boxes and the small box meet
    labels[sphere((32, 40, 56), 9)] = 6
    return labels


def nested_shells():
    """int16 concentric shells, so every label touches the next one all the way round."""
    h, w, d = grid()
    radius = np.sqrt((h - SHAPE[0] / 2) ** 2 + (w - SHAPE[1] / 2) ** 2 + (d - SHAPE[2] / 2) ** 2)
    labels = np.zeros(SHAPE, dtype=np.int16)
    for label, outer in zip((4, 3, 2, 1), (30, 22, 14, 6)):
        labels[radius <= outer] = label
    return labels


def block_grid():
    """int32 labels with a different label in each cell of a 4x4x4 grid, all touching their neighbours."""
    h, w, d = grid()
    return ((h * 4 // SHAPE[0]) * 16 + (w * 4 // SHAPE[1]) * 4 + d * 4 // SHAPE[2] + 1).astype(np.int32)


def sparse_labels():
    """int64 labels with large gaps and a negative value. Each must still get its own colour."""
    remap = np.array([0, 3, 17, 200, 1000, 70000, -5], dtype=np.int64)
    return remap[touching_shapes()]


def thin_shapes():
    """uint8 shapes one voxel thick that touch only along lines and at corners."""
    labels = np.zeros(SHAPE, dtype=np.uint8)
    labels[32, 10:70, 10:86] = 1
    labels[10:54, 40, 10:86] = 2
    # Diagonal neighbours, which touch only at a corner
    labels[box((10, 10, 10), (20, 20, 20))] = 3
    labels[box((20, 20, 20), (30, 30, 30))] = 4
    return labels


def boolean_mask():
    """A bool mask, the simplest segmentation."""
    return sphere((32, 40, 48), 24)


def labels_2d():
    """A 2D uint8 image of touching shapes, for the single view."""
    labels = np.zeros(SHAPE[:2], dtype=np.uint8)
    h, w = grid(SHAPE[:2])
    labels[(h - 32) ** 2 + (w - 20) ** 2 <= 14 ** 2] = 1
    labels[(h - 32) ** 2 + (w - 44) ** 2 <= 14 ** 2] = 2
    labels[10:54, 56:68] = 3
    labels[10:54, 68:76] = 4
    return labels


def main():
    # Continuous
    gradient_volume = gradient()
    blobs_volume = gaussian_blobs()
    ripples_volume = ripples()
    wide_range_volume = wide_range()
    invalid_values_volume = with_invalid_values()
    float_image = gradient_2d()

    # Integer labels
    touching_volume = touching_shapes()
    nested_volume = nested_shells()
    grid_volume = block_grid()
    sparse_volume = sparse_labels()
    thin_volume = thin_shapes()
    mask_volume = boolean_mask()
    label_image = labels_2d()

    raise Exception('debug here')


if __name__ == '__main__':
    main()
