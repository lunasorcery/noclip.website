
import { TextureHolder, LoadedTexture } from "../TextureHolder";
import { AsterixLvl } from "./lvl";
import { GfxDevice, GfxFormat, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import * as Viewer from "../viewer";
import { surfaceToCanvas } from "../Common/bc_texture";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxrAttachmentClearDescriptor, makeBackbufferDescSimple, pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from '../gfx/render/GfxRenderGraph';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { decodeTextureData } from "./gba_common";
import { TriModelsRenderer } from "./render_trimodel";
import { EnvironmentRenderer } from "./render_environment";
import { BillboardsRenderer } from "./render_billboard";
import { DebugRenderer } from "./render_obj_debug";
import { BoundsRenderer } from "./render_bounds";

export const SORT_KEY_ENVIRONMENT = 0x0000;
export const SORT_KEY_BOUNDS      = 0x1000;
export const SORT_KEY_PROPS       = 0x2000;

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


export class SceneRenderer {
    private environmentRenderer: EnvironmentRenderer;
    private triModelsRenderer: TriModelsRenderer;
    private billboardsRenderer: BillboardsRenderer;
    private debugRenderer: DebugRenderer;
    private boundsRenderer: BoundsRenderer;

    constructor(cache: GfxRenderCache, textureHolder: AsterixTextureHolder, lvl: AsterixLvl, tex_scroll: ArrayBufferSlice) {
        this.environmentRenderer = new EnvironmentRenderer(cache, textureHolder, lvl, tex_scroll);
        this.triModelsRenderer = new TriModelsRenderer(cache, textureHolder, lvl);
        this.billboardsRenderer = new BillboardsRenderer(cache, textureHolder, lvl);
        this.debugRenderer = new DebugRenderer(cache, textureHolder, lvl);
        this.boundsRenderer = new BoundsRenderer(cache, textureHolder, lvl);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.environmentRenderer.prepareToRender(device, renderInstManager, viewerInput);
        this.triModelsRenderer.prepareToRender(device, renderInstManager, viewerInput);
        this.billboardsRenderer.prepareToRender(device, renderInstManager, viewerInput);
        this.debugRenderer.prepareToRender(device, renderInstManager, viewerInput);
        this.boundsRenderer.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.environmentRenderer.destroy(device);
        this.triModelsRenderer.destroy(device);
        this.billboardsRenderer.destroy(device);
        this.debugRenderer.destroy(device);
        this.boundsRenderer.destroy(device);
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

    private makeDepthStencilDesc(renderInput: Viewer.ViewerRenderInput, clearDescriptor: GfxrAttachmentClearDescriptor): GfxrRenderTargetDescription {
        const desc = new GfxrRenderTargetDescription(GfxFormat.D24_S8);

        setBackbufferDescSimple(desc, renderInput);

        if (clearDescriptor !== null) {
            desc.colorClearColor = clearDescriptor.colorClearColor;
            desc.depthClearValue = clearDescriptor.depthClearValue;
            desc.stencilClearValue = clearDescriptor.stencilClearValue;
        }

        return desc;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearRenderPassDescriptor);
        const mainDepthDesc = this.makeDepthStencilDesc(viewerInput, this.clearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                passRenderer.setStencilRef(0);
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
