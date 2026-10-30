import { captureView, copyToClipboard } from './screenshot';
import { SliceLayout } from './slice';
import { setupViewport } from './viewport';

export interface ViewEvents {
    onHover(y: number, x: number): void;
    onLeave(): void;
    onPick(y: number, x: number): void;
    onSlice(index: number): void;
    onScreenshot(): void;
}

// One image with its caption, slice slider and buttons. Doesn't know what the array holds, only what to draw.
export function createView(template: HTMLTemplateElement, parent: HTMLElement, events: ViewEvents) {
    const root = (template.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    parent.appendChild(root);

    const part = <T extends HTMLElement>(name: string) => root.querySelector(`.${name}`) as T;
    const canvas = part<HTMLCanvasElement>('view-canvas');
    const container = part('canvas-container');
    const caption = part('view-caption');
    const sliceControl = part('view-slice');
    const slider = part<HTMLInputElement>('view-slider');
    const sliceLabel = part('view-slice-label');

    const viewport = setupViewport(
        { canvas, container, crosshairH: part('crosshair-h'), crosshairV: part('crosshair-v') },
        events
    );

    let drawnKey = '';
    let smooth = false;

    part('btn-zoom-in').addEventListener('click', () => viewport.zoomAtCenter(1.25));
    part('btn-zoom-out').addEventListener('click', () => viewport.zoomAtCenter(0.8));
    part('btn-fit').addEventListener('click', viewport.fit);
    part('btn-screenshot').addEventListener('click', events.onScreenshot);
    slider.addEventListener('input', () => events.onSlice(slider.valueAsNumber));

    return {
        fit: viewport.fit,
        setCrosshair: viewport.setCrosshair,
        setCrosshairVisible: viewport.setCrosshairVisible,

        setVisible(visible: boolean) {
            root.hidden = !visible;
        },

        setCaption(text: string) {
            caption.textContent = text;
        },

        setSlice(slice: { index: number; last: number } | undefined) {
            sliceControl.hidden = !slice;
            if (slice) {
                slider.max = String(slice.last);
                slider.value = String(slice.index);
                sliceLabel.textContent = `${slice.index} / ${slice.last}`;
            }
        },

        setSmooth(value: boolean) {
            smooth = value;
            canvas.style.imageRendering = value ? 'auto' : 'pixelated';
        },

        // Only redraws when the key changes, so moving one view's slice doesn't redraw the others.
        draw(layout: SliceLayout | undefined, key: string, render: () => Uint8ClampedArray) {
            if (key === drawnKey) {
                return;
            }
            drawnKey = key;
            if (!layout) {
                canvas.width = 0;
                canvas.height = 0;
                return;
            }
            canvas.width = layout.width;
            canvas.height = layout.height;
            const context = canvas.getContext('2d')!;
            const imageData = context.createImageData(layout.width, layout.height);
            imageData.data.set(render());
            context.putImageData(imageData, 0, 0);
            canvas.classList.toggle('has-alpha', layout.channels === 2 || layout.channels === 4);
        },

        copyToClipboard() {
            return copyToClipboard(captureView({
                canvas,
                container,
                transform: viewport.transform(),
                smooth,
                hasAlpha: canvas.classList.contains('has-alpha'),
            }));
        },
    };
}
