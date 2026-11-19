/**
 * addActorItems / createWorldItems with compendium uuids and ChoiceSets.
 *
 * Agents add compendium entries by uuid instead of retyping their data, and a
 * ChoiceSet left without a selection must fail the call instead of opening a
 * Foundry dialog that blocks it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

const FEAT_UUID = 'Compendium.pf2e.feats-srd.Item.featId0000000001';
const SPELL_UUID = 'Compendium.pf2e.spells-srd.Item.spellId000000001';

function makeSource(uuid: string, data: Record<string, any>, extra: Record<string, any> = {}) {
  return { uuid, documentName: 'Item', pack: 'pf2e.feats-srd', data, ...extra };
}

let idCounter = 0;

function stubFoundry(sources: Record<string, any>) {
  idCounter = 0;
  vi.stubGlobal('fromUuid', async (uuid: string) => sources[uuid] ?? null);
  vi.stubGlobal('game', {
    ready: true,
    system: { id: 'pf2e', documentTypes: { Item: { feat: {}, spell: {}, equipment: {} } } },
    i18n: { localize: (key: string) => key },
    items: {
      fromCompendium: vi.fn((source: any) => ({
        ...structuredClone(source.data),
        folder: 'packFolderId0001',
        _stats: { compendiumSource: source.uuid },
      })),
    },
    folders: [],
  });
  vi.stubGlobal('foundry', {
    utils: {
      randomID: () => `assigned${String(++idCounter).padStart(8, '0')}`,
      mergeObject: vi.fn((target: any, source: any) => Object.assign(target, source)),
    },
  });
}

function makeActor(grantedFirst = false) {
  const createEmbeddedDocuments = vi.fn(async (_type: string, docs: any[]) => {
    const created = docs.map(doc => ({ id: doc._id, name: doc.name, type: doc.type }));
    return grantedFirst
      ? [{ id: 'grantedId0000001', name: 'Granted', type: 'feat' }, ...created]
      : created;
  });
  return { id: 'actorId000000001', name: 'Sosiel', createEmbeddedDocuments };
}

function makeDataAccess(actor: any): any {
  const dataAccess = Object.create(FoundryDataAccess.prototype);
  dataAccess.validateFoundryState = vi.fn();
  dataAccess.findActorByIdentifier = vi.fn(() => actor);
  dataAccess.auditLog = vi.fn();
  return dataAccess;
}

const choiceFeat = {
  name: 'Natural Ambition',
  type: 'feat',
  system: {
    rules: [
      {
        key: 'ChoiceSet',
        flag: 'ambition',
        prompt: 'PF2E.Prompt',
        choices: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
      { key: 'ChoiceSet', choices: [1, 2] },
    ],
  },
};

describe('FoundryDataAccess.addActorItems by compendium uuid', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates the compendium copy with overrides, a fresh id and keepId', async () => {
    stubFoundry({ [SPELL_UUID]: makeSource(SPELL_UUID, { name: 'Light', type: 'spell' }) });
    const actor = makeActor();

    await makeDataAccess(actor).addActorItems({
      actorIdentifier: 'Sosiel',
      items: [{ compendiumUuid: SPELL_UUID, overrides: { name: 'Bright Light', _id: 'nope' } }],
    });

    expect((globalThis as any).foundry.utils.mergeObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ performDeletions: true })
    );
    const [, payload, options] = actor.createEmbeddedDocuments.mock.calls[0];
    expect(payload[0]).toMatchObject({
      name: 'Bright Light',
      type: 'spell',
      _stats: { compendiumSource: SPELL_UUID },
    });
    expect(payload[0]._id).not.toBe('nope');
    expect(payload[0]).not.toHaveProperty('folder');
    expect(options).toMatchObject({ keepId: true });
  });

  it('answers ChoiceSets by flag and by rule index', async () => {
    stubFoundry({ [FEAT_UUID]: makeSource(FEAT_UUID, choiceFeat) });
    const actor = makeActor();

    await makeDataAccess(actor).addActorItems({
      actorIdentifier: 'Sosiel',
      items: [{ compendiumUuid: FEAT_UUID, selections: { ambition: 'b', '#1': 2 } }],
    });

    const rules = actor.createEmbeddedDocuments.mock.calls[0][1][0].system.rules;
    expect(rules.map((rule: any) => rule.selection)).toEqual(['b', 2]);
  });

  it('rejects an unknown ChoiceSet key and a value outside the choices', async () => {
    stubFoundry({ [FEAT_UUID]: makeSource(FEAT_UUID, choiceFeat) });
    const actor = makeActor();
    const dataAccess = makeDataAccess(actor);
    const add = (selections: Record<string, unknown>) =>
      dataAccess.addActorItems({
        actorIdentifier: 'Sosiel',
        items: [{ compendiumUuid: FEAT_UUID, selections }],
      });

    await expect(add({ nope: 'a', '#1': 1 })).rejects.toThrow();
    await expect(add({ ambition: 'c', '#1': 1 })).rejects.toThrow();
    await expect(add({ ambition: 'a', '#1': '2' })).rejects.toThrow();
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('fails with every unanswered ChoiceSet listed and creates nothing', async () => {
    stubFoundry({ [FEAT_UUID]: makeSource(FEAT_UUID, choiceFeat) });
    const actor = makeActor();

    const failure = makeDataAccess(actor).addActorItems({
      actorIdentifier: 'Sosiel',
      items: [
        { compendiumUuid: FEAT_UUID, selections: { ambition: 'a' } },
        structuredClone(choiceFeat),
      ],
    });

    await expect(failure).rejects.toThrow(/items\[0\][\s\S]*#1[\s\S]*items\[1\][\s\S]*ambition/);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('creates nothing when any entry is invalid', async () => {
    stubFoundry({
      [SPELL_UUID]: makeSource(SPELL_UUID, { name: 'Light', type: 'spell' }),
      'Compendium.pf2e.bestiary.Actor.goblin': makeSource(
        'Compendium.pf2e.bestiary.Actor.goblin',
        { name: 'Goblin', type: 'npc' },
        { documentName: 'Actor' }
      ),
      'Item.worldItem0000001': makeSource(
        'Item.worldItem0000001',
        { name: 'Ring', type: 'equipment' },
        { pack: null }
      ),
    });
    const actor = makeActor();
    const dataAccess = makeDataAccess(actor);
    const addAfterValid = (entry: unknown) =>
      dataAccess.addActorItems({
        actorIdentifier: 'Sosiel',
        items: [{ compendiumUuid: SPELL_UUID }, entry],
      });

    await expect(
      addAfterValid({ compendiumUuid: 'Compendium.pf2e.x.Item.missing' })
    ).rejects.toThrow(/items\[1\]/);
    await expect(
      addAfterValid({ compendiumUuid: 'Compendium.pf2e.bestiary.Actor.goblin' })
    ).rejects.toThrow(/items\[1\]/);
    await expect(addAfterValid({ compendiumUuid: 'Item.worldItem0000001' })).rejects.toThrow(
      /items\[1\]/
    );
    await expect(addAfterValid(null)).rejects.toThrow(/items\[1\]/);
    await expect(
      addAfterValid({ compendiumUuid: SPELL_UUID, overrides: { type: 'vehicle' } })
    ).rejects.toThrow(/items\[1\]/);
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('passes inline flags and effects through', async () => {
    stubFoundry({});
    const actor = makeActor();
    const flags = { pf2e: { rulesSelections: { x: 'y' } } };
    const effects = [{ name: 'Glow' }];

    await makeDataAccess(actor).addActorItems({
      actorIdentifier: 'Sosiel',
      items: [{ name: 'Lantern', type: 'equipment', flags, effects }],
    });

    expect(actor.createEmbeddedDocuments.mock.calls[0][1][0]).toMatchObject({ flags, effects });
  });

  it('lists only the requested items, with their source uuid', async () => {
    stubFoundry({ [SPELL_UUID]: makeSource(SPELL_UUID, { name: 'Light', type: 'spell' }) });
    const actor = makeActor(true);

    const result = await makeDataAccess(actor).addActorItems({
      actorIdentifier: 'Sosiel',
      items: [{ compendiumUuid: SPELL_UUID }, { name: 'Lantern', type: 'equipment' }],
    });

    expect(result.created.map((c: any) => c.name)).toEqual(['Light', 'Lantern']);
    expect(result.created[0].sourceUuid).toBe(SPELL_UUID);
    expect(result.created[1]).not.toHaveProperty('sourceUuid');
  });
});

describe('FoundryDataAccess.createWorldItems by compendium uuid', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function stubItemClass() {
    const createDocuments = vi.fn(async (docs: any[]) =>
      docs.map(doc => ({ id: doc._id, name: doc.name, type: doc.type }))
    );
    vi.stubGlobal('Item', { createDocuments });
    return createDocuments;
  }

  it('creates a world copy without the pack folder and without a choice check', async () => {
    stubFoundry({ [FEAT_UUID]: makeSource(FEAT_UUID, choiceFeat) });
    const createDocuments = stubItemClass();

    const result = await makeDataAccess(null).createWorldItems({
      items: [{ compendiumUuid: FEAT_UUID }],
    });

    const [payload, options] = createDocuments.mock.calls[0];
    expect(payload[0]).not.toHaveProperty('folder');
    expect(options).toMatchObject({ keepId: true });
    expect(result.created[0].sourceUuid).toBe(FEAT_UUID);
  });
});
