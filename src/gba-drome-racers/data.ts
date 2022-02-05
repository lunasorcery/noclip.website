
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
    Poly1 = 1, // colored, single-sided
    Poly2 = 2, // colored, double-sided?
    Poly5 = 5, // textured, single-sided
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

interface PhysicsVert {
    x: number,
    z: number,
}

interface PhysicsPoly {
    num_verts: number,
    unk1: number,
    unk2: number,
    unk3: number,
    y: number,
    dydx: number,
    dydz: number,
    indices: number[],
    neighbors: number[],
}

export interface Track {
    unk1: number,
    spacing_x: number,
    unk2: number,
    spacing_z: number,
    size_x: number,
    size_z: number,
    layout: Int16Array,
    physics_verts: PhysicsVert[],
    physics_polys: PhysicsPoly[],
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

function readPhysicsVert(stream: DataStream): PhysicsVert {
    const x = stream.readUint32() / 0x1000;
    const z = stream.readUint32() / 0x1000;
    return { x, z };
}

function readPhysicsPoly(stream: DataStream): PhysicsPoly {
    const num_verts = stream.readUint8();
    const unk1 = stream.readUint8();
    const unk2 = stream.readUint8();
    const unk3 = stream.readUint8();
    const y    = stream.readInt32() / 0x1000;
    const dydx = stream.readInt32() / 0x1000;
    const dydz = stream.readInt32() / 0x1000;
    let indices :number[] =[];
    for (let i = 0; i < num_verts; ++i) {
        indices.push(stream.readUint16());
    }
    let neighbors :number[] =[];
    for (let i = 0; i < num_verts; ++i) {
        neighbors.push(stream.readUint16());
    }
    return { num_verts, unk1, unk2, unk3, y, dydx, dydz, indices, neighbors };
}

function readTrack(stream: DataStream): Track {
    const addr_base = stream.offs;

    const unk1 = stream.readUint16();      // 0x0000 always?
    const spacing_x = stream.readUint16(); // 0x0100 on Drome Racers, 0x0200 on Hot Wheels
    const unk2 = stream.readUint16();      // 0x1000 on Drome Racers, 0x2000 on Hot Wheels
    const spacing_z = stream.readUint16(); // 0x0100 on Drome Racers, 0x0200 on Hot Wheels
    const size_x = stream.readUint16();
    const size_z = stream.readUint16();
    const ptr_layout = stream.readUint32();
    const ptr_physics_verts = stream.readUint32();
    const ptr_physics_polys = stream.readUint32();
    const num_physics_verts = stream.readUint16();
    const num_physics_polys = stream.readUint16();

    stream.offs = addr_base + ptr_layout;
    let layout = new Int16Array(size_x * size_z);
    for (let i = 0; i < size_x * size_z; ++i) {
        layout[i] = stream.readInt16();
    }

    stream.offs = addr_base + ptr_physics_verts;
    let physics_verts: PhysicsVert[] = [];
    for (let i = 0; i < num_physics_verts; ++i) {
        physics_verts.push(readPhysicsVert(stream));
    }

    stream.offs = addr_base + ptr_physics_polys;
    let physics_poly_ptrs: number[] = [];
    for (let i = 0; i < num_physics_polys; ++i) {
        physics_poly_ptrs.push(stream.readUint32());
    }
    let physics_polys: PhysicsPoly[] = [];
    for (let i = 0; i < num_physics_polys; ++i) {
        stream.offs = addr_base + ptr_physics_polys + physics_poly_ptrs[i];
        physics_polys.push(readPhysicsPoly(stream));
    }

    return { unk1, spacing_x, unk2, spacing_z, size_x, size_z, layout, physics_verts, physics_polys };
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
        stream.offs = ptr_track_headers + (i * 28);
        tracks.push(readTrack(stream));
    }

    return { palette, texture, models, tracks };
}
