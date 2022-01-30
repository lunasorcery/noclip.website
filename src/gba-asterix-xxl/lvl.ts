
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DataStream } from "./DataStream";

const V3D_LEVEL_WIDTH_CELLS = 12;
const V3D_LEVEL_WIDTH_VERTS = (V3D_LEVEL_WIDTH_CELLS + 1);

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

interface AsterixTriPoly {
    indices: number[],
    flags: number,
    uvs: AsterixUv[],
}

export interface AsterixTriModel {
    verts: AsterixVertex[],
    polys: AsterixTriPoly[],
}

interface AsterixXZBounds {
    x_min: number,
    x_max: number,
    z_min: number,
    z_max: number,
}

export interface AsterixObjSolidModel {
    unk1: number,
    model: AsterixTriModel,
    broad_bounds: AsterixXZBounds,
}

export interface AsterixObjIntangibleModel {
    unk1: number,
    model: AsterixTriModel,
}

interface AsterixObject {
    preamble_pos: AsterixVertex;
    preamble_unk: number;
    payload: AsterixObjSolidModel | AsterixObjIntangibleModel | null;
}

export interface AsterixLvl {
    palette: Uint16Array;
    textureQuads: AsterixTextureQuad[];
    lvlHeader: AsterixLvlHeader;
    vertexTable: AsterixVertex[];
    materialAttrs: AsterixMaterialAttr[];
    collisionSpans0: AsterixCollisionSpan[];
    collisionSpans1: AsterixCollisionSpan[];
    objectOffsets: number[];
    objects: AsterixObject[];
}

export const enum Version {
    PrototypeA = 0,
    PrototypeB = 1,
    Retail = 2,
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

function readAsterixLvlHeader(stream: DataStream, version: Version): AsterixLvlHeader {
    const numStrips = stream.readUint32();
    const unknown1 = stream.readUint32();
    const unknown2 = (version >= Version.PrototypeB) ? stream.readUint32() : 0;
    const unknown3 = (version >= Version.Retail) ? stream.readUint32() : 0;
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
    for (let strip = 0; strip < header.numStrips + 1; strip++) {
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
    for (let strip = 0; strip < header.numStrips + 1; strip++) {
        spans.push(readAsterixCollisionSpan(stream));
    }
    return spans;
}

function readAsterixObjectOffsets(stream: DataStream, header: AsterixLvlHeader): number[] {
    let offsets: number[] = [];
    for (let strip = 0; strip < header.numStrips; strip++) {
        for (let x = 0; x < V3D_LEVEL_WIDTH_CELLS; x++) {
            offsets.push(stream.readInt16());
        }
    }
    return offsets;
}

function readAsterixTriPoly(stream: DataStream): AsterixTriPoly {
    const indices: number[] = [
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
    ];
    const flags = stream.readUint8();
    const uvs: AsterixUv[] = [
        readAsterixUv(stream),
        readAsterixUv(stream),
        readAsterixUv(stream),
    ];
    return { indices, flags, uvs };
}

function readAsterixTriModel(stream: DataStream): AsterixTriModel {
    const num_verts = stream.readUint8();
    const num_polys = stream.readUint8();
    let verts: AsterixVertex[] = [];
    let polys: AsterixTriPoly[] = [];
    for (let i = 0; i < num_verts; ++i) {
        verts.push(readAsterixVertex(stream));
    }
    for (let i = 0; i < num_polys; ++i) {
        polys.push(readAsterixTriPoly(stream));
    }
    return { verts, polys };
}

function readAsterixXZBounds(stream: DataStream): AsterixXZBounds {
    const x_min = stream.readInt16();
    const x_max = stream.readInt16();
    const z_min = stream.readInt16();
    const z_max = stream.readInt16();

    return { x_min, x_max, z_min, z_max };
}

function readAsterixObjSolidModel(stream: DataStream): AsterixObjSolidModel {
    const unk1 = stream.readUint8();
    const model = readAsterixTriModel(stream);
    const broad_bounds = readAsterixXZBounds(stream);

    return { unk1, model, broad_bounds };
}

function readAsterixObjIntangibleModel(stream: DataStream): AsterixObjIntangibleModel {
    const unk1 = stream.readUint8();
    const model = readAsterixTriModel(stream);

    return { unk1, model };
}

function readAsterixObjectPayload(stream: DataStream): AsterixObjSolidModel | AsterixObjIntangibleModel | null {
    const obj_type = stream.readUint8();
    switch (obj_type) {
        case 0x00: return readAsterixObjSolidModel(stream);
        case 0x01: return readAsterixObjIntangibleModel(stream);
        //case 0x02: StaticBillboard
        //case 0x03: Pickup03
        //case 0x04: Pickup04
        //case 0x05: Pickup05
        //case 0x06: Pickup06
        //case 0x07: Pickup07
        //case 0x08: Pickup08
        //case 0x09: _09,
        //case 0x0A: BouncePad
        //case 0x0B: Elevator
        //case 0x0C: Button
        //case 0x0D: _0D,
        //case 0x0E: _0E,
        //case 0x0F: _0F,
        //case 0x10: _10,
        //case 0x11: _11,
        //case 0x12: _12,
        //case 0x13: _13,
        //case 0x14: Crate
        //case 0x15: HintsNpc
        //case 0x16: _16,
        //case 0x17: _17,
        //case 0x18: _18,
        //case 0x19: LevelComplete
        //case 0x1A: _1A,
        //case 0x1B: _1B,
        //case 0x1C: _1C,
        //case 0x1D: _1D,
        //case 0x1E: _1E,
        //case 0x1F: _1F,
        //case 0x20: _20,
        //case 0x21: _21,
        //case 0x22: _22,
        //case 0x23: _23,
        //case 0x24: _24,
        //case 0x25: _25,
        //case 0x26: _26,
    }
    return null;
}

function readAsterixObjects(stream: DataStream, offsets: number[]): AsterixObject[] {
    let objects: AsterixObject[] = [];
    let base_addr = stream.offs;
    for (let i = 0; i < offsets.length; ++i) {
        let curr_offset = offsets[i];
        while (curr_offset != -1) {
            stream.offs = base_addr + curr_offset - 8; // maybe make a seek function
            let preamble_pos = readAsterixVertex(stream);
            let preamble_unk = stream.readInt16();
            let next_offset = stream.readInt16();
            let payload = readAsterixObjectPayload(stream);
            let object: AsterixObject = { preamble_pos, preamble_unk, payload };
            objects.push(object);
            curr_offset = next_offset;
        }
    }
    return objects;
}

export function parse(buffer: ArrayBufferSlice, version: Version): AsterixLvl {
    const stream = new DataStream(buffer);

    const palette = readAsterixPalette(stream);
    const textureQuads = readAsterixTextureQuadTable(stream);
    const lvlHeader = readAsterixLvlHeader(stream, version);
    const vertexTable = readAsterixVertexTable(stream, lvlHeader);
    const materialAttrs = readAsterixMaterialAttrTable(stream, lvlHeader);
    const collisionSpans0 = readAsterixCollisionSpanTable(stream, lvlHeader);
    const collisionSpans1 = readAsterixCollisionSpanTable(stream, lvlHeader);
    const objectOffsets = readAsterixObjectOffsets(stream, lvlHeader);
    const objects = readAsterixObjects(stream, objectOffsets);

    return { palette, textureQuads, lvlHeader, vertexTable, materialAttrs, collisionSpans0, collisionSpans1, objectOffsets, objects };
}
