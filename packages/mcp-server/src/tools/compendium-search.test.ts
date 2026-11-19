import { describe, expect, it, vi } from 'vitest';
import { CompendiumTools } from './compendium.js';

const lightHit = {
  id: 'lightId000000001',
  uuid: 'Compendium.pf2e.spells-srd.Item.lightId000000001',
  name: 'Light',
  type: 'spell',
  pack: 'pf2e.spells-srd',
  packLabel: 'Spells',
};

// The game system is detected once per module (cached), so every test answers pf2e.
function makeTools(searchResults: any[] = [lightHit]) {
  const query = vi.fn(async (method: string) => {
    if (method === 'foundry-mcp-bridge.getWorldInfo') {
      return { system: { id: 'pf2e' } };
    }
    return searchResults;
  });
  const logger: any = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  logger.child = () => logger;
  const tools = new CompendiumTools({ foundryClient: { query } as any, logger });
  return { tools, query };
}

describe('search-compendium pack filter and uuid', () => {
  it('advertises packId', () => {
    const { tools } = makeTools();
    const def = tools.getToolDefinitions().find((t: any) => t.name === 'search-compendium') as any;

    expect(def.inputSchema.properties.packId).toBeDefined();
  });

  it('forwards packId to the bridge search', async () => {
    const { tools, query } = makeTools();

    await tools.handleSearchCompendium({ query: 'Light', packId: 'pf2e.spells-srd' });

    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.searchCompendium',
      expect.objectContaining({ query: 'Light', packId: 'pf2e.spells-srd' })
    );
  });

  it('keeps each hit uuid in the formatted results', async () => {
    const { tools } = makeTools();

    const result = await tools.handleSearchCompendium({ query: 'Light' });

    expect(result.results[0].uuid).toBe(lightHit.uuid);
  });
});
