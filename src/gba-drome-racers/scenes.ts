
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';
import { Zone, parseZone } from './data';
import { DromeRenderer, SceneRenderer } from './render';
import { SceneContext } from '../SceneBase';
import ArrayBufferSlice from '../ArrayBufferSlice';

class DromeSceneDesc implements Viewer.SceneDesc {
    constructor(
        public id: string,
        public file: string,
        public track_id: number,
        public name: string) {
    }

    private fetchZone(file: string, dataFetcher: DataFetcher): Promise<Zone> {
        return dataFetcher.fetchData(`gba-drome-racers/${file}`).then((buffer) => {
            return parseZone(buffer);
        })
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return Promise.all([this.fetchZone(this.file, dataFetcher)]).then(([zone]) => {
            const renderer = new DromeRenderer(device);
            renderer.textureHolder.addTextures(device, [
                { name: 'tex', width: 256, height: 256, indices: new ArrayBufferSlice(zone.texture.buffer), palette: zone.palette },
            ]);

            const sceneRenderer = new SceneRenderer(renderer.cache, renderer.textureHolder, zone, this.track_id);
            renderer.sceneRenderers.push(sceneRenderer);
            return renderer;
        });
    }
}

const id = "gba-drome-racers";
const name = "Drome Racers (GBA)";
const sceneDescs = [
	`Canyon`,
	new DromeSceneDesc('canyon_0',    'canyon.zone',    0, "Boulder Canyon"),
	new DromeSceneDesc('canyon_1',    'canyon.zone',    1, "Rocky Valley / Rocky Ravine"),
	new DromeSceneDesc('canyon_2',    'canyon.zone',    2, "Canyon Drag"),

	`Desert`,
	new DromeSceneDesc('desert_0',    'desert.zone',    0, "Desert Dash"),
	new DromeSceneDesc('desert_1',    'desert.zone',    1, "Dune Racer / Dune Crazy"),
	new DromeSceneDesc('desert_2',    'desert.zone',    2, "Desert Drag"),

	`High Speed`,
	new DromeSceneDesc('highspeed_0', 'highspeed.zone', 0, "Super Speedway"),
	new DromeSceneDesc('highspeed_1', 'highspeed.zone', 1, "Nitro Heaven / Ultimate Rush"),
	new DromeSceneDesc('highspeed_2', 'highspeed.zone', 2, "High Speed Drag"),

	`Urban`,
	new DromeSceneDesc('urban_0',     'urban.zone',     0, "Urban Raceway"),
	new DromeSceneDesc('urban_1',     'urban.zone',     1, "Urban Sprawl / Inner City"),
	new DromeSceneDesc('urban_2',     'urban.zone',     2, "Urban Drag"),

	`Mountain`,
	new DromeSceneDesc('mountain_0',  'mountain.zone',  0, "Mountain Pass"),
	new DromeSceneDesc('mountain_1',  'mountain.zone',  1, "Mountain Peril / Rocky Peak"),
	new DromeSceneDesc('mountain_2',  'mountain.zone',  2, "Mountain Drag"),

	`Ice`,
	new DromeSceneDesc('ice_0',       'ice.zone',       0, "Icy Ridge"),
	new DromeSceneDesc('ice_1',       'ice.zone',       1, "Glacier Challenge / Frozen Wastelands"),
	new DromeSceneDesc('ice_2',       'ice.zone',       2, "Ice Drag"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
