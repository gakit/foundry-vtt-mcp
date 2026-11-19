import { describe, expect, it, vi } from 'vitest';
import { CharacterTools } from './character.js';

const UUID = 'Compendium.pf2e.feats-srd.Item.featId0000000001';

function makeTools(query = vi.fn().mockResolvedValue({ created: [] })) {
  const logger: any = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
  const tools = new CharacterTools({ foundryClient: { query } as any, logger });
  return { tools, query };
}

function itemsSchema(tools: CharacterTools): any {
  const def = tools.getToolDefinitions().find((t: any) => t.name === 'manage-world-items') as any;
  return def.inputSchema.properties.items.items;
}

describe('manage-world-items compendium uuid entries', () => {
  it('advertises both entry forms in one flat item schema', () => {
    const schema = itemsSchema(makeTools().tools);

    for (const field of ['compendiumUuid', 'overrides', 'selections', 'name', 'effects', 'flags']) {
      expect(schema.properties[field]).toBeDefined();
    }
    expect(schema.oneOf).toBeUndefined();
    expect(schema.required).toBeUndefined();
  });

  it.each([
    ['add-to-actor', 'foundry-mcp-bridge.addActorItems', { actorIdentifier: 'Sosiel' }],
    ['create', 'foundry-mcp-bridge.createWorldItems', {}],
  ])('passes uuid and inline entries intact on %s', async (action, method, extra) => {
    const { tools, query } = makeTools();
    const uuidEntry = {
      compendiumUuid: UUID,
      overrides: { system: { level: { value: 1 } } },
      selections: { ambition: 'a' },
    };
    const inlineEntry = { name: 'Lantern', type: 'equipment', flags: { pf2e: { x: 1 } } };

    await tools.handleManageWorldItems({ action, ...extra, items: [uuidEntry, inlineEntry] });

    expect(query).toHaveBeenCalledWith(
      method,
      expect.objectContaining({ items: [uuidEntry, inlineEntry] })
    );
  });

  it.each([
    [
      'a uuid mixed with inline fields',
      { compendiumUuid: UUID, name: 'X', type: 'feat' },
      /not both/,
    ],
    [
      'selections on an inline item',
      { name: 'X', type: 'feat', selections: { a: 1 } },
      /need compendiumUuid/,
    ],
    ['an empty uuid', { compendiumUuid: '' }, /compendiumUuid/],
    ['an inline item without a type', { name: 'X' }, /name and type/],
  ])('rejects %s before calling the bridge', async (_label, entry, message) => {
    const { tools, query } = makeTools();

    await expect(
      tools.handleManageWorldItems({
        action: 'add-to-actor',
        actorIdentifier: 'Sosiel',
        items: [entry],
      })
    ).rejects.toThrow(message);
    expect(query).not.toHaveBeenCalled();
  });
});
