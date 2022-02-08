
import { TextureMapping } from "../TextureHolder";
import { AsterixLvl } from "./lvl";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { nArray } from "../util";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { AsterixTextureHolder } from "./render";
import { decodeBGR555 } from "./gba_common";
import { vec4 } from "gl-matrix";

class EnvironmentProgram extends DeviceProgram {
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
    vec4 u_TexScroll; // { scroll_x, _, _, _ }
};

uniform sampler2D u_Tex0;
uniform sampler2D u_Tex1;
uniform sampler2D u_Tex2;

varying vec4 v_Color;
varying vec2 v_TexCoord;
flat varying ivec2 v_Params;

#ifdef VERT
layout(location = ${EnvironmentProgram.a_Position})  in vec3 a_Position;
layout(location = ${EnvironmentProgram.a_Color})     in vec4 a_Color;
layout(location = ${EnvironmentProgram.a_TexCoord0}) in vec2 a_TexCoord0;
layout(location = ${EnvironmentProgram.a_TexCoord1}) in vec2 a_TexCoord1;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
    v_Color     = a_Color;
    v_TexCoord  = a_TexCoord0;
    v_Params    = ivec2(a_TexCoord1);
}
#endif

#ifdef FRAG
void main() {
    vec4 t_Color = vec4(1.0);

    int quadIdx = v_Params.x;
    int polyFlags = v_Params.y;
    int polyType = polyFlags & 0xF;

    const int TYPE_INVISIBLE = 0;
    const int TYPE_COLORED   = 1;
    const int TYPE_TEXTURE   = 3;

    if (polyType == TYPE_INVISIBLE)
    {
        discard;
    }
    else if (polyType == TYPE_COLORED)
    {
        t_Color.rgb = v_Color.rgb;
    }
    else if (polyType == TYPE_TEXTURE)
    {
        int texId = polyFlags >> 4;
        vec2 texCoord = v_TexCoord;
        if (quadIdx == 0)
        {
            texCoord.x += u_TexScroll.x;
        }
        texCoord /= 256.;
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

class EnvironmentGfxBuffers {
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
            { location: EnvironmentProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.S16_RGB },
            { location: EnvironmentProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
            { location: EnvironmentProgram.a_TexCoord0, bufferIndex: 2, bufferByteOffset: 0, format: GfxFormat.U8_RG },
            { location: EnvironmentProgram.a_TexCoord1, bufferIndex: 3, bufferByteOffset: 0, format: GfxFormat.U8_RG },
        ];
        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0x06, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x02, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x02, frequency: GfxVertexBufferFrequency.PerVertex },
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

class EnvironmentData {
    public buffers: EnvironmentGfxBuffers;

    constructor(device: GfxDevice, lvl: AsterixLvl) {
        const numCells = 12 * lvl.lvlHeader.numStrips;
        const vertsPerCell = 4;
        const channelsPerVert = 3;
        const channelsPerUv = 2;
        const channelsPerParam = 2;
        const indicesPerCell = 6;

        let verts = new Int16Array(numCells * vertsPerCell * channelsPerVert);
        let colors = new Uint32Array(numCells * vertsPerCell);
        let uvs = new Uint8Array(numCells * vertsPerCell * channelsPerUv);
        let params = new Uint8Array(numCells * vertsPerCell * channelsPerParam);
        let indices = new Uint16Array(numCells * indicesPerCell);
        let vertIdx = 0;
        let colIdx = 0;
        let uvIdx = 0;
        let paramIdx = 0;
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
                    params[paramIdx++] = quadIdx;
                    params[paramIdx++] = quad.flags;

                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].x;
                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].y;
                    verts[vertIdx++] = lvl.vertexTable[s0 * 13 + x1].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[2].u;
                    uvs[uvIdx++] = quad.uvs[2].v;
                    params[paramIdx++] = quadIdx;
                    params[paramIdx++] = quad.flags;

                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].x;
                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].y;
                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x0].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[0].u;
                    uvs[uvIdx++] = quad.uvs[0].v;
                    params[paramIdx++] = quadIdx;
                    params[paramIdx++] = quad.flags;

                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].x;
                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].y;
                    verts[vertIdx++] = lvl.vertexTable[s1 * 13 + x1].z;
                    colors[colIdx++] = color;
                    uvs[uvIdx++] = quad.uvs[1].u;
                    uvs[uvIdx++] = quad.uvs[1].v;
                    params[paramIdx++] = quadIdx;
                    params[paramIdx++] = quad.flags;
                }
            }
        }

        this.buffers = new EnvironmentGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(colors.buffer),
            new ArrayBufferSlice(uvs.buffer),
            new ArrayBufferSlice(params.buffer),
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
    private texScrollTable: number[] = [];

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, public environmentData: EnvironmentData, texScroll: Uint8Array) {
        let currTexScrollValue = 0;
        for (let i = 0; i < texScroll.byteLength && texScroll[i] != 0x80; ++i) {
            this.texScrollTable.push(currTexScrollValue);
            currTexScrollValue += texScroll[i];
        }

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

    private getTexScrollDistance(time: number): number {
        time *= 20/1000; // 20fps
        return this.texScrollTable[Math.floor(time % this.texScrollTable.length)];
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
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

        let offs = renderInst.allocateUniformBuffer(EnvironmentProgram.ub_MeshFragParams, 16);
        const d = renderInst.mapUniformBufferF32(EnvironmentProgram.ub_MeshFragParams);

        // no model matrix so modelview is just view
        offs += fillMatrix4x3(d, offs, viewerInput.camera.viewMatrix);

        offs += fillVec4v(d, offs, vec4.fromValues(this.getTexScrollDistance(viewerInput.time),0,0,0));

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
    }
}

export class EnvironmentRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 3 },
    ];

    private environmentInstance: EnvironmentInstance;

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl, texScroll: ArrayBufferSlice) {
        const environmentData = new EnvironmentData(cache.device, lvl);
        this.environmentInstance = new EnvironmentInstance(cache, textureHolder, environmentData, texScroll.createTypedArray(Uint8Array));
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(EnvironmentRenderer.bindingLayouts);

        let offs = template.allocateUniformBuffer(EnvironmentProgram.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(EnvironmentProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        this.environmentInstance.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.environmentInstance.destroy(device);
    }
}
