export interface ViewportEvents {
    onHover(canvasY: number, canvasX: number): void;
    onLeave(): void;
    // The mouse chose a pixel by pressing or dragging. Always within the image.
    onPick(canvasY: number, canvasX: number): void;
    // The wheel turned over the view without Ctrl held, so it did nothing.
    onPlainWheel(): void;
}

export interface ViewportElements {
    canvas: HTMLCanvasElement;
    container: HTMLElement;
    crosshairH: HTMLElement;
    crosshairV: HTMLElement;
}

export interface ViewportTransform {
    scale: number;
    panX: number;
    panY: number;
}

const MIN_SCALE = 0.02;
const MAX_SCALE = 256;
const FIT_MARGIN = 8;
// Size of one square of the transparency checkerboard, in screen pixels.
export const CHECKER_SQUARE = 8;

function clampToSize(value: number, size: number): number {
    return Math.min(Math.max(value, 0), size - 1);
}

// Pan, zoom and cursor tracking for one canvas. Transforms are CSS only, so they never trigger a redraw.
export function setupViewport(elements: ViewportElements, events: ViewportEvents) {
    const { canvas, container, crosshairH, crosshairV } = elements;
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let isPicking = false;
    let startX = 0;
    let startY = 0;
    // While fitted, the image follows the size of the container. Any manual pan or zoom ends that.
    let isFitted = true;
    let crosshair: [number, number] | undefined;
    let isCrosshairVisible = true;

    function apply() {
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        // The checkerboard is a background of the canvas, so it is scaled back to keep its squares the same size on screen.
        const tile = (2 * CHECKER_SQUARE) / scale;
        canvas.style.backgroundSize = `${tile}px ${tile}px`;

        crosshairH.hidden = !crosshair || !isCrosshairVisible;
        crosshairV.hidden = !crosshair || !isCrosshairVisible;
        if (crosshair) {
            crosshairH.style.transform = `translateY(${panY + (crosshair[0] + 0.5) * scale}px)`;
            crosshairV.style.transform = `translateX(${panX + (crosshair[1] + 0.5) * scale}px)`;
        }
    }

    // Centres the whole image in the container, as large as fits.
    function fit() {
        isFitted = true;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (canvas.width === 0 || canvas.height === 0 || width === 0 || height === 0) {
            return;
        }
        const fitted = Math.min((width - 2 * FIT_MARGIN) / canvas.width, (height - 2 * FIT_MARGIN) / canvas.height);
        scale = Math.min(Math.max(fitted, MIN_SCALE), MAX_SCALE);
        panX = (width - canvas.width * scale) / 2;
        panY = (height - canvas.height * scale) / 2;
        apply();
    }

    function zoomAt(focalX: number, focalY: number, zoomFactor: number) {
        const newScale = Math.min(Math.max(scale * zoomFactor, MIN_SCALE), MAX_SCALE);
        panX = focalX - (focalX - panX) * (newScale / scale);
        panY = focalY - (focalY - panY) * (newScale / scale);
        scale = newScale;
        isFitted = false;
        apply();
    }

    function zoomAtCenter(zoomFactor: number) {
        zoomAt(container.clientWidth / 2, container.clientHeight / 2, zoomFactor);
    }

    function setCrosshair(position: [number, number] | undefined) {
        crosshair = position;
        container.classList.toggle('can-pick', !!position);
        apply();
    }

    function setCrosshairVisible(visible: boolean) {
        isCrosshairVisible = visible;
        apply();
    }

    // Maps a mouse position back to raw pixels, whatever the current zoom.
    function pixelAt(e: MouseEvent): [number, number] | undefined {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            return undefined;
        }
        return [
            Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height),
            Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width),
        ];
    }

    // Mouse Wheel Zoom (requires Ctrl / Cmd)
    container.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) {
            events.onPlainWheel();
            return;
        }
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 0.85);
    }, { passive: false });

    // Ctrl + drag pans, and a plain press or drag picks a pixel. A press outside the image picks nothing.
    container.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            isPanning = true;
            startX = e.clientX - panX;
            startY = e.clientY - panY;
            container.classList.add('panning');
            return;
        }
        const pixel = pixelAt(e);
        if (pixel && pixel[0] >= 0 && pixel[0] < canvas.height && pixel[1] >= 0 && pixel[1] < canvas.width) {
            isPicking = true;
            events.onPick(pixel[0], pixel[1]);
        }
    });

    // On the window so that a drag keeps going outside the container.
    window.addEventListener('mousemove', (e) => {
        if (isPanning) {
            panX = e.clientX - startX;
            panY = e.clientY - startY;
            isFitted = false;
            apply();
        } else if (isPicking) {
            const pixel = pixelAt(e);
            if (pixel) {
                // Past the edge of the image, the pick stays on the edge.
                events.onPick(clampToSize(pixel[0], canvas.height), clampToSize(pixel[1], canvas.width));
            }
        }
    });

    window.addEventListener('mouseup', () => {
        isPanning = false;
        isPicking = false;
        container.classList.remove('panning');
    });

    container.addEventListener('mousemove', (e) => {
        container.classList.toggle('pan-ready', e.ctrlKey || e.metaKey);
        const pixel = pixelAt(e);
        if (pixel) {
            events.onHover(pixel[0], pixel[1]);
        } else {
            events.onLeave();
        }
    });

    container.addEventListener('mouseleave', () => events.onLeave());

    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
            if (isFitted) {
                fit();
            }
        }).observe(container);
    }

    return {
        fit,
        zoomAtCenter,
        setCrosshair,
        setCrosshairVisible,
        transform: (): ViewportTransform => ({ scale, panX, panY }),
    };
}
