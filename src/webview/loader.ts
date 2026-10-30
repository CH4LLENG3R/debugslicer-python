import { NpyArray, NpyFormatError, parseNpy } from './npy';

export type LoadResult =
    | { kind: 'ok'; array: NpyArray }
    | { kind: 'tooLarge'; error: string }
    | { kind: 'error'; error: string };

export async function loadNpy(uri: string, fetchFile: typeof fetch = fetch): Promise<LoadResult> {
    let response: Response;
    try {
        response = await fetchFile(uri);
    } catch (error) {
        return { kind: 'error', error: messageOf(error) };
    }
    if (!response.ok) {
        return { kind: 'error', error: `HTTP error! status: ${response.status}` };
    }

    // Past this point, anything that isn't a format problem means we ran out of memory.
    try {
        return { kind: 'ok', array: parseNpy(await response.arrayBuffer()) };
    } catch (error) {
        return { kind: error instanceof NpyFormatError ? 'error' : 'tooLarge', error: messageOf(error) };
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
