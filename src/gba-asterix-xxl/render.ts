
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { AsterixLvl, AsterixTriModel, AsterixObjectType, AsterixObjSolidModel, AsterixObjIntangibleModel, AsterixObjTrampoline, AsterixObjElevator, AsterixObjCrate } from "./lvl";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxTextureDimension, GfxRenderPass, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { DecodedSurfaceSW, surfaceToCanvas } from "../Common/bc_texture";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, ReadonlyMat4, vec2, vec3, vec4 } from "gl-matrix";
import { Camera, computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { nArray, assertExists, assert } from "../util";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { AABB } from '../Geometry';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

function expand5bitTo8bit(v5: number): number {
    return (v5 << 3) | (v5 >> 2);
}

function decodeBGR555(bgr555: number): number {
    const r = expand5bitTo8bit((bgr555 >> 0) & 0x1f);
    const g = expand5bitTo8bit((bgr555 >> 5) & 0x1f);
    const b = expand5bitTo8bit((bgr555 >> 10) & 0x1f);
    const a = 0xff;
    return (a << 24) | (b << 16) | (g << 8) | (r);
}

function decodeTextureData(width: number, height: number, indices: Uint8Array, palette: Uint16Array): DecodedSurfaceSW {

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

export interface AsterixTexture {
    name: string;
    width: number;
    height: number;
    indices: ArrayBufferSlice;
    palette: Uint16Array;
}

export class AsterixTextureHolder extends TextureHolder<AsterixTexture> {
    private textures: AsterixTexture[] = [];

    public loadTexture(device: GfxDevice, texture: AsterixTexture): LoadedTexture | null {
        const levelDatas: Uint8Array[] = [];
        const surfaces: HTMLCanvasElement[] = [];

        const pixels = texture.indices.createTypedArray(Uint8Array);
        const decodedSurface = decodeTextureData(texture.width, texture.height, pixels, texture.palette);
        levelDatas.push(decodedSurface.pixels as Uint8Array);

        const canvas = document.createElement('canvas');
        surfaceToCanvas(canvas, decodedSurface);
        surfaces.push(canvas);

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, levelDatas.length));
        device.uploadTextureData(gfxTexture, 0, levelDatas);

        const viewerTexture: Viewer.Texture = { name: texture.name, surfaces };
        device.setResourceName(gfxTexture, texture.name);

        this.textures.push(texture);

        return { gfxTexture, viewerTexture };
    }
}


class TriModelProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord0 = 2;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    public both = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_MeshFragParams {
    Mat4x3 u_ModelView;
};

uniform sampler2D u_Tex0;
uniform sampler2D u_Tex1;
uniform sampler2D u_Tex2;

varying vec4 v_Color;
varying vec2 v_TexCoord;
flat varying int v_PolyFlags;

#ifdef VERT
layout(location = ${TriModelProgram.a_Position})  in vec3 a_Position;
layout(location = ${TriModelProgram.a_Color})     in vec4 a_Color;
layout(location = ${TriModelProgram.a_TexCoord0}) in vec3 a_TexCoord0;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
    v_Color     = a_Color;
    v_TexCoord  = a_TexCoord0.xy;
    v_PolyFlags = int(a_TexCoord0.z);
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    const int FLAG_TEXTURE1 = 0x02;
    const int FLAG_TEXTURE2 = 0x04;
    const int FLAG_TEXTURE  = (FLAG_TEXTURE1 | FLAG_TEXTURE2);
    const int FLAG_ALL      = 0x0F;

    if ((v_PolyFlags & FLAG_ALL) == 0)
    {
        //discard;
        
        // halftone effect to show collision:
        ivec2 fc = ivec2(gl_FragCoord);
        if (((fc.x ^ fc.y) & 4) != 0)
            discard;

        t_Color = vec4(.5,0,0,0);
    }
    else if ((v_PolyFlags & FLAG_TEXTURE) != 0)
    {
        int texId = v_PolyFlags >> 4;
        vec2 texCoord = v_TexCoord / 256.;
        if (texId == 0) { t_Color = texture(SAMPLER_2D(u_Tex0), texCoord); }
        if (texId == 1) { t_Color = texture(SAMPLER_2D(u_Tex1), texCoord); }
        if (texId == 2) { t_Color = texture(SAMPLER_2D(u_Tex2), texCoord); }
        
        if (t_Color.a == 0.0)
            discard;
    }
    else
    {
        t_Color.rgb = v_Color.rgb;
    }

    gl_FragColor = t_Color;
}
#endif
`;
}

class TriModelGfxBuffers {
    private vertBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(
        device: GfxDevice,
        public verts: ArrayBufferSlice,
        public colors: ArrayBufferSlice,
        public uvs: ArrayBufferSlice,
        public indices: Uint16Array) {
        this.vertBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, verts);
        this.colorBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, colors);
        this.uvBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, uvs);

        const idxData = filterDegenerateTriangleIndexBuffer(indices);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: TriModelProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.S16_RGB },
            { location: TriModelProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
            { location: TriModelProgram.a_TexCoord0, bufferIndex: 2, bufferByteOffset: 0, format: GfxFormat.U8_RGB },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x06, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x03, frequency: GfxVertexBufferFrequency.PerVertex },
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: (GfxVertexBufferDescriptor | null)[] = [
            { buffer: this.vertBuffer, byteOffset: 0 },
            { buffer: this.colorBuffer, byteOffset: 0 },
            { buffer: this.uvBuffer, byteOffset: 0 },
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class TriModelData {
    public buffers: TriModelGfxBuffers;

    constructor(device: GfxDevice, model: AsterixTriModel, palette: Uint16Array) {
        const numPolys = model.polys.length;
        const vertsPerPoly = 3;
        const indicesPerPoly = 3;
        const channelsPerVert = 3;
        const channelsPerUv = 3;

        let verts = new Int16Array(numPolys * vertsPerPoly * channelsPerVert);
        let colors = new Uint32Array(numPolys * vertsPerPoly);
        let uvs = new Uint8Array(numPolys * vertsPerPoly * channelsPerUv);
        let indices = new Uint16Array(numPolys * indicesPerPoly);

        let vertIdx = 0;
        let colIdx = 0;
        let uvIdx = 0;
        let idxIdx = 0;
        for (let i = 0; i < numPolys; ++i) {
            const poly = model.polys[i];
            const i0 = poly.indices[0];
            const i1 = poly.indices[1];
            const i2 = poly.indices[2];

            const doRender = (poly.flags & 0x1) != 0;
            const isTextured = (poly.flags & 0x2) != 0;
            const isColored = !isTextured;
            const color = isColored
                ? decodeBGR555(palette[poly.uvs[0].u])
                : 0;

            if (doRender) {
                const currVertBase = vertIdx / channelsPerVert;
                indices[idxIdx++] = currVertBase + 0;
                indices[idxIdx++] = currVertBase + 1;
                indices[idxIdx++] = currVertBase + 2;

                verts[vertIdx++] = model.verts[i0].x;
                verts[vertIdx++] = model.verts[i0].y;
                verts[vertIdx++] = model.verts[i0].z;
                colors[colIdx++] = color;
                uvs[uvIdx++] = poly.uvs[0].u;
                uvs[uvIdx++] = poly.uvs[0].v;
                uvs[uvIdx++] = poly.flags;

                verts[vertIdx++] = model.verts[i1].x;
                verts[vertIdx++] = model.verts[i1].y;
                verts[vertIdx++] = model.verts[i1].z;
                colors[colIdx++] = color;
                uvs[uvIdx++] = poly.uvs[1].u;
                uvs[uvIdx++] = poly.uvs[1].v;
                uvs[uvIdx++] = poly.flags;

                verts[vertIdx++] = model.verts[i2].x;
                verts[vertIdx++] = model.verts[i2].y;
                verts[vertIdx++] = model.verts[i2].z;
                colors[colIdx++] = color;
                uvs[uvIdx++] = poly.uvs[2].u;
                uvs[uvIdx++] = poly.uvs[2].v;
                uvs[uvIdx++] = poly.flags;
            }
        }

        this.buffers = new TriModelGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(colors.buffer),
            new ArrayBufferSlice(uvs.buffer),
            indices);
    }
}

class TriModelInstance {
    private gfxProgram: GfxProgram | null = null;
    private program: TriModelProgram;
    private textureMapping = nArray(3, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor> = {};
    private sortKey: number = 0;

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, public triModelData: TriModelData) {
        this.program = new TriModelProgram();

        const gfxSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Point,
            minFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        const fillTextureReference = (dst: TextureMapping, textureId: string) => {
            if (textureHolder.hasTexture(textureId)) {
                textureHolder.fillTextureMapping(dst, textureId);
            } else {
                dst.gfxTexture = null;
            }
            dst.gfxSampler = gfxSampler;
        };

        fillTextureReference(this.textureMapping[0], 'tex0');
        fillTextureReference(this.textureMapping[1], 'tex1');
        fillTextureReference(this.textureMapping[2], 'tex2');

        this.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);

        this.megaState.frontFace = GfxFrontFaceMode.CW;
        this.megaState.cullMode = GfxCullMode.Back;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: ReadonlyMat4, viewerInput: Viewer.ViewerRenderInput) {
        const triModelBuffers = this.triModelData.buffers;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(triModelBuffers.inputLayout, triModelBuffers.inputState);
        renderInst.drawIndexes(triModelBuffers.indexCount);

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(this.megaState);

        renderInst.sortKey = this.sortKey;
        //scratchAABB.transform(meshFrag.bbox, modelMatrix);
        //const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, scratchAABB);
        //renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        let offs = renderInst.allocateUniformBuffer(TriModelProgram.ub_MeshFragParams, 20);
        const d = renderInst.mapUniformBufferF32(TriModelProgram.ub_MeshFragParams);
        mat4.mul(scratchMat4, viewerInput.camera.viewMatrix, modelMatrix);
        offs += fillMatrix4x3(d, offs, scratchMat4);

        //offs += fillVec4v(d, offs, meshFrag.materialColor);

        //const time = viewerInput.time / 4000;
        //const texCoordTransVel = meshFrag.texCoordTransVel;
        //const texCoordTransX = texCoordTransVel[0] * time;
        //const texCoordTransY = texCoordTransVel[1] * time;
        //offs += fillVec4(d, offs, texCoordTransX, texCoordTransY);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}


class EnvironmentProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord0 = 2;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    public both = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_MeshFragParams {
    Mat4x3 u_ModelView;
};

uniform sampler2D u_Tex0;
uniform sampler2D u_Tex1;
uniform sampler2D u_Tex2;

varying vec4 v_Color;
varying vec2 v_TexCoord;
flat varying int v_PolyFlags;

#ifdef VERT
layout(location = ${EnvironmentProgram.a_Position})  in vec3 a_Position;
layout(location = ${EnvironmentProgram.a_Color})     in vec4 a_Color;
layout(location = ${EnvironmentProgram.a_TexCoord0}) in vec3 a_TexCoord0;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
    v_Color     = a_Color;
    v_TexCoord  = a_TexCoord0.xy;
    v_PolyFlags = int(a_TexCoord0.z);
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    const int FLAG_RENDER  = 0x01;
    const int FLAG_TEXTURE = 0x02;

    if ((v_PolyFlags & FLAG_RENDER) == 0)
    {
        discard;
    }
    else if ((v_PolyFlags & FLAG_TEXTURE) != 0)
    {
        int texId = v_PolyFlags >> 4;
        vec2 texCoord = v_TexCoord / 256.;
        if (texId == 0) { t_Color = texture(SAMPLER_2D(u_Tex0), texCoord); }
        if (texId == 1) { t_Color = texture(SAMPLER_2D(u_Tex1), texCoord); }
        if (texId == 2) { t_Color = texture(SAMPLER_2D(u_Tex2), texCoord); }

        if (t_Color.a == 0.0)
            discard;
    }
    else
    {
        t_Color.rgb = v_Color.rgb;
    }

    gl_FragColor = t_Color;
}
#endif
`;
}

class EnvironmentGfxBuffers {
    private vertBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(
        device: GfxDevice,
        public verts: ArrayBufferSlice,
        public colors: ArrayBufferSlice,
        public uvs: ArrayBufferSlice,
        public indices: Uint16Array) {
        this.vertBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, verts);
        this.colorBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, colors);
        this.uvBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, uvs);

        const idxData = filterDegenerateTriangleIndexBuffer(indices);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: EnvironmentProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.S16_RGB },
            { location: EnvironmentProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
            { location: EnvironmentProgram.a_TexCoord0, bufferIndex: 2, bufferByteOffset: 0, format: GfxFormat.U8_RGB },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x06, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x03, frequency: GfxVertexBufferFrequency.PerVertex },
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: (GfxVertexBufferDescriptor | null)[] = [
            { buffer: this.vertBuffer, byteOffset: 0 },
            { buffer: this.colorBuffer, byteOffset: 0 },
            { buffer: this.uvBuffer, byteOffset: 0 },
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class EnvironmentData {
    public buffers: EnvironmentGfxBuffers;

    constructor(device: GfxDevice, lvl: AsterixLvl) {
        const numCells = 12 * lvl.lvlHeader.numStrips;
        const vertsPerCell = 4;
        const channelsPerVert = 3;
        const channelsPerUv = 3;
        const indicesPerCell = 6;

        let verts = new Int16Array(numCells * vertsPerCell * channelsPerVert);
        let colors = new Uint32Array(numCells * vertsPerCell);
        let uvs = new Uint8Array(numCells * vertsPerCell * channelsPerUv);
        let indices = new Uint16Array(numCells * indicesPerCell);
        let vertIdx = 0;
        let colIdx = 0;
        let uvIdx = 0;
        let idxIdx = 0;
        for (let strip = 0; strip < lvl.lvlHeader.numStrips; ++strip) {
            const s0 = strip;
            const s1 = strip + 1;
            for (let x = 0; x < 12; ++x) {
                const x0 = x;
                const x1 = x + 1;

                const materialAttr = lvl.materialAttrs[s0 * 12 + x0];
                const quadIdx = materialAttr.textureQuadIndex;
                const quad = lvl.textureQuads[quadIdx];

                const doRender = (quad.flags & 0x1) != 0;
                const isTextured = (quad.flags & 0x2) != 0;
                const isColored = !isTextured;

                if (doRender) {
                    const color = isColored
                        ? decodeBGR555(lvl.palette[quad.uvs[0].u])
                        : 0;

                    const currQuadVertBase = vertIdx / channelsPerVert;
                    indices[idxIdx++] = currQuadVertBase + 0;
                    indices[idxIdx++] = currQuadVertBase + 2;
                    indices[idxIdx++] = currQuadVertBase + 1;
                    indices[idxIdx++] = currQuadVertBase + 1;
                    indices[idxIdx++] = currQuadVertBase + 2;
                    indices[idxIdx++] = currQuadVertBase + 3;

                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x0].x;
                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x0].y;
                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x0].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[3].u;
                    uvs[uvIdx++] = quad.uvs[3].v;
                    uvs[uvIdx++] = quad.flags;

                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].x;
                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].y;
                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[2].u;
                    uvs[uvIdx++] = quad.uvs[2].v;
                    uvs[uvIdx++] = quad.flags;

                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].x;
                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].y;
                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[0].u;
                    uvs[uvIdx++] = quad.uvs[0].v;
                    uvs[uvIdx++] = quad.flags;

                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].x;
                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].y;
                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[1].u;
                    uvs[uvIdx++] = quad.uvs[1].v;
                    uvs[uvIdx++] = quad.flags;
                }
            }
        }

        this.buffers = new EnvironmentGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(colors.buffer),
            new ArrayBufferSlice(uvs.buffer),
            indices);
    }

    public destroy(device: GfxDevice): void {
        this.buffers.destroy(device);
    }
}

class EnvironmentInstance {
    private gfxProgram: GfxProgram | null = null;
    private program: EnvironmentProgram;
    private textureMapping = nArray(3, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor> = {};
    private sortKey: number = 0;

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, public environmentData: EnvironmentData) {
        this.program = new EnvironmentProgram();

        const gfxSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Point,
            minFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        const fillTextureReference = (dst: TextureMapping, textureId: string) => {
            if (textureHolder.hasTexture(textureId)) {
                textureHolder.fillTextureMapping(dst, textureId);
            } else {
                dst.gfxTexture = null;
            }
            dst.gfxSampler = gfxSampler;
        };

        fillTextureReference(this.textureMapping[0], 'tex0');
        fillTextureReference(this.textureMapping[1], 'tex1');
        fillTextureReference(this.textureMapping[2], 'tex2');

        this.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);

        this.megaState.frontFace = GfxFrontFaceMode.CW;
        this.megaState.cullMode = GfxCullMode.Back;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: ReadonlyMat4, viewerInput: Viewer.ViewerRenderInput) {
        const environmentBuffers = this.environmentData.buffers;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(environmentBuffers.inputLayout, environmentBuffers.inputState);
        renderInst.drawIndexes(environmentBuffers.indexCount);

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(this.megaState);

        renderInst.sortKey = this.sortKey;
        //scratchAABB.transform(meshFrag.bbox, modelMatrix);
        //const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, scratchAABB);
        //renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        let offs = renderInst.allocateUniformBuffer(EnvironmentProgram.ub_MeshFragParams, 20);
        const d = renderInst.mapUniformBufferF32(EnvironmentProgram.ub_MeshFragParams);
        mat4.mul(scratchMat4, viewerInput.camera.viewMatrix, modelMatrix);
        offs += fillMatrix4x3(d, offs, scratchMat4);

        //offs += fillVec4v(d, offs, meshFrag.materialColor);

        //const time = viewerInput.time / 4000;
        //const texCoordTransVel = meshFrag.texCoordTransVel;
        //const texCoordTransX = texCoordTransVel[0] * time;
        //const texCoordTransY = texCoordTransVel[1] * time;
        //offs += fillVec4(d, offs, texCoordTransX, texCoordTransY);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}


const scratchMat4 = mat4.create();
const scratchAABB = new AABB();

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

class TriModelsRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 3 },
    ];

    private triModelInstances: TriModelInstance[] = [];

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl) {
        for (let i = 0; i < lvl.objects.length; ++i) {
            const payload = lvl.objects[i].payload;
            if (payload !== null) {
                switch (payload.type) {
                    case AsterixObjectType.SolidModel: {
                        const objSolidModel = payload as AsterixObjSolidModel;
                        this.addModelInstance(cache, textureHolder, objSolidModel.model, lvl.palette);
                        break;
                    }
                    case AsterixObjectType.IntangibleModel: {
                        const objIntangibleModel = payload as AsterixObjIntangibleModel;
                        this.addModelInstance(cache, textureHolder, objIntangibleModel.model, lvl.palette);
                        break;
                    }
                    case AsterixObjectType.Trampoline: {
                        const objTrampoline = payload as AsterixObjTrampoline;
                        this.addModelInstance(cache, textureHolder, objTrampoline.model, lvl.palette);
                        break;
                    }
                    case AsterixObjectType.Elevator: {
                        const objElevator = payload as AsterixObjElevator;
                        this.addModelInstance(cache, textureHolder, objElevator.render_model, lvl.palette);
                        break;
                    }
                    case AsterixObjectType.Crate: {
                        const objCrate = payload as AsterixObjCrate;
                        this.addModelInstance(cache, textureHolder, objCrate.model, lvl.palette);
                        break;
                    }
                }
            }
        }
    }

    private addModelInstance(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, model: AsterixTriModel, palette: Uint16Array) {
        const triModelData = new TriModelData(cache.device, model, palette);
        const triModelInstance = new TriModelInstance(cache, textureHolder, triModelData);
        this.triModelInstances.push(triModelInstance);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(TriModelsRenderer.bindingLayouts);

        let offs = template.allocateUniformBuffer(TriModelProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(TriModelProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.triModelInstances.length; ++i) {
            this.triModelInstances[i].prepareToRender(device, renderInstManager, mat4.create(), viewerInput);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.triModelInstances.length; ++i) {
            this.triModelInstances[i].destroy(device);
        }
    }
}

class EnvironmentRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 3 },
    ];

    private environmentInstance: EnvironmentInstance;

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl) {
        const environmentData = new EnvironmentData(cache.device, lvl);
        this.environmentInstance = new EnvironmentInstance(cache, textureHolder, environmentData);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(EnvironmentRenderer.bindingLayouts);

        let offs = template.allocateUniformBuffer(EnvironmentProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(EnvironmentProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        this.environmentInstance.prepareToRender(device, renderInstManager, mat4.create(), viewerInput);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.environmentInstance.destroy(device);
    }
}

export class SceneRenderer {
    private environmentRenderer: EnvironmentRenderer;
    private triModelsRenderer: TriModelsRenderer;

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl) {
        this.environmentRenderer = new EnvironmentRenderer(cache, textureHolder, lvl);
        this.triModelsRenderer = new TriModelsRenderer(cache, textureHolder, lvl);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.environmentRenderer.prepareToRender(device, renderInstManager, viewerInput);
        this.triModelsRenderer.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.environmentRenderer.destroy(device);
        this.triModelsRenderer.destroy(device);
    }
}

export class AsterixRenderer {
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;

    public textureHolder = new AsterixTextureHolder();
    public sceneRenderers: SceneRenderer[] = [];

    private renderHelper: GfxRenderHelper;

    public cache: GfxRenderCache;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
        this.cache = this.renderHelper.renderCache;
    }

    public addSceneRenderer(sceneRenderer: SceneRenderer): void {
        this.sceneRenderers.push(sceneRenderer);
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.sceneRenderers.length; i++) {
            this.sceneRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        }
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.sceneRenderers.length; i++) {
            this.sceneRenderers[i].destroy(device);
        }
    }
}
