
import { AsterixLvl, AsterixObjectType, AsterixObjSolidModel, AsterixObjIntangibleModel, AsterixObjPushableBox, AsterixObjTrampoline, AsterixObjElevator, AsterixObjCrate, AsterixXZ, AsterixAlignedBounds, AsterixUnalignedBounds, AsterixObjEnemy0F, AsterixObjHintsNpc, AsterixObjLevelComplete } from "./lvl";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode, GfxStencilOp, GfxCompareMode, GfxChannelWriteMask, GfxBlendMode, GfxBlendFactor } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { AsterixTextureHolder, SORT_KEY_BOUNDS } from "./render";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";

class BoundsProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;

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

varying vec4 v_Color;

#ifdef VERT
layout(location = ${BoundsProgram.a_Position})  in vec3 a_Position;
layout(location = ${BoundsProgram.a_Color})     in vec4 a_Color;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
    v_Color     = a_Color;
}
#endif

#ifdef FRAG
void main() {
    gl_FragColor = v_Color;
}
#endif
`;
}

class BoundsGfxBuffers {
    private vertBuffer: GfxBuffer;
    private colorBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(
        device: GfxDevice,
        public verts: ArrayBufferSlice,
        public colors: ArrayBufferSlice,
        public indices: Uint16Array) {
        this.vertBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, verts);
        this.colorBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, colors);

        const idxData = filterDegenerateTriangleIndexBuffer(indices);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: BoundsProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.S16_RGB },
            { location: BoundsProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x06, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: (GfxVertexBufferDescriptor | null)[] = [
            { buffer: this.vertBuffer, byteOffset: 0 },
            { buffer: this.colorBuffer, byteOffset: 0 },
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class BoundsData {
    public buffers: BoundsGfxBuffers;

    constructor(device: GfxDevice, bounds: AsterixXZ[], color: number) {
        const numVerts = bounds.length * 2;
        const numIndices = bounds.length * 6 + (bounds.length - 2) * 3 * 2;
        const channelsPerVert = 3;

        let verts = new Int16Array(numVerts * channelsPerVert);
        let colors = new Uint32Array(numVerts);
        let indices = new Uint16Array(numIndices);

        let vertIdx = 0;
        let colIdx = 0;
        let idxIdx = 0;
        for (let i = 0; i < bounds.length; ++i) {
            verts[vertIdx++] = bounds[i].x;
            verts[vertIdx++] = -1000;
            verts[vertIdx++] = bounds[i].z;
            colors[colIdx++] = color;

            verts[vertIdx++] = bounds[i].x;
            verts[vertIdx++] = 1000;
            verts[vertIdx++] = bounds[i].z;
            colors[colIdx++] = color;
        }

        for (let i = 0; i < bounds.length; ++i) {
            const i0 = i*2;
            const i1 = ((i+1)*2) % numVerts;
            indices[idxIdx++] = i0;
            indices[idxIdx++] = i0+1;
            indices[idxIdx++] = i1;
            indices[idxIdx++] = i1;
            indices[idxIdx++] = i0+1;
            indices[idxIdx++] = i1+1;
        }

        for (let i = 2; i < bounds.length; ++i) {
            const i0 = 0;
            const i1 = (i-1) * 2
            const i2 = i * 2;
            indices[idxIdx++] = i0;
            indices[idxIdx++] = i1;
            indices[idxIdx++] = i2;

            indices[idxIdx++] = i0+1;
            indices[idxIdx++] = i2+1;
            indices[idxIdx++] = i1+1;
        }

        this.buffers = new BoundsGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(colors.buffer),
            indices);
    }
}

class BoundsInstance {
    private gfxProgram: GfxProgram | null = null;
    private program: BoundsProgram;
    private megaStates: Partial<GfxMegaStateDescriptor>[] = [{},{},{}];

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, public boundsData: BoundsData, public sortKey: number) {
        this.program = new BoundsProgram();

        const attachmentsStateNoColor = [
            {
                channelWriteMask: GfxChannelWriteMask.None,
                rgbBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.One,
                    blendDstFactor: GfxBlendFactor.OneMinusSrc,
                },
                alphaBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.OneMinusDst,
                    blendDstFactor: GfxBlendFactor.OneMinusSrc,
                },
            }
        ];

        const AttachmentsStateBlendAlpha = [
            {
                channelWriteMask: GfxChannelWriteMask.AllChannels,
                rgbBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.SrcAlpha,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
                alphaBlendState: {
                    blendMode: GfxBlendMode.Add,
                    blendSrcFactor: GfxBlendFactor.One,
                    blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
                },
            }
        ];

        this.megaStates = [{
            frontFace: GfxFrontFaceMode.CW,
            cullMode: GfxCullMode.Front,
            depthWrite: false,
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
            stencilWrite: true,
            stencilPassOp: GfxStencilOp.IncrementClamp,
            stencilCompare: GfxCompareMode.Always,
            attachmentsState: attachmentsStateNoColor,
        }, {
            frontFace: GfxFrontFaceMode.CW,
            cullMode: GfxCullMode.Back,
            depthWrite: false,
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.Less),
            stencilWrite: true,
            stencilPassOp: GfxStencilOp.DecrementClamp,
            stencilCompare: GfxCompareMode.Always,
            attachmentsState: attachmentsStateNoColor,
        }, {
            frontFace: GfxFrontFaceMode.CW,
            cullMode: GfxCullMode.Front,
            depthWrite: false,
            stencilWrite: true,
            stencilPassOp: GfxStencilOp.Zero,
            stencilCompare: GfxCompareMode.NotEqual,
            attachmentsState: AttachmentsStateBlendAlpha,
        }];
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        const boundsBuffers = this.boundsData.buffers;

        for (let i = 0; i < this.megaStates.length; ++i) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.setInputLayoutAndState(boundsBuffers.inputLayout, boundsBuffers.inputState);
            renderInst.drawIndexes(boundsBuffers.indexCount);

            if (this.gfxProgram === null)
                this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

            renderInst.setGfxProgram(this.gfxProgram);
            renderInst.setSamplerBindingsFromTextureMappings([]);
            renderInst.setMegaStateFlags(this.megaStates[i]);

            renderInst.sortKey = SORT_KEY_BOUNDS + (this.sortKey * this.megaStates.length) + i;

            let offs = renderInst.allocateUniformBuffer(BoundsProgram.ub_MeshFragParams, 12);
            const d = renderInst.mapUniformBufferF32(BoundsProgram.ub_MeshFragParams);

            // no model matrix so modelview is just view
            offs += fillMatrix4x3(d, offs, viewerInput.camera.viewMatrix);

            renderInstManager.submitRenderInst(renderInst);
        }
    }

    public destroy(device: GfxDevice): void {
    }
}

export class BoundsRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 0 },
    ];

    private boundsInstances: BoundsInstance[] = [];

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl) {
        for (let i = 0; i < lvl.objects.length; ++i) {
            const payload = lvl.objects[i].payload;
            if (payload !== null) {
                switch (payload.type) {
                    case AsterixObjectType.SolidModel: {
                        const objSolidModel = payload as AsterixObjSolidModel;
                        this.addAlignedBounds(cache, textureHolder, objSolidModel.broad_bounds);
                        break;
                    }
                    case AsterixObjectType.PushableBox: {
                        const objPushableBox = payload as AsterixObjPushableBox;
                        this.addAlignedBounds(cache, textureHolder, objPushableBox.xz_bounds_1);
                        this.addAlignedBounds(cache, textureHolder, objPushableBox.xz_bounds_2);
                        break;
                    }
                    case AsterixObjectType.Trampoline: {
                        const objTrampoline = payload as AsterixObjTrampoline;
                        this.addAlignedBounds(cache, textureHolder, objTrampoline.broad_bounds);
                        break;
                    }
                    case AsterixObjectType.Elevator: {
                        const objElevator = payload as AsterixObjElevator;
                        this.addAlignedBounds(cache, textureHolder, objElevator.broad_bounds);
                        break;
                    }
                    case AsterixObjectType.Enemy0F: {
                        const objEnemy0F = payload as AsterixObjEnemy0F;
                        this.addUnalignedBounds(cache, textureHolder, objEnemy0F.tight_bounds);
                        break;
                    }
                    case AsterixObjectType.Crate: {
                        const objCrate = payload as AsterixObjCrate;
                        this.addAlignedBounds(cache, textureHolder, objCrate.broad_bounds);
                        this.addUnalignedBounds(cache, textureHolder, objCrate.tight_bounds);
                        break;
                    }
                    case AsterixObjectType.HintsNpc: {
                        const objHintsNpc = payload as AsterixObjHintsNpc;
                        this.addUnalignedBounds(cache, textureHolder, objHintsNpc.probably_unaligned_bounds);
                        break;
                    }
                    case AsterixObjectType.LevelComplete: {
                        const objLevelComplete = payload as AsterixObjLevelComplete;
                        this.addUnalignedBounds(cache, textureHolder, objLevelComplete.probably_unaligned_bounds);
                        break;
                    }
                }
            }
        }
    }

    private addAlignedBounds(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, bounds: AsterixAlignedBounds) {
        //return; // hide big bounds for now
        let unpackedBounds:AsterixXZ[] = [
            { x: bounds.x_min, z: bounds.z_min },
            { x: bounds.x_max, z: bounds.z_min },
            { x: bounds.x_max, z: bounds.z_max },
            { x: bounds.x_min, z: bounds.z_max },
        ];
        const sortKey = this.boundsInstances.length;
        const boundsData = new BoundsData(cache.device, unpackedBounds, 0x7fff0000);
        const boundsInstance = new BoundsInstance(cache, textureHolder, boundsData, sortKey);
        this.boundsInstances.push(boundsInstance);
    }

    private addUnalignedBounds(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, bounds: AsterixUnalignedBounds) {
        const sortKey = this.boundsInstances.length;
        const boundsData = new BoundsData(cache.device, bounds.bounds, 0x7f0000ff);
        const boundsInstance = new BoundsInstance(cache, textureHolder, boundsData, sortKey);
        this.boundsInstances.push(boundsInstance);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(BoundsRenderer.bindingLayouts);

        let offs = template.allocateUniformBuffer(BoundsProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(BoundsProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.boundsInstances.length; ++i) {
            this.boundsInstances[i].prepareToRender(device, renderInstManager, viewerInput);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.boundsInstances.length; ++i) {
            this.boundsInstances[i].destroy(device);
        }
    }
}
