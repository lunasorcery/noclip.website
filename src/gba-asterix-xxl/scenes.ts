
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';
import { parseLVL, Version, AsterixLvl, BillboardAnim, parseBillboardAnim } from './lvl';
import { AsterixRenderer, SceneRenderer } from './render';
import { SceneContext } from '../SceneBase';
import { assert } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { BillboardAnimSet } from './render_billboard';

class AsterixSceneDesc implements Viewer.SceneDesc {
    constructor(
        public id: string,
        public level_id: string,
        public area_tex_id: string,
        public tex_scroll_id: string,
        public name: string,
        public common_tex_id: string,
        public folder: string,
        public version: Version) {
    }

    private fetchLvl(level_id: string, dataFetcher: DataFetcher): Promise<AsterixLvl> {
        return dataFetcher.fetchData(`gba-asterix-xxl/${this.folder}/${level_id}.lvl`).then((buffer) => {
            return parseLVL(buffer, this.version);
        })
    }

    private fetchTex(tex_id: string, dataFetcher: DataFetcher): Promise<ArrayBufferSlice> {
        return dataFetcher.fetchData(`gba-asterix-xxl/${this.folder}/${tex_id}.tex`);
    }

    private fetchTexScroll(tex_scroll_id: string, dataFetcher: DataFetcher): Promise<ArrayBufferSlice> {
        return dataFetcher.fetchData(`gba-asterix-xxl/${this.folder}/${tex_scroll_id}.texscroll`);
    }

    private fetchBBAnim(bb_anim_id: string, dataFetcher: DataFetcher): Promise<BillboardAnim> {
        return dataFetcher.fetchData(`gba-asterix-xxl/${this.folder}/${bb_anim_id}.bbanim`).then((buffer) => {
            return parseBillboardAnim(buffer);
        });
    }

    private fetchBBAnims(dataFetcher: DataFetcher): Promise<BillboardAnimSet> {
        if (this.version == Version.Retail) {
            return Promise.all([
                this.fetchBBAnim('0846da88', dataFetcher), // 03 Silver Helmet
                this.fetchBBAnim('0846dac8', dataFetcher), // 04 Gold Helmet
                this.fetchBBAnim('0846db08', dataFetcher), // 05 Ham
                this.fetchBBAnim('0846db48', dataFetcher), // 06 Laurel
                this.fetchBBAnim('0846db88', dataFetcher), // 07 Potion
                this.fetchBBAnim('0846da48', dataFetcher), // 08 Fire Stick
                this.fetchBBAnim('0846dbc8', dataFetcher), //    Locked Button
            ]).then(([
                animSilverHelmet,
                animGoldHelmet,
                animHam,
                animLaurel,
                animPotion,
                animFireStick,
                animLockedButton,
            ]) => {
                return {
                    animSilverHelmet,
                    animGoldHelmet,
                    animHam,
                    animLaurel,
                    animPotion,
                    animFireStick,
                    animLockedButton,
                };
            });
        } else {
            // TODO: find the billboard anim tables in the prototype builds
            return Promise.all([]).then(([]) => {
                const empty_anim: BillboardAnim = {
                    keyframes: [{
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0
                    }]
                };
                return {
                    animSilverHelmet: empty_anim,
                    animGoldHelmet: empty_anim,
                    animHam: empty_anim,
                    animLaurel: empty_anim,
                    animPotion: empty_anim,
                    animFireStick: empty_anim,
                    animLockedButton: empty_anim,
                };
            });
        }
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return Promise.all([
            this.fetchLvl(this.level_id, dataFetcher),
            this.fetchTex(this.area_tex_id, dataFetcher),
            this.fetchTex(this.common_tex_id, dataFetcher),
            this.fetchTexScroll(this.tex_scroll_id, dataFetcher),
            this.fetchBBAnims(dataFetcher),
        ]).then(([
            lvl,
            area_tex,
            common_tex,
            tex_scroll,
            bbanims
        ]) => {
            const renderer = new AsterixRenderer(device);
            {
                assert(area_tex.byteLength >= 0x20000);
                assert(common_tex.byteLength == 0x40000);
                renderer.textureHolder.addTextures(device, [
                    { name: 'tex0',    width: 256, height: 256, indices: area_tex.slice(0x00000, 0x10000),   palette: lvl.palette },
                    { name: 'tex1',    width: 256, height: 256, indices: area_tex.slice(0x10000, 0x20000),   palette: lvl.palette },
                    { name: 'tex2',    width: 256, height: 256, indices: area_tex.slice(0x20000, /*end*/),   palette: lvl.palette },
                    { name: 'common3', width: 256, height: 256, indices: common_tex.slice(0x00000, 0x10000), palette: lvl.palette },
                    { name: 'common4', width: 256, height: 256, indices: common_tex.slice(0x10000, 0x20000), palette: lvl.palette },
                    { name: 'common5', width: 256, height: 256, indices: common_tex.slice(0x20000, 0x30000), palette: lvl.palette },
                    { name: 'common6', width: 256, height: 256, indices: common_tex.slice(0x30000, 0x40000), palette: lvl.palette },
                ]);

                const sceneRenderer = new SceneRenderer(renderer.cache, renderer.textureHolder, lvl, tex_scroll, bbanims);
                renderer.sceneRenderers.push(sceneRenderer);
            }
            return renderer;
        });
    }
}

class AsterixRetailSceneDesc extends AsterixSceneDesc {
    constructor(id: string, level_id: string, area_tex_id: string, tex_scroll_id: string, name: string) {
        super(id, level_id, area_tex_id, tex_scroll_id, name, "08010000", "retail", Version.Retail);
    }
}

class AsterixProtoASceneDesc extends AsterixSceneDesc {
    constructor(id: string, level_id: string, area_tex_id: string, tex_scroll_id: string, name: string) {
        super(id, level_id, area_tex_id, tex_scroll_id, name, "087c0000", "proto-a", Version.PrototypeA);
    }
}

class AsterixProtoBSceneDesc extends AsterixSceneDesc {
    constructor(id: string, level_id: string, area_tex_id: string, tex_scroll_id: string, name: string) {
        super(id, level_id, area_tex_id, tex_scroll_id, name, "087c0000", "proto-b", Version.PrototypeB);
    }
}

class ComparisonRenderer implements Viewer.SceneGfx {
    constructor(public renderers: Viewer.SceneGfx[]) {
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const switchRateMs = 500;
        const currIdx = Math.floor((viewerInput.time / switchRateMs) % this.renderers.length);
        this.renderers[currIdx].render(device, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.renderers.length; ++i)
            this.renderers[i].destroy(device);
    }
}

class ComparisonSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public scenes: Viewer.SceneDesc[]) {
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return Promise.all(this.scenes.map(scene => scene.createScene(device, context))).then((renderers) => {
            return new ComparisonRenderer(renderers);
        });
    }
}

const levels = {
    retail: {
        gaul: {
            level1: new AsterixRetailSceneDesc("gaul-1",           "0849571c", "084a3318", "0806ec14", "Area 1"),
            level2: new AsterixRetailSceneDesc("gaul-2",           "084992b4", "084a3318", "0806ec14", "Area 2"),
            level3: new AsterixRetailSceneDesc("gaul-3",           "08628b70", "084a3318", "0806ec14", "Area 3 (Ob-sleigh)"),
            level4: new AsterixRetailSceneDesc("gaul-4",           "0849cbe9", "084a3318", "0806ec14", "Area 4"),
            level5: new AsterixRetailSceneDesc("gaul-5",           "084a028d", "084a3318", "0806ec14", "Area 5"),
            bonus1: new AsterixRetailSceneDesc("gaul-bonus-1",     "08628b70", "084a3318", "0806ec14", "Ob-sleigh 1"),
            bonus2: new AsterixRetailSceneDesc("gaul-bonus-2",     "0862ff49", "084a3318", "0806ec14", "Ob-sleigh 2"),
        },
        normandy: {
            level1: new AsterixRetailSceneDesc("normandy-1",       "084ba2a3", "084c9878", "0806ec14", "Area 1"),
            level2: new AsterixRetailSceneDesc("normandy-2",       "084be00c", "084c9878", "0806ec14", "Area 2"),
            level3: new AsterixRetailSceneDesc("normandy-3",       "084c1cb0", "084c9878", "0806ec14", "Area 3"),
            level4: new AsterixRetailSceneDesc("normandy-4",       "086375b1", "084c9878", "0806ec14", "Area 4 (Ob-sleigh)"),
            level5: new AsterixRetailSceneDesc("normandy-5",       "084c5daf", "084c9878", "0806ec14", "Area 5"),
            bonus1: new AsterixRetailSceneDesc("normandy-bonus-1", "086375b1", "084c9878", "0806ec14", "Ob-sleigh 1"),
            bonus2: new AsterixRetailSceneDesc("normandy-bonus-2", "0863ea23", "084c9878", "0806ec14", "Ob-sleigh 2"),
        },
        greece: {
            level1: new AsterixRetailSceneDesc("greece-1",         "084de843", "084ebf2c", "0806ec14", "Area 1"),
            level2: new AsterixRetailSceneDesc("greece-2",         "084e275c", "084ebf2c", "0806ec14", "Area 2"),
            level3: new AsterixRetailSceneDesc("greece-3",         "084e5bdf", "084ebf2c", "0806ec14", "Area 3"),
            level4: new AsterixRetailSceneDesc("greece-4",         "08645ed6", "084ebf2c", "0806ec14", "Area 4 (Ob-sleigh)"),
            level5: new AsterixRetailSceneDesc("greece-5",         "084e8a14", "084ebf2c", "0806ec14", "Area 5"),
            bonus1: new AsterixRetailSceneDesc("greece-bonus-1",   "08645ed6", "084ebf2c", "0806ec14", "Ob-sleigh 1"),
            bonus2: new AsterixRetailSceneDesc("greece-bonus-2",   "0864cb1c", "084ebf2c", "0806ec14", "Ob-sleigh 2"),
        },
        helvetia: {
            level1: new AsterixRetailSceneDesc("helvetia-1",       "084fd7a4", "0850c71d", "0806ec14", "Area 1"),
            level2: new AsterixRetailSceneDesc("helvetia-2",       "08501280", "0850c71d", "0806ec14", "Area 2"),
            level3: new AsterixRetailSceneDesc("helvetia-3",       "086537e6", "0850c71d", "0806ec14", "Area 3 (Ob-sleigh)"),
            level4: new AsterixRetailSceneDesc("helvetia-4",       "085052a9", "0850c71d", "0806ec14", "Area 4"),
            level5: new AsterixRetailSceneDesc("helvetia-5",       "085093ad", "0850c71d", "0806ec14", "Area 5"),
            bonus1: new AsterixRetailSceneDesc("helvetia-bonus-1", "086537e6", "0850c71d", "0806ec14", "Ob-sleigh 1"),
            bonus2: new AsterixRetailSceneDesc("helvetia-bonus-2", "0865a4c1", "0850c71d", "0806ec14", "Ob-sleigh 2"),
        },
        egypt: {
            level1: new AsterixRetailSceneDesc("egypt-1",          "0852196a", "085337d8", "0806ec50", "Area 1"),
            level2: new AsterixRetailSceneDesc("egypt-2",          "086612c1", "085337d8", "0806ec50", "Area 2 (Ob-sleigh)"),
            level3: new AsterixRetailSceneDesc("egypt-3",          "085258ae", "085337d8", "0806ec50", "Area 3"),
            level4: new AsterixRetailSceneDesc("egypt-4",          "0852941d", "085337d8", "0806ec50", "Area 4"),
            level5: new AsterixRetailSceneDesc("egypt-5",          "0852cdc1", "085337d8", "0806ec50", "Area 5"),
            level6: new AsterixRetailSceneDesc("egypt-6",          "08530802", "085337d8", "0806ec50", "Area 6"),
            bonus1: new AsterixRetailSceneDesc("egypt-bonus-1",    "086612c1", "085337d8", "0806ec14", "Ob-sleigh 1"),
            bonus2: new AsterixRetailSceneDesc("egypt-bonus-2",    "08668ba6", "085337d8", "0806ec14", "Ob-sleigh 2"),
        },
        rome: {
            level1: new AsterixRetailSceneDesc("rome-1",           "08547ddb", "08554bb2", "0806ec8c", "Area 1"),
            level2: new AsterixRetailSceneDesc("rome-2",           "0854b2fa", "08554bb2", "0806ec8c", "Area 2"),
            level3: new AsterixRetailSceneDesc("rome-3",           "0866fffd", "08554bb2", "0806ec8c", "Area 3 (Ob-sleigh)"),
            level4: new AsterixRetailSceneDesc("rome-4",           "0854e0b5", "08554bb2", "0806ec8c", "Area 4"),
            level5: new AsterixRetailSceneDesc("rome-5",           "08551b89", "08554bb2", "0806ec8c", "Area 5"),
            bonus1: new AsterixRetailSceneDesc("rome-bonus-1",     "0866fffd", "08554bb2", "0806ec8c", "Ob-sleigh 1"),
            bonus2: new AsterixRetailSceneDesc("rome-bonus-2",     "0867698a", "08554bb2", "0806ec8c", "Ob-sleigh 2"),
        },
    },
    proto_a: {
        test_area: new AsterixProtoASceneDesc("proto-a",          "087b0000", "08790000", "08004d38", "Test Area"),
    },
    proto_b: {
        gaul: {
            level1: new AsterixProtoBSceneDesc("proto-b-0846c3dc", "0846c3dc", "08478f7e", "08012cc8", "Proto Gaul 1"),
            level2: new AsterixProtoBSceneDesc("proto-b-0846fa2a", "0846fa2a", "08478f7e", "08012cc8", "Proto Gaul 2"),
            level4: new AsterixProtoBSceneDesc("proto-b-08472f3e", "08472f3e", "08478f7e", "08012cc8", "Proto Gaul 4"),
            level5: new AsterixProtoBSceneDesc("proto-b-08476251", "08476251", "08478f7e", "08012cc8", "Proto Gaul 5"),
        },
        normandy: {
            level1: new AsterixProtoBSceneDesc("proto-b-0848ff09", "0848ff09", "0849e8bb", "08012cc8", "Proto Normandy 1"),
            level2: new AsterixProtoBSceneDesc("proto-b-084937dc", "084937dc", "0849e8bb", "08012cc8", "Proto Normandy 2"),
            level3: new AsterixProtoBSceneDesc("proto-b-084971d2", "084971d2", "0849e8bb", "08012cc8", "Proto Normandy 3"),
            level5: new AsterixProtoBSceneDesc("proto-b-0849b00c", "0849b00c", "0849e8bb", "08012cc8", "Proto Normandy 5"),
        },
        greece: {
            level1: new AsterixProtoBSceneDesc("proto-b-084b2aee", "084b2aee", "084bf1fd", "08012cc8", "Proto Greece 1"),
            level2: new AsterixProtoBSceneDesc("proto-b-084b6363", "084b6363", "084bf1fd", "08012cc8", "Proto Greece 2"),
            level3: new AsterixProtoBSceneDesc("proto-b-084b93ad", "084b93ad", "084bf1fd", "08012cc8", "Proto Greece 3"),
            level5: new AsterixProtoBSceneDesc("proto-b-084bbf73", "084bbf73", "084bf1fd", "08012cc8", "Proto Greece 5"),
        },
        egypt: {
            level1: new AsterixProtoBSceneDesc("proto-b-084d0aec", "084d0aec", "084d3210", "08012d04", "Proto Egypt 1"),
        },
        test_area: new AsterixProtoBSceneDesc("proto-b-087b0000", "087b0000", "08790000", "08012cc8", "Test Area"),
    }
}

const id = "gba-asterix-xxl";
const name = "Asterix & Obelix: XXL";
const sceneDescs = [
    "Gaul",
    levels.retail.gaul.level1,
    levels.retail.gaul.level2,
    levels.retail.gaul.level3,
    levels.retail.gaul.level4,
    levels.retail.gaul.level5,
    levels.retail.gaul.bonus1,
    levels.retail.gaul.bonus2,
    "Normandy",
    levels.retail.normandy.level1,
    levels.retail.normandy.level2,
    levels.retail.normandy.level3,
    levels.retail.normandy.level4,
    levels.retail.normandy.level5,
    levels.retail.normandy.bonus1,
    levels.retail.normandy.bonus2,
    "Greece",
    levels.retail.greece.level1,
    levels.retail.greece.level2,
    levels.retail.greece.level3,
    levels.retail.greece.level4,
    levels.retail.greece.level5,
    levels.retail.greece.bonus1,
    levels.retail.greece.bonus2,
    "Helvetia",
    levels.retail.helvetia.level1,
    levels.retail.helvetia.level2,
    levels.retail.helvetia.level3,
    levels.retail.helvetia.level4,
    levels.retail.helvetia.level5,
    levels.retail.helvetia.bonus1,
    levels.retail.helvetia.bonus2,
    "Egypt",
    levels.retail.egypt.level1,
    levels.retail.egypt.level2,
    levels.retail.egypt.level3,
    levels.retail.egypt.level4,
    levels.retail.egypt.level5,
    levels.retail.egypt.level6,
    levels.retail.egypt.bonus1,
    levels.retail.egypt.bonus2,
    "Rome",
    levels.retail.rome.level1,
    levels.retail.rome.level2,
    levels.retail.rome.level3,
    levels.retail.rome.level4,
    levels.retail.rome.level5,
    levels.retail.rome.bonus1,
    levels.retail.rome.bonus2,
    "Prototype A",
    levels.proto_a.test_area,
    "Prototype B",
    levels.proto_b.gaul.level1,
    levels.proto_b.gaul.level2,
    levels.proto_b.gaul.level4,
    levels.proto_b.gaul.level5,
    levels.proto_b.normandy.level1,
    levels.proto_b.normandy.level2,
    levels.proto_b.normandy.level3,
    levels.proto_b.normandy.level5,
    levels.proto_b.greece.level1,
    levels.proto_b.greece.level2,
    levels.proto_b.greece.level3,
    levels.proto_b.greece.level5,
    levels.proto_b.egypt.level1,
    levels.proto_b.test_area,
    "Comparison",
    new ComparisonSceneDesc("compare-gaul-1", "Gaul 1", [levels.retail.gaul.level1, levels.proto_b.gaul.level1]),
    new ComparisonSceneDesc("compare-gaul-2", "Gaul 2", [levels.retail.gaul.level2, levels.proto_b.gaul.level2]),
    new ComparisonSceneDesc("compare-gaul-4", "Gaul 4", [levels.retail.gaul.level4, levels.proto_b.gaul.level4]),
    new ComparisonSceneDesc("compare-gaul-5", "Gaul 5", [levels.retail.gaul.level5, levels.proto_b.gaul.level5]),
    new ComparisonSceneDesc("compare-normandy-1", "Normandy 1", [levels.retail.normandy.level1, levels.proto_b.normandy.level1]),
    new ComparisonSceneDesc("compare-normandy-2", "Normandy 2", [levels.retail.normandy.level2, levels.proto_b.normandy.level2]),
    new ComparisonSceneDesc("compare-normandy-3", "Normandy 3", [levels.retail.normandy.level3, levels.proto_b.normandy.level3]),
    new ComparisonSceneDesc("compare-normandy-5", "Normandy 5", [levels.retail.normandy.level5, levels.proto_b.normandy.level5]),
    new ComparisonSceneDesc("compare-greece-1", "Greece 1", [levels.retail.greece.level1, levels.proto_b.greece.level1]),
    new ComparisonSceneDesc("compare-greece-2", "Greece 2", [levels.retail.greece.level2, levels.proto_b.greece.level2]),
    new ComparisonSceneDesc("compare-greece-3", "Greece 3", [levels.retail.greece.level3, levels.proto_b.greece.level3]),
    new ComparisonSceneDesc("compare-greece-5", "Greece 5", [levels.retail.greece.level5, levels.proto_b.greece.level5]),
    new ComparisonSceneDesc("compare-egpyt-1", "Egpyt 1", [levels.retail.egypt.level1, levels.proto_b.egypt.level1]),
    new ComparisonSceneDesc("compare-test-area", "Test Area", [levels.proto_a.test_area, levels.proto_b.test_area]),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
