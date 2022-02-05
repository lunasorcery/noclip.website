
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import * as DromeData from "./data";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxFrontFaceMode, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { surfaceToCanvas } from "../Common/bc_texture";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { decodeBGR555, decodeTextureData } from "./gba_common";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { nArray } from "../gfx/platform/GfxPlatformUtil";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { DeviceProgram } from "../Program";
import { mat4, vec3 } from "gl-matrix";
import { AABB } from "../Geometry";
import { computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";

export interface DromeTexture {
    name: string;
    width: number;
    height: number;
    indices: ArrayBufferSlice;
    palette: Uint16Array;
}

export class DromeTextureHolder extends TextureHolder<DromeTexture> {
    private textures: DromeTexture[] = [];

    public loadTexture(device: GfxDevice, texture: DromeTexture): LoadedTexture | null {
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


class ModelProgram extends DeviceProgram {
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

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;

#ifdef VERT
layout(location = ${ModelProgram.a_Position})  in vec3 a_Position;
layout(location = ${ModelProgram.a_Color})     in vec4 a_Color;
layout(location = ${ModelProgram.a_TexCoord0}) in vec2 a_TexCoord0;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
    v_Color     = a_Color;
    v_TexCoord  = a_TexCoord0;
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

#ifdef USE_TEXTURE
    t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
    if (t_Color.a == 0.0)
        discard;
#endif

#ifdef USE_COLOR
    t_Color.rgb *= v_Color.rgb;
#endif

    gl_FragColor = t_Color;
}
#endif
`;
}

class ModelGfxBuffers {
    private vertBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer | null;
    private uvBuffer: GfxBuffer | null;
    private idxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(
        device: GfxDevice,
        public verts: ArrayBufferSlice,
        public colors: ArrayBufferSlice | null,
        public uvs: ArrayBufferSlice | null,
        public indices: Uint16Array) {
        this.vertBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, verts);
        this.colorBuffer = colors ? makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, colors) : null;
        this.uvBuffer = uvs ? makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, uvs) : null;

        const idxData = filterDegenerateTriangleIndexBuffer(indices);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: ModelProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.S16_RGB },
            { location: ModelProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
            { location: ModelProgram.a_TexCoord0, bufferIndex: 2, bufferByteOffset: 0, format: GfxFormat.U16_RG_NORM },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x06, frequency: GfxVertexBufferFrequency.PerVertex },
            this.colorBuffer ? { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex } : null,
            this.uvBuffer ? { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex } : null,
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: (GfxVertexBufferDescriptor | null)[] = [
            { buffer: this.vertBuffer, byteOffset: 0 },
            this.colorBuffer ? { buffer: this.colorBuffer, byteOffset: 0 } : null,
            this.uvBuffer ? { buffer: this.uvBuffer, byteOffset: 0 } : null,
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertBuffer);
        if (this.colorBuffer !== null)
            device.destroyBuffer(this.colorBuffer);
        if (this.uvBuffer !== null)
            device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class ModelData {
    public bbox: AABB;
    public buffersType1: ModelGfxBuffers | null = null;
    public buffersType2: ModelGfxBuffers | null = null;
    public buffersType5: ModelGfxBuffers | null = null;

    constructor(device: GfxDevice, model: DromeData.Model, palette: Uint16Array) {
        this.bbox = new AABB(model.min_x, model.min_y, model.min_z, model.max_x, model.max_y, model.max_z);

        let numPolysType1 = 0;
        let numPolysType2 = 0;
        let numPolysType5 = 0;
        for (let i = 0; i < model.polys.length; ++i) {
            switch (model.polys[i].type) {
                case DromeData.PolyType.Poly1: { numPolysType1++; break; }
                case DromeData.PolyType.Poly2: { numPolysType2++; break; }
                case DromeData.PolyType.Poly5: { numPolysType5++; break; }
            }
        }

        if (numPolysType1 > 0) {
            const channelsPerVert = 3;
            const vertsPerPoly = 3;
            const indicesPerPoly = 3;
            let verts = new Int16Array(numPolysType1 * vertsPerPoly * channelsPerVert);
            let colors = new Uint32Array(numPolysType1 * vertsPerPoly);
            let indices = new Uint16Array(numPolysType1 * indicesPerPoly);
            let vertIdx = 0;
            let colorIdx = 0;
            let idxIdx = 0;
            for (let i = 0; i < model.polys.length; ++i) {
                const poly = model.polys[i];
                if (poly.type == DromeData.PolyType.Poly1) {
                    const poly1 = poly as DromeData.Poly1;
                    const i0 = poly1.i0;
                    const i1 = poly1.i1;
                    const i2 = poly1.i2;
                    const color = poly1.color;

                    const v0 = model.verts[i0];
                    const v1 = model.verts[i1];
                    const v2 = model.verts[i2];
                    const colorRGB = decodeBGR555(palette[color]);

                    const baseVert = vertIdx / channelsPerVert;
                    indices[idxIdx++] = baseVert + 0;
                    indices[idxIdx++] = baseVert + 1;
                    indices[idxIdx++] = baseVert + 2;

                    verts[vertIdx++] = v0.x;
                    verts[vertIdx++] = v0.y;
                    verts[vertIdx++] = v0.z;
                    colors[colorIdx++] = colorRGB;

                    verts[vertIdx++] = v1.x;
                    verts[vertIdx++] = v1.y;
                    verts[vertIdx++] = v1.z;
                    colors[colorIdx++] = colorRGB;

                    verts[vertIdx++] = v2.x;
                    verts[vertIdx++] = v2.y;
                    verts[vertIdx++] = v2.z;
                    colors[colorIdx++] = colorRGB;
                }
            }

            this.buffersType1 = new ModelGfxBuffers(
                device,
                new ArrayBufferSlice(verts.buffer),
                new ArrayBufferSlice(colors.buffer),
                null,
                indices);
        }

        if (numPolysType2 > 0) {
            const channelsPerVert = 3;
            const vertsPerPoly = 3;
            const indicesPerPoly = 3;
            let verts = new Int16Array(numPolysType2 * vertsPerPoly * channelsPerVert);
            let colors = new Uint32Array(numPolysType2 * vertsPerPoly);
            let indices = new Uint16Array(numPolysType2 * indicesPerPoly);
            let vertIdx = 0;
            let colorIdx = 0;
            let idxIdx = 0;
            for (let i = 0; i < model.polys.length; ++i) {
                const poly = model.polys[i];
                if (poly.type == DromeData.PolyType.Poly2) {
                    const poly2 = poly as DromeData.Poly2;
                    const i0 = poly2.i0;
                    const i1 = poly2.i1;
                    const i2 = poly2.i2;
                    const color = poly2.color;

                    const v0 = model.verts[i0];
                    const v1 = model.verts[i1];
                    const v2 = model.verts[i2];
                    const colorRGB = decodeBGR555(palette[color]);

                    const baseVert = vertIdx / channelsPerVert;
                    indices[idxIdx++] = baseVert + 0;
                    indices[idxIdx++] = baseVert + 1;
                    indices[idxIdx++] = baseVert + 2;

                    verts[vertIdx++] = v0.x;
                    verts[vertIdx++] = v0.y;
                    verts[vertIdx++] = v0.z;
                    colors[colorIdx++] = colorRGB;

                    verts[vertIdx++] = v1.x;
                    verts[vertIdx++] = v1.y;
                    verts[vertIdx++] = v1.z;
                    colors[colorIdx++] = colorRGB;

                    verts[vertIdx++] = v2.x;
                    verts[vertIdx++] = v2.y;
                    verts[vertIdx++] = v2.z;
                    colors[colorIdx++] = colorRGB;
                }
            }

            this.buffersType2 = new ModelGfxBuffers(
                device,
                new ArrayBufferSlice(verts.buffer),
                new ArrayBufferSlice(colors.buffer),
                null,
                indices);
        }

        if (numPolysType5 > 0) {
            const channelsPerVert = 3;
            const vertsPerPoly = 3;
            const indicesPerPoly = 3;
            const channelsPerUv = 2;
            let verts = new Int16Array(numPolysType5 * vertsPerPoly * channelsPerVert);
            let uvs = new Uint16Array(numPolysType5 * vertsPerPoly * channelsPerUv);
            let indices = new Uint16Array(numPolysType5 * indicesPerPoly);
            let vertIdx = 0;
            let uvIdx = 0;
            let idxIdx = 0;
            for (let i = 0; i < model.polys.length; ++i) {
                const poly = model.polys[i];
                if (poly.type == DromeData.PolyType.Poly5) {
                    const poly5 = poly as DromeData.Poly5;

                    const v0 = model.verts[poly5.i0];
                    const v1 = model.verts[poly5.i1];
                    const v2 = model.verts[poly5.i2];

                    const baseVert = vertIdx / channelsPerVert;
                    indices[idxIdx++] = baseVert + 0;
                    indices[idxIdx++] = baseVert + 1;
                    indices[idxIdx++] = baseVert + 2;

                    verts[vertIdx++] = v0.x;
                    verts[vertIdx++] = v0.y;
                    verts[vertIdx++] = v0.z;
                    uvs[uvIdx++] = poly5.u0;
                    uvs[uvIdx++] = poly5.v0;

                    verts[vertIdx++] = v1.x;
                    verts[vertIdx++] = v1.y;
                    verts[vertIdx++] = v1.z;
                    uvs[uvIdx++] = poly5.u1;
                    uvs[uvIdx++] = poly5.v1;

                    verts[vertIdx++] = v2.x;
                    verts[vertIdx++] = v2.y;
                    verts[vertIdx++] = v2.z;
                    uvs[uvIdx++] = poly5.u2;
                    uvs[uvIdx++] = poly5.v2;
                }
            }

            this.buffersType5 = new ModelGfxBuffers(
                device,
                new ArrayBufferSlice(verts.buffer),
                null,
                new ArrayBufferSlice(uvs.buffer),
                indices);
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.buffersType1 !== null)
            this.buffersType1.destroy(device);
        if (this.buffersType2 !== null)
            this.buffersType2.destroy(device);
        if (this.buffersType5 !== null)
            this.buffersType5.destroy(device);
    }
}

let scratchMat4 = mat4.create();

class ModelInstance {
    public modelMatrix: mat4 = mat4.create();

    constructor(public modelData: ModelData, position: vec3) {
        mat4.fromTranslation(this.modelMatrix, position);
        mat4.scale(this.modelMatrix, this.modelMatrix, vec3.fromValues(1, -1, -1));
    }
}


export class SceneRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 1 },
    ];

    private gfxProgramColored: GfxProgram | null = null;
    private gfxProgramTextured: GfxProgram | null = null;
    private programColored: ModelProgram;
    private programTextured: ModelProgram;
    private megaStateOneSided: Partial<GfxMegaStateDescriptor> = {};
    private megaStateBothSides: Partial<GfxMegaStateDescriptor> = {};
    private textureMapping = nArray(1, () => new TextureMapping());

    private modelDatas: ModelData[] = [];
    private modelInstances: ModelInstance[] = [];

    private scratchAABB: AABB = new AABB();

    constructor(cache: GfxRenderCache, textureHolder: DromeTextureHolder, zone: DromeData.Zone, track_id: number) {
        this.loadModelInstances(cache, textureHolder, zone, track_id);
        this.setupGraphicsState(cache, textureHolder);
    }

    private loadModelInstances(cache: GfxRenderCache, textureHolder: DromeTextureHolder, zone: DromeData.Zone, track_id: number) {
        // load models
        for (let i = 0; i < zone.models.length; ++i) {
            this.modelDatas.push(new ModelData(cache.device, zone.models[i], zone.palette));
        }

        // load track layout
        const track = zone.tracks[track_id];
        for (let z = 0; z < track.height; ++z) {
            for (let x = 0; x < track.width; ++x) {
                const model_id = track.layout[z * track.width + x];
                if (model_id >= 0) {
                    const modelPos = vec3.fromValues(
                        (x - ((track.width-1) / 2)) * track.spacing_x,
                        -128,
                        (z - ((track.height-1) / 2)) * track.spacing_z);
                    const modelInst = new ModelInstance(this.modelDatas[model_id], modelPos);
                    this.modelInstances.push(modelInst);
                }
            }
        }
    }

    private setupGraphicsState(cache: GfxRenderCache, textureHolder: DromeTextureHolder) {
        this.programColored = new ModelProgram();
        this.programTextured = new ModelProgram();

        this.programColored.setDefineBool("USE_COLOR", true);
        this.programTextured.setDefineBool("USE_TEXTURE", true);

        this.megaStateOneSided.frontFace = GfxFrontFaceMode.CCW;
        this.megaStateOneSided.cullMode = GfxCullMode.Back;

        this.megaStateBothSides.frontFace = GfxFrontFaceMode.CCW;
        this.megaStateBothSides.cullMode = GfxCullMode.None;

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

        fillTextureReference(this.textureMapping[0], 'tex');
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.gfxProgramColored === null)
            this.gfxProgramColored = renderInstManager.gfxRenderCache.createProgram(this.programColored);
        if (this.gfxProgramTextured === null)
            this.gfxProgramTextured = renderInstManager.gfxRenderCache.createProgram(this.programTextured);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(SceneRenderer.bindingLayouts);

        let offs = template.allocateUniformBuffer(ModelProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(ModelProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.modelInstances.length; ++i) {
            const bbox = this.modelInstances[i].modelData.bbox;
            const modelMatrix = this.modelInstances[i].modelMatrix;
            const buffersType1 = this.modelInstances[i].modelData.buffersType1;
            const buffersType2 = this.modelInstances[i].modelData.buffersType2;
            const buffersType5 = this.modelInstances[i].modelData.buffersType5;
            if (buffersType1 !== null)
                this.drawMesh(renderInstManager, viewerInput, bbox, modelMatrix, buffersType1, this.gfxProgramColored, this.megaStateOneSided);
            if (buffersType2 !== null)
                this.drawMesh(renderInstManager, viewerInput, bbox, modelMatrix, buffersType2, this.gfxProgramColored, this.megaStateBothSides);
            if (buffersType5 !== null)
                this.drawMesh(renderInstManager, viewerInput, bbox, modelMatrix, buffersType5, this.gfxProgramTextured, this.megaStateOneSided);
        }

        renderInstManager.popTemplateRenderInst();
    }

    private drawMesh(
        renderInstManager: GfxRenderInstManager,
        viewerInput: Viewer.ViewerRenderInput,
        bbox: AABB,
        modelMatrix: mat4,
        gfxBuffers: ModelGfxBuffers,
        gfxProgram: GfxProgram,
        megaState: Partial<GfxMegaStateDescriptor>,
    ) {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(gfxBuffers.inputLayout, gfxBuffers.inputState);
        renderInst.drawIndexes(gfxBuffers.indexCount);

        renderInst.setGfxProgram(gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(megaState);

        renderInst.sortKey = makeSortKey(GfxRendererLayer.OPAQUE, gfxProgram.ResourceUniqueId);
        this.scratchAABB.transform(bbox, modelMatrix);
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera.viewMatrix, this.scratchAABB);
        renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);

        let offs = renderInst.allocateUniformBuffer(ModelProgram.ub_MeshFragParams, 12);
        const d = renderInst.mapUniformBufferF32(ModelProgram.ub_MeshFragParams);

        mat4.mul(scratchMat4, viewerInput.camera.viewMatrix, modelMatrix);
        offs += fillMatrix4x3(d, offs, scratchMat4);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.modelDatas.length; ++i)
            this.modelDatas[i].destroy(device);
    }
}

export class DromeRenderer {
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;

    public textureHolder = new DromeTextureHolder();
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
