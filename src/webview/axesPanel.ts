import { assignRole, Axis, AXIS_ROLES, AxisRole, clampIndex, usesIndex } from './slice';

export interface AxesPanelEvents {
    onChange(axes: Axis[], change: 'roles' | 'index'): void;
}

// One column per dimension: its size, then what it is used for, then the index it is held at.
export function createAxesPanel(table: HTMLElement, events: AxesPanelEvents) {
    let shape: number[] = [];
    let axes: Axis[] = [];
    let indexInputs: HTMLInputElement[] = [];

    function render(newShape: number[], newAxes: Axis[]) {
        shape = newShape;
        axes = newAxes;
        indexInputs = [];
        table.replaceChildren(...shape.map((size, dim) => column(dim, size)));
        // With nothing held at an index, the index row would only be empty space.
        table.classList.toggle('no-index', !shape.some((_, dim) => usesIndex(shape, axes, dim)));
    }

    function column(dim: number, size: number): HTMLElement {
        const col = document.createElement('div');
        col.className = 'dim';

        const name = document.createElement('div');
        name.className = 'dim-name';
        name.textContent = `dim ${dim}`;

        const sizeLabel = document.createElement('div');
        sizeLabel.className = 'dim-size';
        sizeLabel.textContent = String(size);

        const select = document.createElement('select');
        select.className = 'select';
        select.title = `What dimension ${dim} is used for`;
        AXIS_ROLES.forEach(role => {
            const option = document.createElement('option');
            option.value = role;
            option.textContent = role;
            select.appendChild(option);
        });
        select.value = axes[dim].role;
        select.addEventListener('change', () => {
            axes = assignRole(axes, dim, select.value as AxisRole);
            // Swapping roles can change other columns too, so rebuild them all.
            render(shape, axes);
            events.onChange(axes, 'roles');
        });

        const index = document.createElement('input');
        index.type = 'number';
        index.className = 'input';
        index.min = '0';
        index.max = String(Math.max(size - 1, 0));
        index.step = '1';
        index.value = String(axes[dim].index);
        index.title = `Index held in dimension ${dim} (0 to ${Math.max(size - 1, 0)})`;
        // Not used by H, W and colour channels, but kept so that the columns line up.
        index.disabled = !usesIndex(shape, axes, dim);
        index.addEventListener('input', () => {
            if (index.value === '') {
                return;
            }
            axes = axes.map((axis, i) => i === dim ? { ...axis, index: clampIndex(index.valueAsNumber, size) } : axis);
            events.onChange(axes, 'index');
        });
        // Show the clamped value once typing is finished.
        index.addEventListener('change', () => { index.value = String(axes[dim].index); });
        indexInputs[dim] = index;

        col.append(name, sizeLabel, select, index);
        return col;
    }

    // Keeps the input in step when the index is changed from elsewhere, such as the slice slider.
    function setIndex(dim: number, index: number) {
        axes = axes.map((axis, i) => i === dim ? { ...axis, index } : axis);
        indexInputs[dim].value = String(index);
    }

    return { render, setIndex };
}
