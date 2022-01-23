
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';
import * as LVL from './lvl';
import { AsterixRenderer, SceneRenderer } from './render';
import { SceneContext } from '../SceneBase';
import { assert, assertExists } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';

class AsterixSceneDesc implements Viewer.SceneDesc {
    constructor(
        public id: string,
        public level_id: string,
        public tex_id: string,
        public version: LVL.Version,
        public name: string) {
    }

    private fetchLvl(level_id: string, version: LVL.Version, dataFetcher: DataFetcher): Promise<LVL.AsterixLvl> {
        return dataFetcher.fetchData(`gba-asterix-xxl/${level_id}.lvl`).then((buffer) => {
            return LVL.parse(buffer, version);
        })
    }

    private fetchTex(tex_id: string, dataFetcher: DataFetcher): Promise<ArrayBufferSlice> {
        return dataFetcher.fetchData(`gba-asterix-xxl/${tex_id}.tex`);
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return Promise.all([this.fetchLvl(this.level_id, this.version, dataFetcher), this.fetchTex(this.tex_id, dataFetcher)]).then(([lvl, tex]) => {
            const renderer = new AsterixRenderer(device);
            {
                //assert(tex.byteLength == 0x29000);
                //renderer.textureHolder.addTextures(device, [
                //    //{ name: 'tex0', width: 256, height: 256, indices: tex.slice(0x00000, 0x10000), palette: lvl.palette },
                //    //{ name: 'tex1', width: 256, height: 256, indices: tex.slice(0x10000, 0x20000), palette: lvl.palette },
                //    //{ name: 'tex2', width: 256, height: 144, indices: tex.slice(0x20000, 0x29000), palette: lvl.palette },
                //    { name: 'tex', width: 256, height: 656, indices: tex.slice(0x00000, 0x29000), palette: lvl.palette },
                //]);

                assert((tex.byteLength % 256) == 0);
                renderer.textureHolder.addTextures(device, [
                    //{ name: 'tex0', width: 256, height: 256, indices: tex.slice(0x00000, 0x10000), palette: lvl.palette },
                    //{ name: 'tex1', width: 256, height: 256, indices: tex.slice(0x10000, 0x20000), palette: lvl.palette },
                    //{ name: 'tex2', width: 256, height: 144, indices: tex.slice(0x20000, 0x29000), palette: lvl.palette },
                    { name: 'tex', width: 256, height: tex.byteLength / 256, indices: tex, palette: lvl.palette },
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
    new AsterixSceneDesc("gaul-1", "0849571c", "084a3318", LVL.Version.Retail, "Area 1"),
    new AsterixSceneDesc("gaul-2", "084992b4", "084a3318", LVL.Version.Retail, "Area 2"),
    new AsterixSceneDesc("gaul-3", "08628b70", "084a3318", LVL.Version.Retail, "Area 3 (Ob-sleigh)"),
    new AsterixSceneDesc("gaul-4", "0849cbe9", "084a3318", LVL.Version.Retail, "Area 4"),
    new AsterixSceneDesc("gaul-5", "084a028d", "084a3318", LVL.Version.Retail, "Area 5"),
    new AsterixSceneDesc("gaul-bonus-1", "08628b70", "084a3318", LVL.Version.Retail, "Ob-sleigh 1"),
    new AsterixSceneDesc("gaul-bonus-2", "0862ff49", "084a3318", LVL.Version.Retail, "Ob-sleigh 2"),
    "Normandy",
    new AsterixSceneDesc("normandy-1", "084ba2a3", "084c9878", LVL.Version.Retail, "Area 1"),
    new AsterixSceneDesc("normandy-2", "084be00c", "084c9878", LVL.Version.Retail, "Area 2"),
    new AsterixSceneDesc("normandy-3", "084c1cb0", "084c9878", LVL.Version.Retail, "Area 3"),
    new AsterixSceneDesc("normandy-4", "086375b1", "084c9878", LVL.Version.Retail, "Area 4 (Ob-sleigh)"),
    new AsterixSceneDesc("normandy-5", "084c5daf", "084c9878", LVL.Version.Retail, "Area 5"),
    new AsterixSceneDesc("normandy-bonus-1", "086375b1", "084c9878", LVL.Version.Retail, "Ob-sleigh 1"),
    new AsterixSceneDesc("normandy-bonus-2", "0863ea23", "084c9878", LVL.Version.Retail, "Ob-sleigh 2"),
    "Greece",
    new AsterixSceneDesc("greece-1", "084de843", "084ebf2c", LVL.Version.Retail, "Area 1"),
    new AsterixSceneDesc("greece-2", "084e275c", "084ebf2c", LVL.Version.Retail, "Area 2"),
    new AsterixSceneDesc("greece-3", "084e5bdf", "084ebf2c", LVL.Version.Retail, "Area 3"),
    new AsterixSceneDesc("greece-4", "08645ed6", "084ebf2c", LVL.Version.Retail, "Area 4 (Ob-sleigh)"),
    new AsterixSceneDesc("greece-5", "084e8a14", "084ebf2c", LVL.Version.Retail, "Area 5"),
    new AsterixSceneDesc("greece-bonus-1", "08645ed6", "084ebf2c", LVL.Version.Retail, "Ob-sleigh 1"),
    new AsterixSceneDesc("greece-bonus-2", "0864cb1c", "084ebf2c", LVL.Version.Retail, "Ob-sleigh 2"),
    "Helvetia",
    new AsterixSceneDesc("helvetia-1", "084fd7a4", "0850c71d", LVL.Version.Retail, "Area 1"),
    new AsterixSceneDesc("helvetia-2", "08501280", "0850c71d", LVL.Version.Retail, "Area 2"),
    new AsterixSceneDesc("helvetia-3", "086537e6", "0850c71d", LVL.Version.Retail, "Area 3 (Ob-sleigh)"),
    new AsterixSceneDesc("helvetia-4", "085052a9", "0850c71d", LVL.Version.Retail, "Area 4"),
    new AsterixSceneDesc("helvetia-5", "085093ad", "0850c71d", LVL.Version.Retail, "Area 5"),
    new AsterixSceneDesc("helvetia-bonus-1", "086537e6", "0850c71d", LVL.Version.Retail, "Ob-sleigh 1"),
    new AsterixSceneDesc("helvetia-bonus-2", "0865a4c1", "0850c71d", LVL.Version.Retail, "Ob-sleigh 2"),
    "Egypt",
    new AsterixSceneDesc("egypt-1", "0852196a", "085337d8", LVL.Version.Retail, "Area 1"),
    new AsterixSceneDesc("egypt-2", "086612c1", "085337d8", LVL.Version.Retail, "Area 2 (Ob-sleigh)"),
    new AsterixSceneDesc("egypt-3", "085258ae", "085337d8", LVL.Version.Retail, "Area 3"),
    new AsterixSceneDesc("egypt-4", "0852941d", "085337d8", LVL.Version.Retail, "Area 4"),
    new AsterixSceneDesc("egypt-5", "0852cdc1", "085337d8", LVL.Version.Retail, "Area 5"),
    new AsterixSceneDesc("egypt-6", "08530802", "085337d8", LVL.Version.Retail, "Area 6"),
    new AsterixSceneDesc("egypt-bonus-1", "086612c1", "085337d8", LVL.Version.Retail, "Ob-sleigh 1"),
    new AsterixSceneDesc("egypt-bonus-2", "08668ba6", "085337d8", LVL.Version.Retail, "Ob-sleigh 2"),
    "Rome",
    new AsterixSceneDesc("rome-1", "08547ddb", "08554bb2", LVL.Version.Retail, "Area 1"),
    new AsterixSceneDesc("rome-2", "0854b2fa", "08554bb2", LVL.Version.Retail, "Area 2"),
    new AsterixSceneDesc("rome-3", "0866fffd", "08554bb2", LVL.Version.Retail, "Area 3 (Ob-sleigh)"),
    new AsterixSceneDesc("rome-4", "0854e0b5", "08554bb2", LVL.Version.Retail, "Area 4"),
    new AsterixSceneDesc("rome-5", "08551b89", "08554bb2", LVL.Version.Retail, "Area 5"),
    new AsterixSceneDesc("rome-bonus-1", "0866fffd", "08554bb2", LVL.Version.Retail, "Ob-sleigh 1"),
    new AsterixSceneDesc("rome-bonus-2", "0867698a", "08554bb2", LVL.Version.Retail, "Ob-sleigh 2"),
    "Prototype A",
    new AsterixSceneDesc("proto-a", "proto-a/087b0000", "proto-a/08790000", LVL.Version.PrototypeA, "Test Area"),
    "Prototype B",
    new AsterixSceneDesc("proto-b-0846c3dc", "proto-b/0846c3dc", "proto-b/08478f7e", LVL.Version.PrototypeB, "Proto Gaul 1"),
    new AsterixSceneDesc("proto-b-0846fa2a", "proto-b/0846fa2a", "proto-b/08478f7e", LVL.Version.PrototypeB, "Proto Gaul 2"),
    new AsterixSceneDesc("proto-b-08472f3e", "proto-b/08472f3e", "proto-b/08478f7e", LVL.Version.PrototypeB, "Proto Gaul 4"),
    new AsterixSceneDesc("proto-b-08476251", "proto-b/08476251", "proto-b/08478f7e", LVL.Version.PrototypeB, "Proto Gaul 5"),
    new AsterixSceneDesc("proto-b-0848ff09", "proto-b/0848ff09", "proto-b/0849e8bb", LVL.Version.PrototypeB, "Proto Normandy 1"),
    new AsterixSceneDesc("proto-b-084937dc", "proto-b/084937dc", "proto-b/0849e8bb", LVL.Version.PrototypeB, "Proto Normandy 2"),
    new AsterixSceneDesc("proto-b-084971d2", "proto-b/084971d2", "proto-b/0849e8bb", LVL.Version.PrototypeB, "Proto Normandy 3"),
    new AsterixSceneDesc("proto-b-0849b00c", "proto-b/0849b00c", "proto-b/0849e8bb", LVL.Version.PrototypeB, "Proto Normandy 5"),
    new AsterixSceneDesc("proto-b-084b2aee", "proto-b/084b2aee", "proto-b/084bf1fd", LVL.Version.PrototypeB, "Proto Greece 1"),
    new AsterixSceneDesc("proto-b-084b6363", "proto-b/084b6363", "proto-b/084bf1fd", LVL.Version.PrototypeB, "Proto Greece 2"),
    new AsterixSceneDesc("proto-b-084b93ad", "proto-b/084b93ad", "proto-b/084bf1fd", LVL.Version.PrototypeB, "Proto Greece 3"),
    new AsterixSceneDesc("proto-b-084bbf73", "proto-b/084bbf73", "proto-b/084bf1fd", LVL.Version.PrototypeB, "Proto Greece 5"),
    new AsterixSceneDesc("proto-b-084d0aec", "proto-b/084d0aec", "proto-b/084d3210", LVL.Version.PrototypeB, "Proto Egypt 1"),
    new AsterixSceneDesc("proto-b-087b0000", "proto-b/087b0000", "proto-b/08478f7e", LVL.Version.PrototypeB, "Test Area"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
