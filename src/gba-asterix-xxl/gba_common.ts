import { DecodedSurfaceSW } from "../Common/bc_texture";

function expand5bitTo8bit(v5: number): number {
    return (v5 << 3) | (v5 >> 2);
}

export function decodeBGR555(bgr555: number): number {
    const r = expand5bitTo8bit((bgr555 >> 0) & 0x1f);
    const g = expand5bitTo8bit((bgr555 >> 5) & 0x1f);
    const b = expand5bitTo8bit((bgr555 >> 10) & 0x1f);
    const a = 0xff;
    return (a << 24) | (b << 16) | (g << 8) | (r);
}

export function decodeTextureData(width: number, height: number, indices: Uint8Array, palette: Uint16Array): DecodedSurfaceSW {

    let decodedPixels = new Uint8Array(width * height * 4);
    let srcIdx = 0;
    let dstIdx = 0;
    for (let i = 0; i < indices.length; ++i) {
        let colorIdx = indices[i];
        let r = 0, g = 0, b = 0, a = 0;
        if (colorIdx != 0) {
            let bgr555 = palette[colorIdx];
            r = expand5bitTo8bit((bgr555 >> 0) & 0x1f);
            g = expand5bitTo8bit((bgr555 >> 5) & 0x1f);
            b = expand5bitTo8bit((bgr555 >> 10) & 0x1f);
            a = 0xff;
        }
        decodedPixels[dstIdx++] = r;
        decodedPixels[dstIdx++] = g;
        decodedPixels[dstIdx++] = b;
        decodedPixels[dstIdx++] = a;
    }

    return { type: 'RGBA', flag: 'SRGB', width, height, depth: 1, pixels: decodedPixels };
}
