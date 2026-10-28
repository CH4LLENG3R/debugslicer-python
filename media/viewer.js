const vscode = acquireVsCodeApi();
let npyShape = [];
let npyStrides = [];
let npyType = '';
let typedArray = null;

window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'loadNpy') {
        const uint8 = new Uint8Array(message.bufferData.data);
        processNpy(uint8.buffer);
    }
});

function processNpy(buffer) {
    const view = new DataView(buffer);
    const major = view.getUint8(6); 
    const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
    const headerOffset = major === 1 ? 10 : 12;
    
    const headerBytes = new Uint8Array(buffer, headerOffset, headerLen);
    const headerStr = new TextDecoder().decode(headerBytes);
    
    const shapeMatch = headerStr.match(/'shape':\s*\((.*?)\)/);
    if (shapeMatch) {
        npyShape = shapeMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    }
    
    const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/);
    if (descrMatch) {
        npyType = descrMatch[1];
    }

    const dataBuffer = buffer.slice(headerOffset + headerLen);
    
    if (npyType.includes('f8')) typedArray = new Float64Array(dataBuffer);
    else if (npyType.includes('f4')) typedArray = new Float32Array(dataBuffer);
    else if (npyType.includes('i4')) typedArray = new Int32Array(dataBuffer);
    else if (npyType.includes('u1') || npyType.includes('b1')) typedArray = new Uint8Array(dataBuffer);
    else typedArray = new Float32Array(dataBuffer); 

    npyStrides = new Array(npyShape.length);
    let stride = 1;
    for (let i = npyShape.length - 1; i >= 0; i--) {
        npyStrides[i] = stride;
        stride *= npyShape[i];
    }

    document.getElementById('shape-display').innerText = 'Array Shape: [' + npyShape.join(', ') + '] | dtype: ' + npyType;
    buildUI();
}

function buildUI() {
    const container = document.getElementById('controls');
    container.innerHTML = ''; 
    
    npyShape.forEach((dim, index) => {
        const select = document.createElement('select');
        select.className = 'dim-select';
        select.dataset.index = index;
        select.dataset.size = dim;
        
        ['H', 'W', 'D', 'c'].forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt;
            select.appendChild(option);
        });

        if (npyShape.length === 2) {
            if (index === 0) select.value = 'H';
            if (index === 1) select.value = 'W';
        } else if (npyShape.length >= 3) {
            if (index === 0) select.value = 'H';
            if (index === 1) select.value = 'W';
            if (index === 2) select.value = 'D';
            if (index === 3) select.value = 'c';
        }

        select.addEventListener('change', checkUIState);
        container.appendChild(select);
    });

    checkUIState();
}

function checkUIState() {
    const selects = Array.from(document.querySelectorAll('.dim-select'));
    const values = selects.map(s => s.value);
    
    const sliderContainer = document.getElementById('slider-container');
    const depthSlider = document.getElementById('depth-slider');
    const depthLabel = document.getElementById('depth-label');

    if (values.includes('H') && values.includes('W') && values.includes('D')) {
        sliderContainer.style.display = 'block';
        const dIndex = values.indexOf('D');
        const maxDepth = parseInt(selects[dIndex].dataset.size) - 1;
        
        depthSlider.max = maxDepth;
        depthSlider.oninput = () => {
            depthLabel.innerText = 'Depth: ' + depthSlider.value;
            drawCanvas(); 
        };
    } else {
        sliderContainer.style.display = 'none';
    }
    
    drawCanvas(); 
}

function drawCanvas() {
    if (!typedArray) return;
    
    const selects = Array.from(document.querySelectorAll('.dim-select'));
    const values = selects.map(s => s.value);
    
    const hIdx = values.indexOf('H');
    const wIdx = values.indexOf('W');
    const dIdx = values.indexOf('D');
    
    if (hIdx === -1 || wIdx === -1) return; 
    
    const H = npyShape[hIdx];
    const W = npyShape[wIdx];
    const depthValue = document.getElementById('depth-slider') ? parseInt(document.getElementById('depth-slider').value) || 0 : 0;
    
    const canvas = document.getElementById('render-canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(W, H);
    
    let min = Infinity, max = -Infinity;
    let sliceOffsets = new Int32Array(H * W);
    let ptr = 0;
    
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            let flatIndex = 0;
            for (let dim = 0; dim < npyShape.length; dim++) {
                if (dim === hIdx) flatIndex += y * npyStrides[dim];
                else if (dim === wIdx) flatIndex += x * npyStrides[dim];
                else if (dim === dIdx) flatIndex += depthValue * npyStrides[dim];
            }
            sliceOffsets[ptr] = flatIndex;
            const val = typedArray[flatIndex];
            if (val < min) min = val;
            if (val > max) max = val;
            ptr++;
        }
    }

    const range = max - min === 0 ? 1 : max - min;
    ptr = 0;
    for (let i = 0; i < sliceOffsets.length; i++) {
        const val = typedArray[sliceOffsets[i]];
        const norm = Math.max(0, Math.min(255, ((val - min) / range) * 255));
        
        imgData.data[ptr++] = norm; 
        imgData.data[ptr++] = norm; 
        imgData.data[ptr++] = norm; 
        imgData.data[ptr++] = 255;  
    }
    
    ctx.putImageData(imgData, 0, 0);
}