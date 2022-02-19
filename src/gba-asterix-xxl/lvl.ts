
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero } from "../util";
import { DataStream } from "./DataStream";

const V3D_LEVEL_WIDTH_CELLS = 12;
const V3D_LEVEL_WIDTH_VERTS = (V3D_LEVEL_WIDTH_CELLS + 1);

interface AsterixUv {
    u: number;
    v: number;
}

interface AsterixTextureQuad {
    flags: number; // bits 0-3: polygon type:
    //           0: invisible
    //           1: colored
    //           3: textured
    // bits 4-7: texture index
    uvs: AsterixUv[];
}

interface AsterixLvlHeader {
    numStrips: number;
    unknown1: number;
    unknown2: number;
    unknown3: number;
}

export interface AsterixXZ {
    x: number;
    z: number;
}

interface AsterixVertex {
    x: number;
    y: number;
    z: number;
}

interface AsterixMaterialAttr {
    textureQuadIndex: number;
    flags: number; // bit 0: render quality (0: use 1px quality, 1: use 2px cheap-render path)
    // bit 1: player can stand on this
    // bit 2: player can swim in this
    // bit 3: player will slip off this
    // bit 4: camera will point upwards at player
    // bit 5: seems to instantly kill the player
    // bit 6: used on one side of the first barrier wall in level1?
    // bit 7: also used on one side of the first barrier wall in level1, but on the floor
}

interface AsterixCollisionSpan {
    a: AsterixVertex;
    b: AsterixVertex;
}

interface AsterixTriPoly {
    indices: number[],
    flags: number, // bits 0-3: polygon type:
    //           0: invisible
    //           1: colored
    //           3: textured (1px)
    //           4: textured (2px)
    // bits 4-7: texture index
    uvs: AsterixUv[],
}

export interface AsterixTriModel {
    verts: AsterixVertex[],
    polys: AsterixTriPoly[],
}

export interface AsterixAlignedBounds {
    x_min: number,
    x_max: number,
    z_min: number,
    z_max: number,
}

export interface AsterixUnalignedBounds {
    bounds: AsterixXZ[], // [4]
}

export interface AsterixCommonBillboard {
    tex_id: number,
    pos: AsterixVertex,
    width: number,
    height: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
}

export interface AsterixCommonPickup {
    billboard: AsterixCommonBillboard,
    unk_bytes: number[], // [u8;8]
}

export interface AsterixObjSolidModel {
    type: AsterixObjectType,
    unk1: number,
    model: AsterixTriModel,
    broad_bounds: AsterixAlignedBounds,
}

export interface AsterixObjIntangibleModel {
    type: AsterixObjectType,
    unk1: number,
    model: AsterixTriModel,
}

export interface AsterixObjStaticBillboard {
    type: AsterixObjectType,
    billboard: AsterixCommonBillboard,
}

export interface AsterixObjPickup03 {
    type: AsterixObjectType,
    pickup: AsterixCommonPickup,
}

export interface AsterixObjPickup04 {
    type: AsterixObjectType,
    pickup: AsterixCommonPickup,
}

export interface AsterixObjPickup05 {
    type: AsterixObjectType,
    pickup: AsterixCommonPickup,
}

export interface AsterixObjPickup06 {
    type: AsterixObjectType,
    pickup: AsterixCommonPickup,
    unk1: number,
}

export interface AsterixObjPickup07 {
    type: AsterixObjectType,
    pickup: AsterixCommonPickup,
}

export interface AsterixObjPickup08 {
    type: AsterixObjectType,
    pickup: AsterixCommonPickup,
}

export interface AsterixObjPushableBox {
    type: AsterixObjectType,
    unk1: number,
    model: AsterixTriModel,
    xz_bounds_1: AsterixAlignedBounds,
    extra_verts: AsterixVertex[], // [8]
    xz_bounds_2: AsterixAlignedBounds,
    unk2: number,
    distance: number, // distance between range_start and range_end, in [0,0x4000]
    range_start: AsterixVertex,
    range_end: AsterixVertex,
}

export interface AsterixObjTrampoline {
    type: AsterixObjectType,
    unk1: number,
    model: AsterixTriModel,
    broad_bounds: AsterixAlignedBounds,
}

export interface AsterixObjElevator {
    type: AsterixObjectType,
    state_flags: number;
    dummy_model: AsterixTriModel;
    broad_bounds: AsterixAlignedBounds;
    min_elevation: number;
    max_elevation: number;
    paused: number;
    unused: number;
    render_model: AsterixTriModel;
}

export interface AsterixObjButton {
    type: AsterixObjectType,
    state: number, // bits 0-6: number of attachments
    // bit 7:    is pressed
    pressed_model: AsterixTriModel,
    released_model: AsterixTriModel,
    attachment_offsets: number[],
    score_requirement: number,
    billboard: AsterixCommonBillboard,
    unk1: number, // definitely read, not sure of purpose
    unk2: number, // unused?
}

interface AsterixEnemyPickup0F {
    unk_shorts: number[],
    unk_bytes: number[],
    billboard: AsterixCommonBillboard | null, // Proto A
    pickup: AsterixCommonPickup | null, // Proto B & Retail
    unk_bytes_2: number[],
}
export interface AsterixObjEnemy0F {
    type: AsterixObjectType,
    unk1: number,
    num_endvalues: number,
    unk2: number,
    unk3: number,
    unk4: number,
    num_pickups: number,
    unk5: number,
    unk6: number,
    spawn_point: AsterixVertex,
    tight_bounds: AsterixUnalignedBounds,
    pickups: AsterixEnemyPickup0F[],
    endvalues: number[],
    unk7: number,
}

interface AsterixCrateEmbeddedObject {
    unk1: number,
    angle: number,
    object: AsterixObject | null,
}
export interface AsterixObjCrate {
    type: AsterixObjectType,
    unk1: number,
    model: AsterixTriModel,
    broad_bounds: AsterixAlignedBounds,
    tight_bounds: AsterixUnalignedBounds,
    embedded_items: AsterixCrateEmbeddedObject[],
}

export interface AsterixObjHintsNpc {
    type: AsterixObjectType,
    hint_string_id: number,
    animation_frame: number,
    unk1: number,
    angle: number, // wraps at 0x400
    pos: AsterixVertex,
    probably_unaligned_bounds: AsterixUnalignedBounds, // probably
}

export interface AsterixObjLevelComplete {
    type: AsterixObjectType,
    animation_frame: number,
    unk1: number,
    model_id: number,
    angle: number, // wraps at 0x400
    pos: AsterixVertex,
    probably_unaligned_bounds: AsterixUnalignedBounds, // probably
}

type AsterixObject =
    | AsterixObjSolidModel
    | AsterixObjIntangibleModel
    | AsterixObjStaticBillboard
    | AsterixObjPickup03
    | AsterixObjPickup04
    | AsterixObjPickup05
    | AsterixObjPickup06
    | AsterixObjPickup07
    | AsterixObjPickup08
    | AsterixObjPushableBox
    | AsterixObjTrampoline
    | AsterixObjElevator
    | AsterixObjButton
    | AsterixObjEnemy0F
    | AsterixObjCrate
    | AsterixObjHintsNpc
    | AsterixObjLevelComplete;

interface AsterixGenericObject {
    preamble_pos: AsterixVertex;
    preamble_unk: number;
    payload: AsterixObject | null;
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
    objects: AsterixGenericObject[];
}

export const enum Version {
    PrototypeA = 0,
    PrototypeB = 1,
    Retail = 2,
}

export const enum AsterixObjectType {
    SolidModel = 0x00,
    IntangibleModel = 0x01,
    StaticBillboard = 0x02,
    Pickup03 = 0x03,
    Pickup04 = 0x04,
    Pickup05 = 0x05,
    Pickup06 = 0x06,
    Pickup07 = 0x07,
    Pickup08 = 0x08,
    PushableBox = 0x09,
    Trampoline = 0x0A,
    Elevator = 0x0B,
    Button = 0x0C,
    _0D = 0x0D,
    _0E = 0x0E,
    Enemy0F = 0x0F,
    _10 = 0x10,
    _11 = 0x11,
    _12 = 0x12,
    _13 = 0x13,
    Crate = 0x14,
    HintsNpc = 0x15,
    _16 = 0x16,
    _17 = 0x17,
    _18 = 0x18,
    LevelComplete = 0x19,
    _1A = 0x1A,
    _1B = 0x1B,
    _1C = 0x1C,
    _1D = 0x1D,
    _1E = 0x1E,
    _1F = 0x1F,
    _20 = 0x20,
    _21 = 0x21,
    _22 = 0x22,
    _23 = 0x23,
    _24 = 0x24,
    _25 = 0x25,
    _26 = 0x26,
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

function readAsterixXZ(stream: DataStream): AsterixXZ {
    const x = stream.readInt16();
    const z = stream.readInt16();
    return { x, z };
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

function readAsterixAlignedBounds(stream: DataStream): AsterixAlignedBounds {
    const x_min = stream.readInt16();
    const x_max = stream.readInt16();
    const z_min = stream.readInt16();
    const z_max = stream.readInt16();

    return { x_min, x_max, z_min, z_max };
}

function readAsterixUnalignedBounds(stream: DataStream): AsterixUnalignedBounds {
    const bounds = [
        readAsterixXZ(stream),
        readAsterixXZ(stream),
        readAsterixXZ(stream),
        readAsterixXZ(stream),
    ];

    return { bounds };
}

function readAsterixCommonBillboard(stream: DataStream): AsterixCommonBillboard {
    const tex_id = stream.readUint8();
    const pos = readAsterixVertex(stream);
    const width = stream.readInt16();
    const height = stream.readInt16();
    const left = stream.readUint8();
    const top = stream.readUint8();
    const right = stream.readUint8();
    const bottom = stream.readUint8();

    return { tex_id, pos, width, height, left, top, right, bottom };
}

function readAsterixCommonPickup(stream: DataStream): AsterixCommonPickup {
    const billboard = readAsterixCommonBillboard(stream);
    const unk_bytes = [
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
    ];

    return { billboard, unk_bytes };
}

function readAsterixObjSolidModel(stream: DataStream): AsterixObjSolidModel {
    const unk1 = stream.readUint8();
    const model = readAsterixTriModel(stream);
    const broad_bounds = readAsterixAlignedBounds(stream);

    return {
        type: AsterixObjectType.SolidModel,
        unk1,
        model,
        broad_bounds
    };
}

function readAsterixObjIntangibleModel(stream: DataStream): AsterixObjIntangibleModel {
    const unk1 = stream.readUint8();
    const model = readAsterixTriModel(stream);

    return {
        type: AsterixObjectType.IntangibleModel,
        unk1,
        model
    };
}

function readAsterixObjStaticBillboard(stream: DataStream): AsterixObjStaticBillboard {
    const billboard = readAsterixCommonBillboard(stream);

    return {
        type: AsterixObjectType.StaticBillboard,
        billboard
    };
}

function readAsterixObjPickup03(stream: DataStream): AsterixObjPickup03 {
    const pickup = readAsterixCommonPickup(stream);

    return {
        type: AsterixObjectType.Pickup03,
        pickup
    };
}

function readAsterixObjPickup04(stream: DataStream): AsterixObjPickup04 {
    const pickup = readAsterixCommonPickup(stream);

    return {
        type: AsterixObjectType.Pickup04,
        pickup
    };
}

function readAsterixObjPickup05(stream: DataStream): AsterixObjPickup05 {
    const pickup = readAsterixCommonPickup(stream);

    return {
        type: AsterixObjectType.Pickup05,
        pickup
    };
}

function readAsterixObjPickup06(stream: DataStream): AsterixObjPickup06 {
    const pickup = readAsterixCommonPickup(stream);
    const unk1 = stream.readUint16();

    return {
        type: AsterixObjectType.Pickup06,
        pickup,
        unk1
    };
}

function readAsterixObjPickup07(stream: DataStream): AsterixObjPickup07 {
    const pickup = readAsterixCommonPickup(stream);

    return {
        type: AsterixObjectType.Pickup07,
        pickup
    };
}

function readAsterixObjPickup08(stream: DataStream): AsterixObjPickup08 {
    const pickup = readAsterixCommonPickup(stream);

    return {
        type: AsterixObjectType.Pickup08,
        pickup
    };
}

function readAsterixObjPushableBox(stream: DataStream): AsterixObjPushableBox {
    const unk1 = stream.readUint8();
    const model = readAsterixTriModel(stream);
    const xz_bounds_1 = readAsterixAlignedBounds(stream);
    const extra_verts = [
        readAsterixVertex(stream),
        readAsterixVertex(stream),
        readAsterixVertex(stream),
        readAsterixVertex(stream),
        readAsterixVertex(stream),
        readAsterixVertex(stream),
        readAsterixVertex(stream),
        readAsterixVertex(stream),
    ];
    const xz_bounds_2 = readAsterixAlignedBounds(stream);
    const unk2 = stream.readUint16();
    const distance = stream.readUint16();
    const range_start = readAsterixVertex(stream);
    const range_end = readAsterixVertex(stream);

    return {
        type: AsterixObjectType.PushableBox,
        unk1,
        model,
        xz_bounds_1,
        extra_verts,
        xz_bounds_2,
        unk2,
        distance,
        range_start,
        range_end
    };
}

function readAsterixObjTrampoline(stream: DataStream): AsterixObjTrampoline {
    const unk1 = stream.readUint8();
    const model = readAsterixTriModel(stream);
    const broad_bounds = readAsterixAlignedBounds(stream);

    return {
        type: AsterixObjectType.Trampoline,
        unk1,
        model,
        broad_bounds
    };
}

function readAsterixObjElevator(stream: DataStream): AsterixObjElevator {
    const state_flags = stream.readUint8();
    const dummy_model = readAsterixTriModel(stream);
    const broad_bounds = readAsterixAlignedBounds(stream);
    const min_elevation = stream.readInt16();
    const max_elevation = stream.readInt16();
    const paused = stream.readUint8();
    const unused = stream.readUint8();
    const render_model = readAsterixTriModel(stream);

    return {
        type: AsterixObjectType.Elevator,
        state_flags,
        dummy_model,
        broad_bounds,
        min_elevation,
        max_elevation,
        paused,
        unused,
        render_model
    };
}

function readAsterixObjButton(stream: DataStream, version: Version): AsterixObjButton {
    const state = stream.readUint8();
    const num_attachments = (state & 0x7f);
    const pressed_model = readAsterixTriModel(stream);
    const released_model = readAsterixTriModel(stream);
    let attachment_offsets: number[] = [];
    for (let i = 0; i < num_attachments; ++i) {
        attachment_offsets.push(stream.readUint16());
    }
    const score_requirement = stream.readUint8();
    const billboard = readAsterixCommonBillboard(stream);
    let unk1 = 0;
    let unk2 = 0;
    if (version == Version.Retail) {
        unk1 = stream.readUint8();
        unk2 = stream.readUint8();
    }

    return {
        type: AsterixObjectType.Button,
        state,
        pressed_model,
        released_model,
        attachment_offsets,
        score_requirement,
        billboard,
        unk1,
        unk2
    }
}

function readAsterixEnemyPickup0F(stream: DataStream, version: Version): AsterixEnemyPickup0F {
    const unk_shorts = [
        stream.readInt16(),
        stream.readInt16(),
        stream.readInt16(),
        stream.readInt16(),
        stream.readInt16(),
    ];
    const unk_bytes = [
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
        stream.readUint8(),
    ];
    const billboard = (version == Version.PrototypeA) ? readAsterixCommonBillboard(stream) : null;
    const pickup = (version != Version.PrototypeA) ? readAsterixCommonPickup(stream) : null;
    const unk_bytes_2 = [
        stream.readUint8(),
        stream.readUint8(),
    ];

    assert(unk_shorts[1] >= -2 && unk_shorts[1] <= 1);
    assert(unk_shorts[4] >= -1 && unk_shorts[4] <= 1);

    assert(unk_bytes[0] == 0);
    assert(unk_bytes[1] == 0);
    assert(unk_bytes[2] == 0 || unk_bytes[2] == 1);
    assert(unk_bytes[3] == 0);
    assert(unk_bytes[4] == 0);
    assert(unk_bytes[5] <= 2);
    assert(unk_bytes[6] == 0);
    assert(unk_bytes[7] == 0);
    assert(unk_bytes[8] == 0);

    if (billboard) {
        assert(billboard.tex_id == 3);
        assert(billboard.pos.x == 0);
        assert(billboard.pos.y == 0);
        assert(billboard.pos.z == 0);
        assert(billboard.width == 0x26);
        assert(billboard.height == 0x26);
        assert(billboard.left == 0);
        assert(billboard.top == 0);
        assert(billboard.right == 0);
        assert(billboard.bottom == 0);
    }

    if (pickup) {
        assert(pickup.billboard.tex_id == 3);
        assert(pickup.billboard.pos.x == 0);
        assert(pickup.billboard.pos.y == 0);
        assert(pickup.billboard.pos.z == 0);
        assert(pickup.billboard.width == 0x26);
        assert(pickup.billboard.height == 0x26);
        assert(pickup.billboard.left == 0);
        assert(pickup.billboard.top == 0);
        assert(pickup.billboard.right == 0);
        assert(pickup.billboard.bottom == 0);

        assert(pickup.unk_bytes[0] == 0xff);
        assert(pickup.unk_bytes[1] == 3 || pickup.unk_bytes[1] == 4);
        assert(pickup.unk_bytes[2] == 0);
        assert(pickup.unk_bytes[3] == 0);
        assert(pickup.unk_bytes[4] == 0);
        assert(pickup.unk_bytes[5] == 0);
        assert(pickup.unk_bytes[6] == 0);
        assert(pickup.unk_bytes[7] == 0);
    }

    assert(unk_bytes_2[0] == 0);
    assert(unk_bytes_2[1] == 0);

    return {
        unk_shorts,
        unk_bytes,
        billboard,
        pickup,
        unk_bytes_2,
    };
}

function readAsterixObjEnemy0F(stream: DataStream, version: Version): AsterixObjEnemy0F {
    const unk1 = stream.readUint8();
    const num_endvalues = stream.readUint8();
    const unk2 = stream.readUint8();
    const unk3 = stream.readUint8();
    const unk4 = stream.readUint8();
    const num_pickups = stream.readUint8();
    const unk5 = stream.readUint8();
    const unk6 = stream.readUint16();
    const spawn_point = readAsterixVertex(stream);
    const tight_bounds = readAsterixUnalignedBounds(stream);

    let pickups: AsterixEnemyPickup0F[] = [];
    for (let i = 0; i < num_pickups; ++i) {
        pickups.push(readAsterixEnemyPickup0F(stream, version));
    }

    let endvalues: number[] = [];
    for (let i = 0; i < num_endvalues; ++i) {
        endvalues.push(stream.readUint16());
    }

    const unk7 = stream.readUint16();

    return {
        type: AsterixObjectType.Enemy0F,
        unk1,
        num_endvalues,
        unk2,
        unk3,
        unk4,
        num_pickups,
        unk5,
        unk6,
        spawn_point,
        tight_bounds,
        pickups,
        endvalues,
        unk7
    };
}

function readAsterixObjCrate(stream: DataStream): AsterixObjCrate {
    const unk1 = stream.readUint8();
    const model = readAsterixTriModel(stream);
    const broad_bounds = readAsterixAlignedBounds(stream);
    const tight_bounds = readAsterixUnalignedBounds(stream);
    const num_embedded_items = stream.readUint16();
    let embedded_items: AsterixCrateEmbeddedObject[] = [];
    // disabled until I write in parsing for types 3-8
    /*for (let i = 0; i < num_embedded_items; ++i) {
        const unk1 = stream.readUint8();
        const angle = stream.readUint8();
        const object = readAsterixObjectPayload(stream);
        embedded_items.push({ unk1, angle, object});
    }*/

    return {
        type: AsterixObjectType.Crate,
        unk1,
        model,
        broad_bounds,
        tight_bounds,
        embedded_items
    };
}

function readAsterixObjHintsNpc(stream: DataStream): AsterixObjHintsNpc {
    const hint_string_id = stream.readUint8();
    const animation_frame = stream.readUint8();
    const unk1 = stream.readUint8();
    const angle = stream.readUint16();
    const pos = readAsterixVertex(stream);
    const probably_unaligned_bounds = readAsterixUnalignedBounds(stream);

    return {
        type: AsterixObjectType.HintsNpc,
        hint_string_id,
        animation_frame,
        unk1,
        angle,
        pos,
        probably_unaligned_bounds
    };
}

function readAsterixObjLevelComplete(stream: DataStream): AsterixObjLevelComplete {
    const animation_frame = stream.readUint8();
    const unk1 = stream.readUint8();
    const model_id = stream.readUint8();
    const angle = stream.readUint16();
    const pos = readAsterixVertex(stream);
    const probably_unaligned_bounds = readAsterixUnalignedBounds(stream);

    return {
        type: AsterixObjectType.LevelComplete,
        animation_frame,
        unk1,
        model_id,
        angle,
        pos,
        probably_unaligned_bounds
    }
}

function readAsterixObjectPayload(stream: DataStream, version: Version): AsterixObject | null {
    const obj_type = stream.readUint8();
    switch (obj_type) {
        case AsterixObjectType.SolidModel:
            return readAsterixObjSolidModel(stream);
        case AsterixObjectType.IntangibleModel:
            return readAsterixObjIntangibleModel(stream);
        case AsterixObjectType.StaticBillboard:
            return readAsterixObjStaticBillboard(stream);
        case AsterixObjectType.Pickup03:
            return readAsterixObjPickup03(stream);
        case AsterixObjectType.Pickup04:
            return readAsterixObjPickup04(stream);
        case AsterixObjectType.Pickup05:
            return readAsterixObjPickup05(stream);
        case AsterixObjectType.Pickup06:
            return readAsterixObjPickup06(stream);
        case AsterixObjectType.Pickup07:
            return readAsterixObjPickup07(stream);
        case AsterixObjectType.Pickup08:
            return readAsterixObjPickup08(stream);
        case AsterixObjectType.PushableBox:
            return readAsterixObjPushableBox(stream);
        case AsterixObjectType.Trampoline:
            return readAsterixObjTrampoline(stream);
        case AsterixObjectType.Elevator:
            return readAsterixObjElevator(stream);
        case AsterixObjectType.Button:
            return readAsterixObjButton(stream, version);
        //case 0x0D: _0D,
        //case 0x0E: _0E,
        case AsterixObjectType.Enemy0F:
            return readAsterixObjEnemy0F(stream, version);
        //case 0x10: _10,
        //case 0x11: _11,
        //case 0x12: _12,
        //case 0x13: _13,
        case AsterixObjectType.Crate:
            return readAsterixObjCrate(stream);
        case AsterixObjectType.HintsNpc:
            return readAsterixObjHintsNpc(stream);
        //case 0x16: _16,
        //case 0x17: _17,
        //case 0x18: _18,
        case AsterixObjectType.LevelComplete:
            return readAsterixObjLevelComplete(stream);
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
        default:
            console.log(`unimplemented object type ${hexzero(obj_type, 2)}`);
            return null;
    }
}

function readAsterixGenericObjects(stream: DataStream, offsets: number[], version: Version): AsterixGenericObject[] {
    let objects: AsterixGenericObject[] = [];
    let base_addr = stream.offs;
    for (let i = 0; i < offsets.length; ++i) {
        let curr_offset = offsets[i];
        while (curr_offset != -1) {
            stream.offs = base_addr + curr_offset;
            let preamble_pos: AsterixVertex = { x: 0, y: 0, z: 0 };
            let preamble_unk: number = 0;
            if (version == Version.Retail) {
                // preamble only seems to exist in retail format
                stream.offs -= 8;
                preamble_pos = readAsterixVertex(stream);
                preamble_unk = stream.readInt16();
            }
            let next_offset = stream.readInt16();
            let payload = readAsterixObjectPayload(stream, version);
            let object: AsterixGenericObject = { preamble_pos, preamble_unk, payload };
            objects.push(object);
            curr_offset = next_offset;
        }
    }
    return objects;
}

export function parseLVL(buffer: ArrayBufferSlice, version: Version): AsterixLvl {
    const stream = new DataStream(buffer);

    const palette = readAsterixPalette(stream);
    const textureQuads = readAsterixTextureQuadTable(stream);
    const lvlHeader = readAsterixLvlHeader(stream, version);
    const vertexTable = readAsterixVertexTable(stream, lvlHeader);
    const materialAttrs = readAsterixMaterialAttrTable(stream, lvlHeader);
    const collisionSpans0 = readAsterixCollisionSpanTable(stream, lvlHeader);
    const collisionSpans1 = readAsterixCollisionSpanTable(stream, lvlHeader);
    const objectOffsets = readAsterixObjectOffsets(stream, lvlHeader);
    const objects = readAsterixGenericObjects(stream, objectOffsets, version);

    return { palette, textureQuads, lvlHeader, vertexTable, materialAttrs, collisionSpans0, collisionSpans1, objectOffsets, objects };
}


export interface BillboardKeyframe {
    left: number,
    top: number,
    right: number,
    bottom: number,
}

export interface BillboardAnim {
    keyframes: BillboardKeyframe[],
}

function readBillboardKeyframe(stream: DataStream): BillboardKeyframe {
    const left = stream.readUint8();
    const top = stream.readUint8();
    const right = stream.readUint8();
    const bottom = stream.readUint8();
    return { left, top, right, bottom };
}

export function parseBillboardAnim(buffer: ArrayBufferSlice): BillboardAnim {
    const stream = new DataStream(buffer);

    let keyframes: BillboardKeyframe[] = [];
    while (stream.offs + 4 <= stream.buffer.byteLength) {
        keyframes.push(readBillboardKeyframe(stream));
    }
    return { keyframes };
}
