
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";
import { DataStream } from "./DataStream";

interface Vertex {
    x: number;
    y: number;
    z: number;
}

export enum PolyType {
    End = 0,
    Poly1 = 1,
    Poly2 = 2,
    Poly5 = 5,
}

type Poly =
    | Poly1
    | Poly2
    | Poly5;

export interface Poly1 {
    type: PolyType,
    unk1: number,
    unk2: number,
    unk3: number,
    unk4: number,
    unk5: number,
    i0: number,
    i1: number,
    i2: number,
    color: number,
}

export interface Poly2 {
    type: PolyType,
    i0: number,
    i1: number,
    i2: number,
    color: number,
}

export interface Poly5 {
    type: PolyType,
    unk1: number,
    unk2: number,
    unk3: number,
    unk4: number,
    unk5: number,
    i0: number,
    i1: number,
    i2: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    u2: number,
    v2: number,
}

export interface Model {
    zero: number,
    unk1: number,
    min_x: number,
    min_y: number,
    min_z: number,
    max_x: number,
    max_y: number,
    max_z: number,
    verts: Vertex[],
    polys: Poly[],
}

interface Track {
    unk1: number,      // .2byte 0x0000 always?
    spacing_x: number, // .2byte 0x0100 on DR, 0x0200 on HW
    unk2: number,      // .2byte 0x1000 on DR, 0x2000 on HW
    spacing_z: number, // .2byte 0x0100 on DR, 0x0200 on HW
    width: number,  //.2byte 23 ; width
    height: number, //.2byte 16 ; height
    layout: Int16Array,
    //physics_verts: any,
    //physics_polys: any,
}

export interface Zone {
    texture: Uint8Array,
    palette: Uint16Array,
    models: Model[],
    tracks: Track[],
}

function readTexture(stream: DataStream): Uint8Array {
    let texture = new Uint8Array(256 * 256);
    for (let i = 0; i < texture.length; i++) {
        texture[i] = stream.readUint8();
    }
    return texture;
}

function readPalette(stream: DataStream): Uint16Array {
    let palette = new Uint16Array(256);
    for (let i = 0; i < palette.length; i++) {
        palette[i] = stream.readUint16();
    }
    return palette;
}

function readVertex(stream: DataStream): Vertex {
    const x = stream.readInt16();
    const y = stream.readInt16();
    const z = stream.readInt16();
    const w0 = stream.readInt16();
    assert(w0 == 0);
    return { x, y, z };
}

function readPoly(stream: DataStream): Poly | null {
    const type = stream.readUint32() as PolyType;
    switch (type) {
        case PolyType.Poly1: {
            const unk1 = stream.readInt16();
            const unk2 = stream.readInt16();
            const unk3 = stream.readInt16();
            const unk4 = stream.readInt16();
            const unk5 = stream.readInt16();
            const zero = stream.readInt16(); assert(zero == 0);
            const i0 = stream.readUint8();
            const i1 = stream.readUint8();
            const i2 = stream.readUint8();
            const color = stream.readUint8();
            const result: Poly1 = { type, unk1, unk2, unk3, unk4, unk5, i0, i1, i2, color };
            return result;
        }
        case PolyType.Poly2: {
            const i0 = stream.readUint8();
            const i1 = stream.readUint8();
            const i2 = stream.readUint8();
            const color = stream.readUint8();
            const result: Poly2 = { type, i0, i1, i2, color };
            return result;
        }
        case PolyType.Poly5: {
            const unk1 = stream.readInt16();
            const unk2 = stream.readInt16();
            const unk3 = stream.readInt16();
            const unk4 = stream.readInt16();
            const unk5 = stream.readInt16();
            const zero = stream.readInt16(); assert(zero == 0);
            const i0 = stream.readUint8();
            const i1 = stream.readUint8();
            const i2 = stream.readUint8();
            const unused_color = stream.readUint8(); assert(unused_color == 0);
            const u0 = stream.readUint16();
            const v0 = stream.readUint16();
            const u1 = stream.readUint16();
            const v1 = stream.readUint16();
            const u2 = stream.readUint16();
            const v2 = stream.readUint16();
            const result: Poly5 = { type, unk1, unk2, unk3, unk4, unk5, i0, i1, i2, u0, v0, u1, v1, u2, v2 };
            return result;
        }
        case PolyType.End: {
            return null;
        }
        default: {
            console.log('missing polygon type ' + type);
            assert(false);
        }
    }
}

function readModel(stream: DataStream): Model {
    const addr_base = stream.offs;

    const zero = stream.readInt16();
    const unk1 = stream.readInt16();
    const min_x = stream.readInt16();
    const min_y = stream.readInt16();
    const min_z = stream.readInt16();
    const max_x = stream.readInt16();
    const max_y = stream.readInt16();
    const max_z = stream.readInt16();
    const num_polys = stream.readUint16();
    const num_verts = stream.readUint16();
    const ptr_polys = stream.readUint32();
    const ptr_verts = stream.readUint32();

    stream.offs = addr_base + ptr_verts;
    let verts: Vertex[] = [];
    for (let i = 0; i < num_verts; ++i) {
        verts.push(readVertex(stream));
    }

    stream.offs = addr_base + ptr_polys;
    let polys: Poly[] = [];
    for (let i = 0; i < num_polys; ++i) {
        const poly = readPoly(stream);
        if (poly !== null) {
            assert(poly.i0 < num_verts);
            assert(poly.i1 < num_verts);
            assert(poly.i2 < num_verts);
            polys.push(poly);
        } else {
            break;
        }
    }

    return { zero, unk1, min_x, min_y, min_z, max_x, max_y, max_z, verts, polys };
}

function readTrack(stream: DataStream): Track {
    const addr_base = stream.offs;

    const unk1 = stream.readUint16();      // .2byte 0x0000 always?
    const spacing_x = stream.readUint16(); // .2byte 0x0100 on DR, 0x0200 on HW
    const unk2 = stream.readUint16();      // .2byte 0x1000 on DR, 0x2000 on HW
    const spacing_z = stream.readUint16(); // .2byte 0x0100 on DR, 0x0200 on HW
    const width = stream.readUint16();  //.2byte 23 ; width
    const height = stream.readUint16(); //.2byte 16 ; height
    const ptr_layout = stream.readUint32(); //.4byte _EU0817D9C0_NA0817D28C_zone0_track0_layout_map - _EU0817D96C_NA0817D238_zone0_track0_layout_header
    const ptr_physics_verts = stream.readUint32();  //.4byte _EU0817DCA0_NA0817D56C_zone0_track0_layout_physics_verts - _EU0817D96C_NA0817D238_zone0_track0_layout_header
    const ptr_physics_polys = stream.readUint32();  //.4byte _EU0817E640_NA0817DF0C_zone0_track0_layout_physics_polys - _EU0817D96C_NA0817D238_zone0_track0_layout_header
    const num_physics_verts = stream.readUint16();  //.2byte 308 ; number of physics verts
    const num_physics_polys = stream.readUint16();  //.2byte 284 ; number of physics polys
    
    stream.offs = addr_base + ptr_layout;
    let layout = new Int16Array(width*height);
    for (let i = 0; i < width*height; ++i) {
        layout[i] = stream.readInt16();
    }

    return { unk1, spacing_x, unk2, spacing_z, width, height, layout };
}

export function parseZone(buffer: ArrayBufferSlice): Zone {
    const stream = new DataStream(buffer);

    const ptr_texture = stream.readUint32();
    const ptr_palette = stream.readUint32();
    const num_unknowns = stream.readUint32();
    const ptr_unknowns = stream.readUint32();
    const num_tracks = stream.readUint32();
    const ptr_track_headers = stream.readUint32();

    const num_models = stream.readUint32();
    let model_ptrs: number[] = [];
    for (let i = 0; i < num_models; ++i) {
        model_ptrs.push(stream.readUint32());
    }

    stream.offs = ptr_texture;
    const texture = readTexture(stream);

    stream.offs = ptr_palette;
    const palette = readPalette(stream);

    let models: Model[] = [];
    for (let i = 0; i < num_models; ++i) {
        stream.offs = model_ptrs[i];
        models.push(readModel(stream));
    }

    let tracks: Track[] = [];
    for (let i = 0; i < num_tracks; ++i) {
        stream.offs = ptr_track_headers + (i*28);
        tracks.push(readTrack(stream));
    }

    return { palette, texture, models, tracks };
}
