import { CHECKER_SQUARE, ViewportTransform } from './viewport';

// Same colours as the checkerboard in viewer.css.
const CHECKER_LIGHT = '#b3b3b3';
const CHECKER_DARK = '#8c8c8c';

export interface CaptureOptions {
    canvas: HTMLCanvasElement;
    container: HTMLElement;
    transform: ViewportTransform;
    smooth: boolean;
    hasAlpha: boolean;
}

// Redraws what the view shows, with its zoom and pan. The crosshair is a separate element, so it isn't included.
export function captureView(options: CaptureOptions): HTMLCanvasElement {
    const { canvas, container, transform, smooth, hasAlpha } = options;
    const { scale, panX, panY } = transform;

    const capture = document.createElement('canvas');
    capture.width = container.clientWidth;
    capture.height = container.clientHeight;
    const context = capture.getContext('2d')!;
    context.fillStyle = getComputedStyle(container).backgroundColor;
    context.fillRect(0, 0, capture.width, capture.height);

    if (hasAlpha) {
        drawCheckerboard(context, panX, panY, canvas.width * scale, canvas.height * scale);
    }

    context.imageSmoothingEnabled = smooth;
    context.setTransform(scale, 0, 0, scale, panX, panY);
    context.drawImage(canvas, 0, 0);
    return capture;
}

function drawCheckerboard(context: CanvasRenderingContext2D, left: number, top: number, width: number, height: number) {
    context.save();
    context.beginPath();
    context.rect(left, top, width, height);
    context.clip();
    context.fillStyle = CHECKER_LIGHT;
    context.fillRect(left, top, width, height);
    context.fillStyle = CHECKER_DARK;
    for (let row = 0; row * CHECKER_SQUARE < height; row++) {
        for (let col = 0; col * CHECKER_SQUARE < width; col++) {
            if ((row + col) % 2 === 1) {
                context.fillRect(left + col * CHECKER_SQUARE, top + row * CHECKER_SQUARE, CHECKER_SQUARE, CHECKER_SQUARE);
            }
        }
    }
    context.restore();
}

export async function copyToClipboard(capture: HTMLCanvasElement): Promise<void> {
    // The blob is passed as a promise so that the write starts while the click still counts as a user action.
    const blob = new Promise<Blob>((resolve, reject) => {
        capture.toBlob(result => result ? resolve(result) : reject(new Error('Could not encode the image.')), 'image/png');
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
