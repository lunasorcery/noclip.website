
import { TextureMapping } from "../TextureHolder";
import { AsterixLvl, AsterixCommonBillboard, AsterixObjectType, AsterixObjStaticBillboard, AsterixObjPushableBox } from "./lvl";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4, fillVec3v, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { nArray } from "../util";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { AsterixTextureHolder, SORT_KEY_PROPS } from "./render";


class DebugProgram extends DeviceProgram {
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

uniform sampler2D u_Tex;

varying vec3 v_Color;

#ifdef VERT
layout(location = ${DebugProgram.a_Position}) in vec3 a_Position;
layout(location = ${DebugProgram.a_Color})    in vec4 a_Color;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
    v_Color = a_Color.rgb;
}
#endif

#ifdef FRAG
void main() {
    gl_FragColor = vec4(v_Color, 1);
}
#endif
`;
}

class DebugGfxBuffers {
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
            { location: DebugProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
            { location: DebugProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x0C, frequency: GfxVertexBufferFrequency.PerVertex },
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

class DebugInstance {
    private gfxProgram: GfxProgram | null = null;
    private program: DebugProgram;
    private megaState: Partial<GfxMegaStateDescriptor> = {};
    private modelMatrix: mat4 = mat4.create();

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, position: vec3) {
        mat4.fromTranslation(this.modelMatrix, position);

        this.program = new DebugProgram();

        this.megaState.cullMode = GfxCullMode.None;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, gfxBuffers: DebugGfxBuffers) {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(gfxBuffers.inputLayout, gfxBuffers.inputState);
        renderInst.drawIndexes(gfxBuffers.indexCount);

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings([]);
        renderInst.setMegaStateFlags(this.megaState);

        renderInst.sortKey = SORT_KEY_PROPS;

        let offs = renderInst.allocateUniformBuffer(DebugProgram.ub_MeshFragParams, 20);
        const d = renderInst.mapUniformBufferF32(DebugProgram.ub_MeshFragParams);

        let matModelView = mat4.create();
        mat4.mul(matModelView, viewerInput.camera.viewMatrix, this.modelMatrix);
        offs += fillMatrix4x3(d, offs, matModelView);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}

export class DebugRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 0 },
    ];

    public gfxBuffers: DebugGfxBuffers;
    private debugInstances: DebugInstance[] = [];

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl) {
        this.buildGfxBuffers(cache.device);

        for (let i = 0; i < lvl.objects.length; ++i) {
            const posVertex = lvl.objects[i].preamble_pos;
            const posVec = vec3.fromValues(posVertex.x, posVertex.y, posVertex.z);
            const payload = lvl.objects[i].payload;
            if (payload !== null) {
                switch (payload.type) {
                    case AsterixObjectType.SolidModel: break;
                    case AsterixObjectType.IntangibleModel: break;
                    case AsterixObjectType.StaticBillboard: break;
                    case AsterixObjectType.PushableBox: break;
                    case AsterixObjectType.Trampoline: break;
                    case AsterixObjectType.Elevator: break;
                    case AsterixObjectType.Crate: break;
                    default: {
                        this.addDebugModel(cache, textureHolder, posVec);
                    }
                }
            } else {
                this.addDebugModel(cache, textureHolder, posVec);
            }
        }
    }

    private addDebugModel(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, pos: vec3) {
        this.debugInstances.push(new DebugInstance(cache, textureHolder, pos));
    }

    private buildGfxBuffers(device: GfxDevice) {
        let verts = new Float32Array(3*8*2);
        let colors = new Uint32Array(8*2);
        
        let vertIdx = 0;
        let colorIdx = 0;
        for (let i = 0; i < 2; ++i) {
            const dist = (i==0) ? 20 : 16;
            for (let j=0;j<8;++j) {
                const x = ((j&1)==0) ? -dist : dist;
                const y = ((j&2)==0) ? -dist : dist;
                const z = ((j&4)==0) ? -dist : dist;
                verts[vertIdx++] = x;
                verts[vertIdx++] = y;
                verts[vertIdx++] = z;

                const color = (i==0) ? 0xff0000ff : 0xff000077;
                colors[colorIdx++] = color;
            }
        }

        let indices = new Uint16Array(6*12);
        let idxIdx = 0;
        for (let i = 0; i < 8; ++i) { // for each corner of the cube
            if ((i&1) == 0) { // if its x component is low, connect it to the high-x neighbor
                indices[idxIdx++] = i;
                indices[idxIdx++] = i|8;
                indices[idxIdx++] = i|1;
                indices[idxIdx++] = i|1;
                indices[idxIdx++] = i|8;
                indices[idxIdx++] = i|1|8;
            }
            if ((i&2) == 0) { // if its y component is low, connect it to the high-y neighbor
                indices[idxIdx++] = i;
                indices[idxIdx++] = i|8;
                indices[idxIdx++] = i|2;
                indices[idxIdx++] = i|2;
                indices[idxIdx++] = i|8;
                indices[idxIdx++] = i|2|8;
            }
            if ((i&4) == 0) { // if its z component is low, connect it to the high-z neighbor
                indices[idxIdx++] = i;
                indices[idxIdx++] = i|8;
                indices[idxIdx++] = i|4;
                indices[idxIdx++] = i|4;
                indices[idxIdx++] = i|8;
                indices[idxIdx++] = i|4|8;
            }
        }

        this.gfxBuffers = new DebugGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(colors.buffer),
            indices);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(DebugRenderer.bindingLayouts);

        let offs = template.allocateUniformBuffer(DebugProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(DebugProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.debugInstances.length; ++i) {
            this.debugInstances[i].prepareToRender(device, renderInstManager, viewerInput, this.gfxBuffers);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.gfxBuffers.destroy(device);
        for (let i = 0; i < this.debugInstances.length; ++i) {
            this.debugInstances[i].destroy(device);
        }
    }
}
