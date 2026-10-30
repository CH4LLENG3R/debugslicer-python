// Debugger type names we can view. Keep in sync with the `when` clause in package.json.
export const SUPPORTED_TYPE_PATTERN = /^(ndarray|Tensor|Parameter|Image|.*ImageFile)$/;

export interface SavedTypes {
    original: string;
    saved: string;
}

// Picks the 4-byte type for wider data: integers stay integers if every value fits.
const REDUCE_TYPE =
    `(lambda a: a.astype('f4') if a.dtype.kind == 'f' and a.dtype.itemsize > 4 else ` +
    `a if a.dtype.kind not in 'iu' or a.dtype.itemsize <= 4 else ` +
    `(lambda t: a.astype(t) if a.size == 0 or (a.min() >= np.iinfo(t).min and a.max() <= np.iinfo(t).max) else a.astype('f4'))(a.dtype.kind + '4'))`;

// A single expression that saves a variable as .npy from inside the debuggee and returns
// "<original dtype> <saved dtype>". The variable is the outer call's argument, so it's
// evaluated in the user's frame and can't be shadowed by the names used here.
export function buildSaveExpression(variable: string, npyPath: string, reduce: boolean): string {
    const convert = reduce ? `${REDUCE_TYPE}(a)` : 'a';
    return `(lambda v, path=${JSON.stringify(npyPath)}, np=__import__('numpy'): ` +
        `(lambda a: ` +
        `(lambda b: (np.save(path, b, allow_pickle=False), a.dtype.str + ' ' + b.dtype.str)[1])(${convert}) ` +
        `if a.dtype.kind in 'biuf' else ` +
        `(_ for _ in ()).throw(TypeError('DebugSlicer cannot display dtype ' + str(a.dtype)))` +
        `)(np.asarray(v.detach().cpu().numpy() if hasattr(v, 'detach') else v))` +
        `)(${variable})`;
}

export function parseSaveResult(result: string): SavedTypes {
    const [original, saved] = result.replace(/^['"]|['"]$/g, '').split(' ');
    return { original, saved };
}
