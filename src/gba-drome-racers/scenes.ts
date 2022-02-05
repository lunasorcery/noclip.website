
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';
import { Zone, parseZone } from './data';
import { DromeRenderer, SceneRenderer } from './render';
import { SceneContext } from '../SceneBase';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { DataStream } from './DataStream';

class DromeSceneDesc implements Viewer.SceneDesc {
    constructor(
        public id: string,
        public zone_name: string,
        public track_id: number,
        public name: string) {
    }

    private fetchZone(zone_name: string, dataFetcher: DataFetcher): Promise<Zone> {
        return dataFetcher.fetchData(`gba-drome-racers/${zone_name}.zone`).then((buffer) => {
            return parseZone(buffer);
        })
    }

    private fetchSky(zone_name: string, dataFetcher: DataFetcher): Promise<Uint16Array> {
        return dataFetcher.fetchData(`gba-drome-racers/${zone_name}.sky`).then((buffer) => {
			let sky = new Uint16Array(buffer.byteLength/2);
			let stream = new DataStream(buffer);
			for (let i = 0; i < sky.length; ++i) {
				sky[i] = stream.readUint16();
			}
			return sky;
		})
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return Promise.all([
			this.fetchZone(this.zone_name, dataFetcher),
			this.fetchSky(this.zone_name, dataFetcher),
		]).then(([zone, sky]) => {
            const renderer = new DromeRenderer(device);
            renderer.textureHolder.addTextures(device, [
                { name: 'tex', width: 256, height: 256, indices: new ArrayBufferSlice(zone.texture.buffer), palette: zone.palette },
            ]);

            const sceneRenderer = new SceneRenderer(renderer.cache, renderer.textureHolder, zone, this.track_id, sky);
            renderer.sceneRenderers.push(sceneRenderer);
            return renderer;
        });
    }
}

const id = "gba-drome-racers";
const name = "Drome Racers (GBA)";
const sceneDescs = [
	`Canyon`,
	new DromeSceneDesc('canyon_0',    'canyon',    0, "Boulder Canyon"),
	new DromeSceneDesc('canyon_1',    'canyon',    1, "Rocky Valley / Rocky Ravine"),
	new DromeSceneDesc('canyon_2',    'canyon',    2, "Canyon Drag"),

	`Desert`,
	new DromeSceneDesc('desert_0',    'desert',    0, "Desert Dash"),
	new DromeSceneDesc('desert_1',    'desert',    1, "Dune Racer / Dune Crazy"),
	new DromeSceneDesc('desert_2',    'desert',    2, "Desert Drag"),

	`High Speed`,
	new DromeSceneDesc('highspeed_0', 'highspeed', 0, "Super Speedway"),
	new DromeSceneDesc('highspeed_1', 'highspeed', 1, "Nitro Heaven / Ultimate Rush"),
	new DromeSceneDesc('highspeed_2', 'highspeed', 2, "High Speed Drag"),

	`Urban`,
	new DromeSceneDesc('urban_0',     'urban',     0, "Urban Raceway"),
	new DromeSceneDesc('urban_1',     'urban',     1, "Urban Sprawl / Inner City"),
	new DromeSceneDesc('urban_2',     'urban',     2, "Urban Drag"),

	`Mountain`,
	new DromeSceneDesc('mountain_0',  'mountain',  0, "Mountain Pass"),
	new DromeSceneDesc('mountain_1',  'mountain',  1, "Mountain Peril / Rocky Peak"),
	new DromeSceneDesc('mountain_2',  'mountain',  2, "Mountain Drag"),

	`Ice`,
	new DromeSceneDesc('ice_0',       'ice',       0, "Icy Ridge"),
	new DromeSceneDesc('ice_1',       'ice',       1, "Glacier Challenge / Frozen Wastelands"),
	new DromeSceneDesc('ice_2',       'ice',       2, "Ice Drag"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
