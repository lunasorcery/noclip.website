
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { AsterixLvl } from "./lvl";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBufferFrequencyHint, GfxBindingLayoutDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxTextureDimension, GfxRenderPass, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { DecodedSurfaceSW, surfaceToCanvas } from "../Common/bc_texture";
import { EMeshFrag, EMesh, MaterialFlags } from "./plb";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { convertToTriangleIndexBuffer, filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
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
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxTopology } from "../gfx/helpers/TopologyHelpers";

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
    assert(indices.length == width * height);
    let decodedPixels = new Uint8Array(width * height * 4);
    let srcIdx = 0;
    let dstIdx = 0;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            let colorIdx = indices[srcIdx++];
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

class AsterixProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord0 = 2;
    public static a_TexCoord1 = 3;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    public both = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_MeshFragParams {
    Mat4x3 u_BoneMatrix[1];
    vec4 u_MaterialColor;
    vec4 u_TexCoordOffs;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = ${AsterixProgram.a_Position}) in vec3 a_Position;
layout(location = ${AsterixProgram.a_Color}) in vec4 a_Color;
layout(location = ${AsterixProgram.a_TexCoord0}) in vec2 a_TexCoord0;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Color = a_Color;
    v_TexCoord = a_TexCoord0 + u_TexCoordOffs.xy;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE
    t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
    if (t_Color.a <= 0.5) {
        discard;
    }
#endif

#ifdef USE_VERTEX_COLOR
    t_Color.rgb *= v_Color.rgb;
#endif

    gl_FragColor = t_Color;
}
#endif
`;
}

class MeshFragData {
    private posNrmBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer | null;
    private uvBuffer: GfxBuffer | null;
    private idxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(device: GfxDevice, public meshFrag: EMeshFrag) {
        this.posNrmBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, meshFrag.streamPosNrm);
        this.colorBuffer = meshFrag.streamColor ? makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, meshFrag.streamColor) : null;
        this.uvBuffer = meshFrag.streamUV ? makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, meshFrag.streamUV) : null;

        const numIndexes = meshFrag.streamIdx.byteLength / 2;
        const triIdxData = convertToTriangleIndexBuffer(meshFrag.topology, meshFrag.streamIdx.createTypedArray(Uint16Array, 0, numIndexes));
        const idxData = filterDegenerateTriangleIndexBuffer(triIdxData);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: AsterixProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
            { location: AsterixProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
            { location: AsterixProgram.a_TexCoord0, bufferIndex: 2, bufferByteOffset: 0x00, format: GfxFormat.F32_RG },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x0C, frequency: GfxVertexBufferFrequency.PerVertex, },
            this.colorBuffer ? { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex } : null,
            this.uvBuffer ? { byteStride: 0x08, frequency: GfxVertexBufferFrequency.PerVertex } : null,
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: (GfxVertexBufferDescriptor | null)[] = [
            { buffer: this.posNrmBuffer, byteOffset: 0 },
            this.colorBuffer ? { buffer: this.colorBuffer, byteOffset: 0, } : null,
            this.uvBuffer ? { buffer: this.uvBuffer, byteOffset: 0, } : null,
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posNrmBuffer);
        if (this.colorBuffer !== null)
            device.destroyBuffer(this.colorBuffer);
        if (this.uvBuffer !== null)
            device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class MeshData {
    public meshFragData: MeshFragData[] = [];

    constructor(device: GfxDevice, public mesh: EMesh) {
        for (let i = 0; i < this.mesh.meshFrag.length; i++) {
            this.meshFragData[i] = new MeshFragData(device, this.mesh.meshFrag[i]);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshFragData.length; i++) {
            this.meshFragData[i].destroy(device);
        }
    }
}

class MapData {
    public meshData: MeshData[] = [];

    constructor(device: GfxDevice, public lvl: AsterixLvl) {
        //for (let i = 0; i < lvl.meshes.length; i++) {
        //    this.meshData[i] = new MeshData(device, domain.meshes[i]);
        //}

        const numCells = 12 * lvl.lvlHeader.numStrips;
        const vertsPerCell = 4;
        const floatsPerVert = 3;
        const floatsPerUv = 2;
        const indicesPerCell = 6;

        let vertices = new Float32Array(numCells * vertsPerCell * floatsPerVert);
        let colors = new Uint32Array(numCells * vertsPerCell);
        let uvs = new Float32Array(numCells * vertsPerCell * floatsPerUv);
        let indicesColored = new Uint16Array(numCells * indicesPerCell);
        let indicesTextured = new Uint16Array(numCells * indicesPerCell);
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
                const texId = quad.flags >> 4;

                if (doRender) {
                    const color = isColored
                        ? decodeBGR555(lvl.palette[quad.uvs[0].u])
                        : 0xffbfbfbf;

                    const currQuadVertBase = vertIdx / floatsPerVert;
                    let indices = isColored ? indicesColored : indicesTextured;
                    indices[idxIdx++] = currQuadVertBase + 0;
                    indices[idxIdx++] = currQuadVertBase + 2;
                    indices[idxIdx++] = currQuadVertBase + 1;
                    indices[idxIdx++] = currQuadVertBase + 1;
                    indices[idxIdx++] = currQuadVertBase + 2;
                    indices[idxIdx++] = currQuadVertBase + 3;

                    vertices[vertIdx++] = lvl.vertexTable[s0 * 13 + x0].x;
                    vertices[vertIdx++] = lvl.vertexTable[s0 * 13 + x0].y;
                    vertices[vertIdx++] = lvl.vertexTable[s0 * 13 + x0].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[3].u / 256.0;
                    uvs[uvIdx++] = (quad.uvs[3].v + (texId*256.0)) / 656.0;

                    vertices[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].x;
                    vertices[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].y;
                    vertices[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[2].u / 256.0;
                    uvs[uvIdx++] = (quad.uvs[2].v + (texId*256.0)) / 656.0;

                    vertices[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].x;
                    vertices[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].y;
                    vertices[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[0].u / 256.0;
                    uvs[uvIdx++] = (quad.uvs[0].v + (texId*256.0)) / 656.0;

                    vertices[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].x;
                    vertices[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].y;
                    vertices[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[1].u / 256.0;
                    uvs[uvIdx++] = (quad.uvs[1].v + (texId*256.0)) / 656.0;
                }
            }
        }

        let dummy: EMesh = {
            name: 'test',
            translation: vec3.fromValues(0, 0, 0),
            rotation: vec3.fromValues(0, 0, 0),
            scale: vec3.fromValues(0, 0, 0),
            bbox: new AABB(),
            modelTriggerOBB: [],
            skeleton: [],
            meshFrag: [{
                materialFlags: 0,
                bbox: new AABB(),
                materialColor: vec4.fromValues(0, 0, 0, 1),
                textureIds: [],
                textureLightmap: null,
                textureDetail: null,
                texCoordTransVel: vec2.fromValues(0, 0),
                streamPosNrm: new ArrayBufferSlice(vertices.buffer),
                streamColor: new ArrayBufferSlice(colors.buffer),
                streamUVCount: 0,
                uvCoordScale: 1,
                streamUV: null,
                streamIdx: new ArrayBufferSlice(indicesColored.buffer),
                topology: GfxTopology.TRIANGLES,
                iVertCount: vertices.length/4,
                iPolyCount: indicesColored.length/3,
            },{
                materialFlags: 0,
                bbox: new AABB(),
                materialColor: vec4.fromValues(0, 0, 0, 1),
                textureIds: [0],
                textureLightmap: null,
                textureDetail: null,
                texCoordTransVel: vec2.fromValues(0, 0),
                streamPosNrm: new ArrayBufferSlice(vertices.buffer),
                streamColor: null,
                streamUVCount: 0,
                uvCoordScale: 1,
                streamUV: new ArrayBufferSlice(uvs.buffer),
                streamIdx: new ArrayBufferSlice(indicesTextured.buffer),
                topology: GfxTopology.TRIANGLES,
                iVertCount: vertices.length/4,
                iPolyCount: indicesTextured.length/3,
            }],
            submesh: []
        }
        this.meshData[0] = new MeshData(device, dummy);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshData.length; i++) {
            this.meshData[i].destroy(device);
        }
    }
}

const scratchMat4 = mat4.create();
const scratchAABB = new AABB();
class MeshFragInstance {
    private gfxProgram: GfxProgram | null = null;
    private program: AsterixProgram;
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor> = {};
    private sortKey: number = 0;
    private visible = true;

    constructor(cache: GfxRenderCache, lvl: AsterixLvl, textureHolder: AsterixTextureHolder, public meshFragData: MeshFragData) {
        this.program = new AsterixProgram();

        const meshFrag = this.meshFragData.meshFrag;

        const gfxSampler = cache.createSampler({
            magFilter: GfxTexFilterMode.Point,
            minFilter: GfxTexFilterMode.Point,
            mipFilter: GfxMipFilterMode.NoMip,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });

        const fillTextureReference = (dst: TextureMapping, textureId: number) => {
            if (textureHolder.hasTexture('tex')) {
                textureHolder.fillTextureMapping(dst, 'tex');
            } else {
                dst.gfxTexture = null
            }
            dst.gfxSampler = gfxSampler;
        };

        if (meshFrag.textureIds.length >= 1) {
            this.program.setDefineBool('USE_TEXTURE', true);
            fillTextureReference(this.textureMapping[0], meshFrag.textureIds[0]);
        }

        let useAlphaTest: boolean;
        if (!!(meshFrag.materialFlags & MaterialFlags.AdditiveBlended)) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            setAttachmentStateSimple(this.megaState, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.One,
                blendDstFactor: GfxBlendFactor.One,
            });
            useAlphaTest = false;
        } else if (!!(meshFrag.materialFlags & MaterialFlags.Alpha)) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            setAttachmentStateSimple(this.megaState, {
                blendMode: GfxBlendMode.Add,
                blendSrcFactor: GfxBlendFactor.SrcAlpha,
                blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
            });
            useAlphaTest = false;
        } else {
            this.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
            useAlphaTest = true;
        }

        if (!!(meshFrag.materialFlags & MaterialFlags.Decal))
            this.megaState.polygonOffset = true;

        this.megaState.frontFace = GfxFrontFaceMode.CW;
        if (!!(meshFrag.materialFlags & MaterialFlags.DoubleSided))
            this.megaState.cullMode = GfxCullMode.None;
        else
            this.megaState.cullMode = GfxCullMode.Back;

        if (meshFrag.streamColor !== null)
            this.program.setDefineBool('USE_VERTEX_COLOR', true);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: ReadonlyMat4, viewerInput: Viewer.ViewerRenderInput) {
        if (!this.visible)
            return;

        const meshFrag = this.meshFragData.meshFrag;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.meshFragData.inputLayout, this.meshFragData.inputState);
        renderInst.drawIndexes(this.meshFragData.indexCount);

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(this.megaState);

        renderInst.sortKey = this.sortKey;
        scratchAABB.transform(meshFrag.bbox, modelMatrix);
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, scratchAABB);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        let offs = renderInst.allocateUniformBuffer(AsterixProgram.ub_MeshFragParams, 20);
        const d = renderInst.mapUniformBufferF32(AsterixProgram.ub_MeshFragParams);
        mat4.mul(scratchMat4, viewerInput.camera.viewMatrix, modelMatrix);
        offs += fillMatrix4x3(d, offs, scratchMat4);

        offs += fillVec4v(d, offs, meshFrag.materialColor);

        const time = viewerInput.time / 4000;
        const texCoordTransVel = meshFrag.texCoordTransVel;
        const texCoordTransX = texCoordTransVel[0] * time;
        const texCoordTransY = texCoordTransVel[1] * time;
        offs += fillVec4(d, offs, texCoordTransX, texCoordTransY);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}

class MeshInstance {
    private meshFragInstance: MeshFragInstance[] = [];
    public modelMatrix = mat4.create();
    private visible = true;

    constructor(cache: GfxRenderCache, lvl: AsterixLvl, textureHolder: AsterixTextureHolder, public meshData: MeshData) {
        for (let i = 0; i < this.meshData.meshFragData.length; i++) {
            this.meshFragInstance[i] = new MeshFragInstance(cache, lvl, textureHolder, this.meshData.meshFragData[i])
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.meshFragInstance.length; i++) {
            this.meshFragInstance[i].prepareToRender(device, renderInstManager, this.modelMatrix, viewerInput);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshFragInstance.length; i++) {
            this.meshFragInstance[i].destroy(device);
        }
    }
}

class MapInstance {
    public meshInstance: MeshInstance[] = [];
    private visible = true;

    constructor(cache: GfxRenderCache, lvl: AsterixLvl, textureHolder: AsterixTextureHolder, public mapData: MapData) {
        for (let i = 0; i < this.mapData.meshData.length; i++) {
            this.meshInstance[i] = new MeshInstance(cache, lvl, textureHolder, this.mapData.meshData[i]);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.meshInstance.length; i++) {
            this.meshInstance[i].prepareToRender(device, renderInstManager, viewerInput);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.meshInstance.length; i++) {
            this.meshInstance[i].destroy(device);
        }
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];
export class SceneRenderer {
    private mapData: MapData;
    private mapInstance: MapInstance;

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl) {
        this.mapData = new MapData(cache.device, lvl);
        this.mapInstance = new MapInstance(cache, lvl, textureHolder, this.mapData);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(AsterixProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(AsterixProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        this.mapInstance.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.mapInstance.destroy(device);
        this.mapData.destroy(device);
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
