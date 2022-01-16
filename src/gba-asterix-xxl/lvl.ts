
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DataStream } from "./DataStream";

const V3D_LEVEL_WIDTH_CELLS = 12;
const V3D_LEVEL_WIDTH_VERTS = (V3D_LEVEL_WIDTH_CELLS+1);

interface AsterixUv {
    u: number;
    v: number;
}

interface AsterixTextureQuad {
    flags: number;
    uvs: AsterixUv[];
}

interface AsterixLvlHeader {
    numStrips: number;
    unknown1: number;
    unknown2: number;
    unknown3: number;
}

interface AsterixVertex {
    x: number;
    y: number;
    z: number;
}

interface AsterixMaterialAttr {
    textureQuadIndex: number;
    flags: number;
}

interface AsterixCollisionSpan {
    a: AsterixVertex;
    b: AsterixVertex;
}

export interface AsterixLvl {
    palette: Uint16Array;
    textureQuads: AsterixTextureQuad[];
    lvlHeader: AsterixLvlHeader;
    vertexTable: AsterixVertex[];
    materialAttrs: AsterixMaterialAttr[];
    collisionSpans0: AsterixCollisionSpan[];
    collisionSpans1: AsterixCollisionSpan[];
    envSpriteOffsets: number[];
}

function readAsterixPalette(stream: DataStream): Uint16Array {
    let palette = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
        palette[i] = stream.readUint16();
    }
    return palette;
}

function readAsterixUv(stream: DataStream): AsterixUv {
    let u = stream.readUint8();
    let v = stream.readUint8();
    return { u, v };
}

function readAsterixTextureQuad(stream: DataStream): AsterixTextureQuad {
    const flags = stream.readUint8();
    const uv0 = readAsterixUv(stream);
    const uv1 = readAsterixUv(stream);
    const uv2 = readAsterixUv(stream);
    const uv3 = readAsterixUv(stream);
    return { flags, uvs: [uv0, uv1, uv2, uv3] };
}

function readAsterixTextureQuadTable(stream: DataStream): AsterixTextureQuad[] {
    let quads: AsterixTextureQuad[] = [];
    for (let i = 0; i < 256; i++) {
        quads.push(readAsterixTextureQuad(stream));
    }
    return quads;
}

function readAsterixLvlHeader(stream: DataStream): AsterixLvlHeader {
    const numStrips = stream.readUint32();
    const unknown1 = stream.readUint32();
    const unknown2 = stream.readUint32();
    const unknown3 = stream.readUint32();
    return { numStrips, unknown1, unknown2, unknown3 };
}

function readAsterixVertex(stream: DataStream): AsterixVertex {
    const x = stream.readInt16();
    const y = stream.readInt16();
    const z = stream.readInt16();
    return { x, y, z };
}

function readAsterixVertexTable(stream: DataStream, header: AsterixLvlHeader): AsterixVertex[] {
    let verts: AsterixVertex[] = [];
    for (let strip = 0; strip < header.numStrips+1; strip++) {
        for (let x = 0; x < V3D_LEVEL_WIDTH_VERTS; x++) {
            verts.push(readAsterixVertex(stream));
        }
    }
    return verts;
}

function readAsterixMaterialAttr(stream: DataStream): AsterixMaterialAttr {
    let textureQuadIndex = stream.readUint8();
    let flags = stream.readUint8();
    return { textureQuadIndex, flags };
}

function readAsterixMaterialAttrTable(stream: DataStream, header: AsterixLvlHeader): AsterixMaterialAttr[] {
    let attrs: AsterixMaterialAttr[] = [];
    for (let strip = 0; strip < header.numStrips; strip++) {
        for (let x = 0; x < V3D_LEVEL_WIDTH_CELLS; x++) {
            attrs.push(readAsterixMaterialAttr(stream));
        }
    }
    return attrs;
}

function readAsterixCollisionSpan(stream: DataStream): AsterixCollisionSpan {
    let a = readAsterixVertex(stream);
    let b = readAsterixVertex(stream);
    return { a, b };
}

function readAsterixCollisionSpanTable(stream: DataStream, header: AsterixLvlHeader): AsterixCollisionSpan[] {
    let spans: AsterixCollisionSpan[] = [];
    for (let strip = 0; strip < header.numStrips+1; strip++) {
        spans.push(readAsterixCollisionSpan(stream));
    }
    return spans;
}

function readAsterixEnvSpriteOffsets(stream: DataStream, header: AsterixLvlHeader): number[] {
    let offsets: number[] = [];
    for (let strip = 0; strip < header.numStrips; strip++) {
        for (let x = 0; x < V3D_LEVEL_WIDTH_CELLS; x++) {
            offsets.push(stream.readInt16());
        }
    }
    return offsets;
}

export function parse(buffer: ArrayBufferSlice): AsterixLvl {
    const stream = new DataStream(buffer);

    const palette = readAsterixPalette(stream);
    const textureQuads = readAsterixTextureQuadTable(stream);
    const lvlHeader = readAsterixLvlHeader(stream);
    const vertexTable = readAsterixVertexTable(stream, lvlHeader);
    const materialAttrs = readAsterixMaterialAttrTable(stream, lvlHeader);
    const collisionSpans0 = readAsterixCollisionSpanTable(stream, lvlHeader);
    const collisionSpans1 = readAsterixCollisionSpanTable(stream, lvlHeader);
    const envSpriteOffsets = readAsterixEnvSpriteOffsets(stream, lvlHeader);

    return { palette, textureQuads, lvlHeader, vertexTable, materialAttrs, collisionSpans0, collisionSpans1, envSpriteOffsets };
}
