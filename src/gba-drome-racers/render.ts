
import { TextureHolder, LoadedTexture } from "../TextureHolder";
import * as DromeData from "./data";
import { GfxDevice, GfxFormat, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { surfaceToCanvas } from "../Common/bc_texture";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { decodeTextureData } from "./gba_common";
import { ModelsRenderer } from "./render_models"
import { SkyRenderer } from "./render_sky"
import { PhysicsRenderer } from "./render_physics"

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

export class SceneRenderer {
    private modelsRenderer: ModelsRenderer;
    private skyRenderer: SkyRenderer;
    private physicsRenderer: PhysicsRenderer | null = null;

    constructor(cache: GfxRenderCache, textureHolder: DromeTextureHolder, zone: DromeData.Zone, track_id: number, sky: Uint16Array) {
        this.modelsRenderer = new ModelsRenderer(cache, textureHolder, zone, track_id);
        this.skyRenderer = new SkyRenderer(cache, sky);
        if (zone.tracks[track_id].physics_polys.length > 0)
            this.physicsRenderer = new PhysicsRenderer(cache, zone.tracks[track_id]);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.modelsRenderer.prepareToRender(device, renderInstManager, viewerInput);
        this.skyRenderer.prepareToRender(device, renderInstManager, viewerInput);
        if (this.physicsRenderer !== null)
            this.physicsRenderer.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelsRenderer.destroy(device);
        this.skyRenderer.destroy(device);
        if (this.physicsRenderer !== null)
            this.physicsRenderer.destroy(device);
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
