// Builds a version 1 .npy file, padding the header to 64 bytes as NumPy does.
export function npy(descr: string, shape: string, payload: ArrayBufferView, fortran = false): ArrayBuffer {
    let header = `{'descr': '${descr}', 'fortran_order': ${fortran ? 'True' : 'False'}, 'shape': ${shape}, }`;
    header = header.padEnd(64 * Math.ceil((header.length + 11) / 64) - 11) + '\n';
    const bytes = new Uint8Array(10 + header.length + payload.byteLength);
    bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, header.length & 0xff, header.length >> 8]);
    bytes.set(new TextEncoder().encode(header), 10);
    bytes.set(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), 10 + header.length);
    return bytes.buffer;
}
