import { Colormap, ColormapKind, isHexColor, previewBackground } from './colormap';

export interface ColormapEditorEvents {
    onSave(map: Colormap): void;
    onDelete(id: string): void;
}

// The form for creating a colormap or changing a saved one. The markup is in viewer.html.
export function createColormapEditor(events: ColormapEditorEvents) {
    const root = document.getElementById('colormap-editor')!;
    const nameInput = document.getElementById('colormap-name') as HTMLInputElement;
    const kindSelect = document.getElementById('colormap-kind') as HTMLSelectElement;
    const rows = document.getElementById('colormap-colors')!;
    const preview = document.getElementById('colormap-preview')!;
    const deleteButton = document.getElementById('colormap-delete')!;

    let id = '';
    let colors: string[] = [];

    function updatePreview() {
        preview.style.background = previewBackground({ kind: kindSelect.value as ColormapKind, colors });
    }

    function renderRows() {
        rows.replaceChildren(...colors.map((color, i) => colorRow(color, i)));
        updatePreview();
    }

    function colorRow(color: string, i: number): HTMLElement {
        const row = document.createElement('div');
        row.className = 'colormap-row';

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = color;
        picker.title = 'Pick a colour';

        // Typing is an alternative to the picker, which depends on what the platform provides.
        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'input mono';
        text.value = color;
        text.maxLength = 7;
        text.title = 'Colour as #rrggbb';

        const set = (value: string) => {
            colors[i] = value;
            updatePreview();
        };
        picker.addEventListener('input', () => {
            text.value = picker.value;
            set(picker.value);
        });
        text.addEventListener('input', () => {
            if (isHexColor(text.value)) {
                picker.value = text.value.toLowerCase();
                set(text.value.toLowerCase());
            }
        });
        text.addEventListener('change', () => { text.value = colors[i]; });

        const remove = document.createElement('button');
        remove.className = 'text-btn';
        remove.textContent = 'Remove';
        remove.disabled = colors.length <= 2;
        remove.addEventListener('click', () => {
            colors.splice(i, 1);
            renderRows();
        });

        row.append(picker, text, remove);
        return row;
    }

    function close() {
        root.hidden = true;
    }

    kindSelect.addEventListener('change', updatePreview);

    document.getElementById('colormap-add')!.addEventListener('click', () => {
        colors.push(colors[colors.length - 1]);
        renderRows();
    });

    document.getElementById('colormap-save')!.addEventListener('click', () => {
        events.onSave({
            id,
            name: nameInput.value.trim() || 'Custom',
            kind: kindSelect.value as ColormapKind,
            colors: [...colors],
        });
        close();
    });

    deleteButton.addEventListener('click', () => {
        events.onDelete(id);
        close();
    });

    document.getElementById('colormap-cancel')!.addEventListener('click', close);

    return {
        close,
        // `isSaved` is whether this map already exists and so can be deleted.
        open(map: Colormap, isSaved: boolean) {
            id = map.id;
            colors = [...map.colors];
            nameInput.value = map.name;
            kindSelect.value = map.kind;
            deleteButton.hidden = !isSaved;
            renderRows();
            root.hidden = false;
        },
    };
}
