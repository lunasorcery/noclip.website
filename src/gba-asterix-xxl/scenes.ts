
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';
import * as LVL from './lvl';
import { AsterixRenderer, SceneRenderer } from './render';
import { SceneContext } from '../SceneBase';
import { assert, assertExists } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';

class AsterixSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public tex_id: string, public name: string) {
    }

    private fetchLvl(id: string, dataFetcher: DataFetcher): Promise<LVL.AsterixLvl> {
        return dataFetcher.fetchData(`gba-asterix-xxl/${id}.lvl`).then((buffer) => {
            return LVL.parse(buffer);
        })
    }

    private fetchTex(id: string, dataFetcher: DataFetcher): Promise<ArrayBufferSlice> {
        return dataFetcher.fetchData(`gba-asterix-xxl/${this.tex_id}.tex`);
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return Promise.all([this.fetchLvl(this.id, dataFetcher), this.fetchTex(this.id, dataFetcher)]).then(([lvl, tex]) => {
            const renderer = new AsterixRenderer(device);
            {
                assert(tex.byteLength == 0x29000);
                renderer.textureHolder.addTextures(device, [
                    //{ name: 'tex0', width: 256, height: 256, indices: tex.slice(0x00000, 0x10000), palette: lvl.palette },
                    //{ name: 'tex1', width: 256, height: 256, indices: tex.slice(0x10000, 0x20000), palette: lvl.palette },
                    //{ name: 'tex2', width: 256, height: 144, indices: tex.slice(0x20000, 0x29000), palette: lvl.palette },
                    { name: 'tex', width: 256, height: 656, indices: tex.slice(0x00000, 0x29000), palette: lvl.palette },
                ]);

                const sceneRenderer = new SceneRenderer(renderer.cache, renderer.textureHolder, lvl);
                renderer.sceneRenderers.push(sceneRenderer);
            }
            return renderer;
        });
    }
}

const id = "gba-asterix-xxl";
const name = "Asterix & Obelix: XXL";
const sceneDescs = [
    "Gaul",
    new AsterixSceneDesc("gaul-1", "gaul", "Area 1"),
    //new AsterixSceneDesc("gaul-2", "gaul", "Area 2"),
    //new AsterixSceneDesc("gaul-3", "gaul", "Area 3"),
    //new AsterixSceneDesc("gaul-4", "gaul", "Area 4"),
    //new AsterixSceneDesc("gaul-5", "gaul", "Area 5"),
    //"Normandy",
    //new AsterixSceneDesc("normandy-1", "normandy", "Area 1"),
    //new AsterixSceneDesc("normandy-2", "normandy", "Area 2"),
    //new AsterixSceneDesc("normandy-3", "normandy", "Area 3"),
    //new AsterixSceneDesc("normandy-4", "normandy", "Area 4"),
    //new AsterixSceneDesc("normandy-5", "normandy", "Area 5"),
    //"Greece",
    //new AsterixSceneDesc("greece-1", "greece", "Area 1"),
    //new AsterixSceneDesc("greece-2", "greece", "Area 2"),
    //new AsterixSceneDesc("greece-3", "greece", "Area 3"),
    //new AsterixSceneDesc("greece-4", "greece", "Area 4"),
    //new AsterixSceneDesc("greece-5", "greece", "Area 5"),
    //"Helvetia",
    //new AsterixSceneDesc("helvetia-1", "helvetia", "Area 1"),
    //new AsterixSceneDesc("helvetia-2", "helvetia", "Area 2"),
    //new AsterixSceneDesc("helvetia-3", "helvetia", "Area 3"),
    //new AsterixSceneDesc("helvetia-4", "helvetia", "Area 4"),
    //new AsterixSceneDesc("helvetia-5", "helvetia", "Area 5"),
    //"Egypt",
    //new AsterixSceneDesc("egypt-1", "egypt", "Area 1"),
    //new AsterixSceneDesc("egypt-2", "egypt", "Area 2"),
    //new AsterixSceneDesc("egypt-3", "egypt", "Area 3"),
    //new AsterixSceneDesc("egypt-4", "egypt", "Area 4"),
    //new AsterixSceneDesc("egypt-5", "egypt", "Area 5"),
    //"Rome",
    //new AsterixSceneDesc("rome-1", "rome", "Area 1"),
    //new AsterixSceneDesc("rome-2", "rome", "Area 2"),
    //new AsterixSceneDesc("rome-3", "rome", "Area 3"),
    //new AsterixSceneDesc("rome-4", "rome", "Area 4"),
    //new AsterixSceneDesc("rome-5", "rome", "Area 5"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
