
import * as DromeData from "./data";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxFrontFaceMode, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMegaStateDescriptor, GfxProgram, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxVertexBufferFrequency } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { fillMatrix4x3, fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { DeviceProgram } from "../Program";
import { mat4, vec3 } from "gl-matrix";

class PhysicsProgram extends DeviceProgram {
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
layout(location = ${PhysicsProgram.a_Position})  in vec3 a_Position;
layout(location = ${PhysicsProgram.a_Color})     in vec4 a_Color;

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

class PhysicsGfxBuffers {
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
            { location: PhysicsProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
            { location: PhysicsProgram.a_Color, bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.U8_RGBA_NORM },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 0x0C, frequency: GfxVertexBufferFrequency.PerVertex },
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

class PhysicsData {
    public buffers: PhysicsGfxBuffers;

    constructor(device: GfxDevice, track: DromeData.Track) {
        let numPolysTriangulated = 0;
        for (let i = 0; i < track.physics_polys.length; ++i) {
            numPolysTriangulated += (track.physics_polys[i].num_verts-2);
        }

        const channelsPerVert = 3;
        const vertsPerPoly = 3;
        const indicesPerPoly = 3;
        let verts = new Float32Array(numPolysTriangulated * vertsPerPoly * channelsPerVert);
        let colors = new Uint32Array(numPolysTriangulated * vertsPerPoly);
        let indices = new Uint16Array(numPolysTriangulated * indicesPerPoly);
        let vertIdx = 0;
        let colorIdx = 0;
        let idxIdx = 0;
        for (let i = 0; i < track.physics_polys.length; ++i) {
            const poly = track.physics_polys[i];
            for (let j = 2; j < poly.num_verts; ++j) {
                const i0 = poly.indices[0];
                const i1 = poly.indices[j-1];
                const i2 = poly.indices[j];

                const xz0 = track.physics_verts[i0];
                const xz1 = track.physics_verts[i1];
                const xz2 = track.physics_verts[i2];

                const y0 = poly.y - (poly.dydx * xz0.x) - (poly.dydz * xz0.z);
                const y1 = poly.y - (poly.dydx * xz1.x) - (poly.dydz * xz1.z);
                const y2 = poly.y - (poly.dydx * xz2.x) - (poly.dydz * xz2.z);

                const baseVert = vertIdx / channelsPerVert;
                indices[idxIdx++] = baseVert + 0;
                indices[idxIdx++] = baseVert + 1;
                indices[idxIdx++] = baseVert + 2;

                let color = 0xff000000;
                if (poly.unk1 == 1) color = 0xff0000ff; // red
                if (poly.unk1 == 4) color = 0xff00ffff; // yellow
                if (poly.unk1 == 6) color = 0xff00ff00; // green
                if (poly.unk1 == 7) color = 0xffff0000; // blue

                verts[vertIdx++] = xz0.x;
                verts[vertIdx++] = y0;
                verts[vertIdx++] = xz0.z;
                colors[colorIdx++] = color;

                verts[vertIdx++] = xz1.x;
                verts[vertIdx++] = y1;
                verts[vertIdx++] = xz1.z;
                colors[colorIdx++] = color;

                verts[vertIdx++] = xz2.x;
                verts[vertIdx++] = y2;
                verts[vertIdx++] = xz2.z;
                colors[colorIdx++] = color;
            }
        }

        this.buffers = new PhysicsGfxBuffers(
            device,
            new ArrayBufferSlice(verts.buffer),
            new ArrayBufferSlice(colors.buffer),
            indices);
    }

    public destroy(device: GfxDevice): void {
        this.buffers.destroy(device);
    }
}

export class PhysicsRenderer {
    private static readonly bindingLayouts: GfxBindingLayoutDescriptor[] = [
        { numUniformBuffers: 2, numSamplers: 0 },
    ];

    private gfxProgram: GfxProgram | null = null;
    private program: PhysicsProgram;
    private megaState: Partial<GfxMegaStateDescriptor> = {};

    private physicsData: PhysicsData;

    private scratchMat4: mat4;
    private modelMatrix: mat4;

    constructor(cache: GfxRenderCache, track: DromeData.Track) {
        this.physicsData = new PhysicsData(cache.device, track);
        this.program = new PhysicsProgram();
        this.megaState.frontFace = GfxFrontFaceMode.CCW;
        this.megaState.cullMode = GfxCullMode.Back;

        this.modelMatrix = mat4.create();
        mat4.fromScaling(this.modelMatrix, vec3.fromValues(1,-1,-1));

        this.scratchMat4 = mat4.create();
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts(PhysicsRenderer.bindingLayouts);
        renderInst.setSamplerBindingsFromTextureMappings([]);

        {
            let offs = renderInst.allocateUniformBuffer(PhysicsProgram.ub_SceneParams, 16);
            const sceneParamsMapped = renderInst.mapUniformBufferF32(PhysicsProgram.ub_SceneParams);
            offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        }

        {
            let offs = renderInst.allocateUniformBuffer(PhysicsProgram.ub_MeshFragParams, 12);
            const d = renderInst.mapUniformBufferF32(PhysicsProgram.ub_MeshFragParams);

            mat4.mul(this.scratchMat4, viewerInput.camera.viewMatrix, this.modelMatrix);
            offs += fillMatrix4x3(d, offs, this.scratchMat4);
        }

        renderInst.setInputLayoutAndState(this.physicsData.buffers.inputLayout, this.physicsData.buffers.inputState);
        renderInst.drawIndexes(this.physicsData.buffers.indexCount);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaState);

        renderInst.sortKey = makeSortKey(GfxRendererLayer.OPAQUE, this.gfxProgram.ResourceUniqueId);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.physicsData.destroy(device);
    }
}
