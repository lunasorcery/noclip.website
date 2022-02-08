
import { TextureMapping } from "../TextureHolder";
import { AsterixLvl, AsterixTriModel, AsterixObjectType, AsterixObjSolidModel, AsterixObjIntangibleModel, AsterixObjTrampoline, AsterixObjElevator, AsterixObjCrate } from "./lvl";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { nArray } from "../util";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import {AsterixTextureHolder} from "./render";
import {decodeBGR555} from "./gba_common";

class TriModelProgram extends DeviceProgram {
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
    Mat4x3 u_ModelView;
};

uniform sampler2D u_Tex0;
uniform sampler2D u_Tex1;
uniform sampler2D u_Tex2;

varying vec4 v_Color;
varying vec2 v_TexCoord;
flat varying int v_Params;

#ifdef VERT
layout(location = ${TriModelProgram.a_Position})  in vec3 a_Position;
layout(location = ${TriModelProgram.a_Color})     in vec4 a_Color;
layout(location = ${TriModelProgram.a_TexCoord0}) in vec2 a_TexCoord0;
layout(location = ${TriModelProgram.a_TexCoord1}) in float a_TexCoord1;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
    v_Color     = a_Color;
    v_TexCoord  = a_TexCoord0;
    v_Params    = int(a_TexCoord1);
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    int polyType = v_Params & 0x0F;

    const int TYPE_INVISIBLE = 0;
    const int TYPE_COLORED   = 1;
    const int TYPE_TEXTURE1  = 3;
    const int TYPE_TEXTURE2  = 4;

    if (polyType == TYPE_INVISIBLE)
    {
#ifdef SHOW_COLLISION
        // halftone effect
        t_Color = vec4(.5,0,0,0);
        ivec2 fc = ivec2(gl_FragCoord);
        if (((fc.x ^ fc.y) & 4) != 0)
        {
            discard;
        }
#else
        discard;
#endif
    }
    else if (polyType == TYPE_COLORED)
    {
        t_Color.rgb = v_Color.rgb;
    }
    else if (polyType == TYPE_TEXTURE1 || polyType == TYPE_TEXTURE2)
    {
        int texId = v_Params >> 4;
        vec2 texCoord = v_TexCoord / 256.;
        if (texId == 0) { t_Color = texture(SAMPLER_2D(u_Tex0), texCoord); }
        if (texId == 1) { t_Color = texture(SAMPLER_2D(u_Tex1), texCoord); }
        if (texId == 2) { t_Color = texture(SAMPLER_2D(u_Tex2), texCoord); }
        
        if (t_Color.a == 0.0)
            discard;
    }
    else
    {
        t_Color.rgb = vec3(1,0,1);
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
    private paramBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public indexCount: number;

    constructor(
        device: GfxDevice,
        public verts: ArrayBufferSlice,
        public colors: ArrayBufferSlice,
        public uvs: ArrayBufferSlice,
        public params: ArrayBufferSlice,
        public indices: Uint16Array) {
        this.vertBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, verts);
        this.colorBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, colors);
        this.uvBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, uvs);
        this.paramBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.Vertex, params);

        const idxData = filterDegenerateTriangleIndexBuffer(indices);
        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, idxData.buffer);
        this.indexCount = idxData.length;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: TriModelProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.S16_RGB },
            { location: TriModelProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
            { location: TriModelProgram.a_TexCoord0, bufferIndex: 2, bufferByteOffset: 0, format: GfxFormat.U8_RG },
            { location: TriModelProgram.a_TexCoord1, bufferIndex: 3, bufferByteOffset: 0, format: GfxFormat.U8_R },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x06, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x02, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x01, frequency: GfxVertexBufferFrequency.PerVertex },
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
            { buffer: this.paramBuffer, byteOffset: 0 },
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertBuffer);
        device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.uvBuffer);
        device.destroyBuffer(this.paramBuffer);
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
        const channelsPerUv = 2;
        const channelsPerParam = 1;

        let verts = new Int16Array(numPolys * vertsPerPoly * channelsPerVert);
        let colors = new Uint32Array(numPolys * vertsPerPoly);
        let uvs = new Uint8Array(numPolys * vertsPerPoly * channelsPerUv);
        let params = new Uint8Array(numPolys * vertsPerPoly * channelsPerParam);
        let indices = new Uint16Array(numPolys * indicesPerPoly);

        let vertIdx = 0;
        let colIdx = 0;
        let uvIdx = 0;
        let paramIdx = 0;
        let idxIdx = 0;
        for (let i = 0; i < numPolys; ++i) {
            const poly = model.polys[i];
            const i0 = poly.indices[0];
            const i1 = poly.indices[1];
            const i2 = poly.indices[2];

            const polyType = (poly.flags & 0xf);
            const isVisible = (polyType != 0);
            const isColored = (polyType == 1);
            const isTextured = (polyType == 3) || (polyType == 4);
            const color = isColored
                ? decodeBGR555(palette[poly.uvs[0].u])
                : 0;

            {
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
                params[paramIdx++] = poly.flags;

                verts[vertIdx++] = model.verts[i1].x;
                verts[vertIdx++] = model.verts[i1].y;
                verts[vertIdx++] = model.verts[i1].z;
                colors[colIdx++] = color;
                uvs[uvIdx++] = poly.uvs[1].u;
                uvs[uvIdx++] = poly.uvs[1].v;
                params[paramIdx++] = poly.flags;

                verts[vertIdx++] = model.verts[i2].x;
                verts[vertIdx++] = model.verts[i2].y;
                verts[vertIdx++] = model.verts[i2].z;
                colors[colIdx++] = color;
                uvs[uvIdx++] = poly.uvs[2].u;
                uvs[uvIdx++] = poly.uvs[2].v;
                params[paramIdx++] = poly.flags;
            }
        }

        this.buffers = new TriModelGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(colors.buffer),
            new ArrayBufferSlice(uvs.buffer),
            new ArrayBufferSlice(params.buffer),
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

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
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

        let offs = renderInst.allocateUniformBuffer(TriModelProgram.ub_MeshFragParams, 12);
        const d = renderInst.mapUniformBufferF32(TriModelProgram.ub_MeshFragParams);

        // no model matrix so modelview is just view
        offs += fillMatrix4x3(d, offs, viewerInput.camera.viewMatrix);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}

export class TriModelsRenderer {
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
		offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.triModelInstances.length; ++i) {
            this.triModelInstances[i].prepareToRender(device, renderInstManager, viewerInput);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.triModelInstances.length; ++i) {
            this.triModelInstances[i].destroy(device);
        }
    }
}
