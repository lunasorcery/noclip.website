
import { TextureMapping } from "../TextureHolder";
import { AsterixLvl, AsterixCommonBillboard, AsterixObjectType, AsterixObjStaticBillboard } from "./lvl";
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


class BillboardProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_TexCoord0 = 1;

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
    vec4 u_TexCoords; // { left, top, right, bottom }
    vec4 u_Size; // { width, height, _, _ }
};

uniform sampler2D u_Tex;

varying vec2 v_TexCoord;

#ifdef VERT
layout(location = ${BillboardProgram.a_Position})  in vec2 a_Position;
layout(location = ${BillboardProgram.a_TexCoord0}) in vec2 a_TexCoord;

void main() {
    vec3 localPos = vec3(a_Position * u_Size.xy, 0);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(localPos, 1.0)));
    v_TexCoord = mix(u_TexCoords.xy, u_TexCoords.zw, a_TexCoord);
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    vec2 texCoord = v_TexCoord / 256.;
    t_Color = texture(SAMPLER_2D(u_Tex), texCoord);

    if (t_Color.a == 0.0)
        discard;

    gl_FragColor = t_Color;
}
#endif
`;
}

class BillboardGfxBuffers {
    private vertBuffer: GfxBuffer;
    private uvBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(
        device: GfxDevice,
        public verts: ArrayBufferSlice,
        public uvs: ArrayBufferSlice,
        public indices: Uint16Array) {
        this.vertBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, verts);
        this.uvBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, uvs);

        const idxData = filterDegenerateTriangleIndexBuffer(indices);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: BillboardProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RG },
            { location: BillboardProgram.a_TexCoord0, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RG },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x08, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x02, frequency: GfxVertexBufferFrequency.PerVertex },
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: (GfxVertexBufferDescriptor | null)[] = [
            { buffer: this.vertBuffer, byteOffset: 0 },
            { buffer: this.uvBuffer, byteOffset: 0 },
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertBuffer);
        device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class BillboardData {
    public texId: number;
    public position: vec3;
    public size: vec3;
    public texCoords: vec4;

    constructor(device: GfxDevice, billboard: AsterixCommonBillboard) {
        this.texId = billboard.tex_id;
        this.position = vec3.fromValues(billboard.pos.x, billboard.pos.y, billboard.pos.z);
        this.size = vec3.fromValues(billboard.width, billboard.height, 0);
        this.texCoords = vec4.fromValues(billboard.left, billboard.top, billboard.right, billboard.bottom);
    }
}

class BillboardInstance {
    private gfxProgram: GfxProgram | null = null;
    private program: BillboardProgram;
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor> = {};

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, public billboardData: BillboardData) {
        this.program = new BillboardProgram();

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

        const textureNames = ['tex0', 'tex1', 'tex2', 'common3', 'common4', 'common5', 'common6'];
        fillTextureReference(this.textureMapping[0], textureNames[billboardData.texId]);

        this.megaState.frontFace = GfxFrontFaceMode.CW;
        this.megaState.cullMode = GfxCullMode.Back;
    }

    private getModelViewMatrix(localPos: vec3, viewMatrix: mat4): mat4 {
        let matLocal = mat4.create();
        mat4.fromTranslation(matLocal, localPos);

        let matModelView = mat4.create();
        mat4.mul(matModelView, viewMatrix, matLocal);

        let vecModelViewTranslation = vec3.create();
        mat4.getTranslation(vecModelViewTranslation, matModelView);

        let matOutput = mat4.create();
        mat4.fromTranslation(matOutput, vecModelViewTranslation);

        return matOutput;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, gfxBuffers: BillboardGfxBuffers) {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(gfxBuffers.inputLayout, gfxBuffers.inputState);
        renderInst.drawIndexes(gfxBuffers.indexCount);

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setMegaStateFlags(this.megaState);

        renderInst.sortKey = SORT_KEY_PROPS;

        let offs = renderInst.allocateUniformBuffer(BillboardProgram.ub_MeshFragParams, 20);
        const d = renderInst.mapUniformBufferF32(BillboardProgram.ub_MeshFragParams);

        let matModelView = this.getModelViewMatrix(this.billboardData.position, viewerInput.camera.viewMatrix);
        offs += fillMatrix4x3(d, offs, matModelView);

        // tex coords
        offs += fillVec4v(d, offs, this.billboardData.texCoords);

        // size
        offs += fillVec3v(d, offs, this.billboardData.size);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}

export class BillboardsRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 1 },
    ];

    public gfxBuffers: BillboardGfxBuffers;
    private billboardInstances: BillboardInstance[] = [];

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl) {
        this.buildGfxBuffers(cache.device);

        for (let i = 0; i < lvl.objects.length; ++i) {
            const payload = lvl.objects[i].payload;
            if (payload !== null) {
                switch (payload.type) {
                    case AsterixObjectType.StaticBillboard: {
                        const objStaticBillboard = payload as AsterixObjStaticBillboard;
                        this.addBillboard(cache, textureHolder, objStaticBillboard.billboard);
                        break;
                    }
                }
            }
        }
    }

    private buildGfxBuffers(device: GfxDevice) {
        let verts = new Float32Array(8);
        let vertIdx = 0;
        verts[vertIdx++] = -.5; verts[vertIdx++] = 1;
        verts[vertIdx++] = .5; verts[vertIdx++] = 1;
        verts[vertIdx++] = -.5; verts[vertIdx++] = 0;
        verts[vertIdx++] = .5; verts[vertIdx++] = 0;

        let uvs = new Uint8Array(8);
        let uvIdx = 0;
        uvs[uvIdx++] = 0; uvs[uvIdx++] = 0;
        uvs[uvIdx++] = 1; uvs[uvIdx++] = 0;
        uvs[uvIdx++] = 0; uvs[uvIdx++] = 1;
        uvs[uvIdx++] = 1; uvs[uvIdx++] = 1;

        let indices = new Uint16Array(6);
        let idxIdx = 0;
        indices[idxIdx++] = 0;
        indices[idxIdx++] = 1;
        indices[idxIdx++] = 2;
        indices[idxIdx++] = 2;
        indices[idxIdx++] = 1;
        indices[idxIdx++] = 3;

        this.gfxBuffers = new BillboardGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(uvs.buffer),
            indices);
    }

    private addBillboard(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, billboard: AsterixCommonBillboard) {
        const billboardData = new BillboardData(cache.device, billboard);
        const billboardInstance = new BillboardInstance(cache, textureHolder, billboardData);
        this.billboardInstances.push(billboardInstance);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(BillboardsRenderer.bindingLayouts);

        let offs = template.allocateUniformBuffer(BillboardProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(BillboardProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.billboardInstances.length; ++i) {
            this.billboardInstances[i].prepareToRender(device, renderInstManager, viewerInput, this.gfxBuffers);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.gfxBuffers.destroy(device);
        for (let i = 0; i < this.billboardInstances.length; ++i) {
            this.billboardInstances[i].destroy(device);
        }
    }
}
