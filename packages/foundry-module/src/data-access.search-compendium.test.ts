/**
 * searchCompendium pack filter and entry uuids.
 *
 * Without a pack filter, a short name shared by many packs ("Light") can be cut
 * off by the global result cap before its own pack is reached.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makePack(id: string, type: string, names: string[]) {
  const entries = new Map(
    names.map((name, i) => [`${id}-${i}`, { _id: `${id}-${i}`, name, type: 'spell' }])
  );
  return {
    metadata: { id, label: id, type },
    getIndex: async () => entries,
    index: entries,
  };
}

function stubGame(packs: any[], enhancedIndex = false) {
  const byId = new Map(packs.map(p => [p.metadata.id, p]));
  vi.stubGlobal('game', {
    packs: { get: (id: string) => byId.get(id), values: () => byId.values() },
    settings: { get: () => enhancedIndex },
  });
}

function makeDataAccess(): any {
  const dataAccess = Object.create(FoundryDataAccess.prototype);
  dataAccess.moduleId = 'foundry-mcp-bridge';
  return dataAccess;
}

describe('FoundryDataAccess.searchCompendium packId', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches only the named pack', async () => {
    stubGame([
      makePack('pf2e.feats-srd', 'Item', ['Light Step']),
      makePack('pf2e.spells-srd', 'Item', ['Light']),
    ]);

    const results = await makeDataAccess().searchCompendium(
      'light',
      undefined,
      undefined,
      'pf2e.spells-srd'
    );

    expect(results.map((r: any) => r.pack)).toEqual(['pf2e.spells-srd']);
  });

  it('returns each hit with its compendium uuid', async () => {
    stubGame([makePack('pf2e.spells-srd', 'Item', ['Light'])]);

    const [hit] = await makeDataAccess().searchCompendium('light');

    expect(hit.uuid).toBe(`Compendium.pf2e.spells-srd.Item.${hit.id}`);
  });

  it('rejects an unknown pack, a Scene pack and a pack of the wrong type', async () => {
    stubGame([
      makePack('pf2e.spells-srd', 'Item', ['Light']),
      makePack('world.maps', 'Scene', ['Light House']),
    ]);
    const dataAccess = makeDataAccess();

    await expect(
      dataAccess.searchCompendium('light', undefined, undefined, 'pf2e.nope')
    ).rejects.toThrow();
    await expect(
      dataAccess.searchCompendium('light', undefined, undefined, 'world.maps')
    ).rejects.toThrow();
    await expect(
      dataAccess.searchCompendium('light', 'Actor', undefined, 'pf2e.spells-srd')
    ).rejects.toThrow();
  });

  it('passes packId to the creature index and builds actor uuids', async () => {
    stubGame([makePack('pf2e.pathfinder-bestiary', 'Actor', [])], true);
    const dataAccess = makeDataAccess();
    dataAccess.listCreaturesByCriteria = vi.fn(async () => ({
      creatures: [
        { id: 'goblinId00000001', name: 'Goblin', pack: 'pf2e.pathfinder-bestiary' },
        { id: 'orcId00000000001', name: 'Orc', pack: 'pf2e.other-bestiary' },
        { name: 'Nameless', pack: 'pf2e.pathfinder-bestiary' },
      ],
    }));

    const results = await dataAccess.searchCompendium(
      'goblin',
      'Actor',
      { creatureType: 'humanoid' },
      'pf2e.pathfinder-bestiary'
    );

    expect(dataAccess.listCreaturesByCriteria).toHaveBeenCalledWith(
      expect.objectContaining({ packId: 'pf2e.pathfinder-bestiary' })
    );
    expect(results.map((r: any) => r.name)).toEqual(['Goblin', 'Nameless']);
    expect(results[0].uuid).toBe('Compendium.pf2e.pathfinder-bestiary.Actor.goblinId00000001');
    expect(results[1].uuid).toBeUndefined();
  });
});

describe('FoundryDataAccess.listCreaturesByCriteria packId', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('filters by pack before the limit', async () => {
    stubGame([], true);
    const dataAccess = makeDataAccess();
    const lowLevel = Array.from({ length: 3 }, (_, i) => ({
      id: `low${i}`,
      name: `Low ${i}`,
      type: 'npc',
      level: 0,
      pack: 'pf2e.big-bestiary',
    }));
    const target = { id: 'high', name: 'High', type: 'npc', level: 20, pack: 'pf2e.small-pack' };
    dataAccess.persistentIndex = { getEnhancedIndex: async () => [...lowLevel, target] };

    const result = await dataAccess.listCreaturesByCriteria({
      packId: 'pf2e.small-pack',
      limit: 2,
    });

    expect(result.creatures.map((c: any) => c.name)).toEqual(['High']);
  });
});
