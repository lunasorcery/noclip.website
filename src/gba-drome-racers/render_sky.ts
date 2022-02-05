
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxFrontFaceMode, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMegaStateDescriptor, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { decodeBGR555 } from "./gba_common";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { DeviceProgram } from "../Program";

class SkyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;

    public static ub_SceneParams = 0;

    public both = `
precision mediump float;

varying vec4 v_Color;

#ifdef VERT
layout(location = ${SkyProgram.a_Position})  in vec2 a_Position;
layout(location = ${SkyProgram.a_Color})     in vec4 a_Color;

void main() {
    gl_Position = vec4(a_Position,0,1);
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

class SkyGfxBuffers {
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
            { location: SkyProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RG },
            { location: SkyProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 0x08, frequency: GfxVertexBufferFrequency.PerVertex },
            { byteStride: 0x04, frequency: GfxVertexBufferFrequency.PerVertex },
        ];

        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        });
        const buffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.vertBuffer, byteOffset: 0 },
            { buffer: this.colorBuffer, byteOffset: 0 },
        ];
        const idxBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, idxBuffer);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertBuffer);
        if (this.colorBuffer !== null)
            device.destroyBuffer(this.colorBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

class SkyData {
    public buffers: SkyGfxBuffers;

    constructor(device: GfxDevice, sky: Uint16Array) {
        const numStrips = sky.length;
        const channelsPerVert = 2;
        const vertsPerStrip = 4;
        const indicesPerStrip = 6;
        let verts = new Float32Array(numStrips * vertsPerStrip * channelsPerVert);
        let colors = new Uint32Array(numStrips * vertsPerStrip);
        let indices = new Uint16Array(numStrips * indicesPerStrip);
        let vertIdx = 0;
        let colorIdx = 0;
        let idxIdx = 0;
        for (let i = 0; i < numStrips; ++i) {
            const colorRGB = decodeBGR555(sky[i]);

            const leftNdc = -1;
            const rightNdc = 1;
            const bottomNdc = 1 - 2 * ((i + 0) / numStrips);
            const topNdc = 1 - 2 * ((i + 1) / numStrips);

            const baseVert = i * vertsPerStrip;
            indices[idxIdx++] = baseVert + 0;
            indices[idxIdx++] = baseVert + 1;
            indices[idxIdx++] = baseVert + 2;
            indices[idxIdx++] = baseVert + 2;
            indices[idxIdx++] = baseVert + 1;
            indices[idxIdx++] = baseVert + 3;

            verts[vertIdx++] = leftNdc;
            verts[vertIdx++] = topNdc;
            colors[colorIdx++] = colorRGB;

            verts[vertIdx++] = rightNdc;
            verts[vertIdx++] = topNdc;
            colors[colorIdx++] = colorRGB;

            verts[vertIdx++] = leftNdc;
            verts[vertIdx++] = bottomNdc;
            colors[colorIdx++] = colorRGB;

            verts[vertIdx++] = rightNdc;
            verts[vertIdx++] = bottomNdc;
            colors[colorIdx++] = colorRGB;
        }

        this.buffers = new SkyGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(colors.buffer),
            indices);
    }

    public destroy(device: GfxDevice): void {
        this.buffers.destroy(device);
    }
}

export class SkyRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 0, numSamplers: 0 },
    ];

    private skyData: SkyData;
    private gfxProgram: GfxProgram | null = null;
    private program: SkyProgram;
    private megaState: Partial<GfxMegaStateDescriptor> = {};

    constructor(cache: GfxRenderCache, sky: Uint16Array) {
        this.skyData = new SkyData(cache.device, sky);

        this.program = new SkyProgram();

        this.megaState.cullMode = GfxCullMode.None;
        this.megaState.depthWrite = false;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.skyData.buffers.inputLayout, this.skyData.buffers.inputState);
        renderInst.drawIndexes(this.skyData.buffers.indexCount);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setBindingLayouts(SkyRenderer.bindingLayouts);
        renderInst.setSamplerBindingsFromTextureMappings([]);
        renderInst.setMegaStateFlags(this.megaState);

        renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.skyData.destroy(device);
    }
}
