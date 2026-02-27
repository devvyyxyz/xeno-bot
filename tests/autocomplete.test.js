const autocomplete = require('../src/utils/autocomplete');

function makeInteraction(focused) {
  const calls = [];
  return {
    options: {
      getFocused: () => focused
    },
    respond: (choices) => {
      calls.push(choices);
      return Promise.resolve();
    },
    _calls: calls
  };
}

describe('shared autocomplete helper', () => {
  test('filters by focused input and responds with matching items', async () => {
    const items = [
      { id: 'classic', name: 'Classic Egg' },
      { id: 'rare', name: 'Rare Egg' },
      { id: 'gold', name: 'Golden Egg' }
    ];
    const interaction = makeInteraction('rare');
    await autocomplete(interaction, items, { map: i => ({ name: i.name, value: i.id }) });
    expect(interaction._calls.length).toBe(1);
    const choices = interaction._calls[0];
    expect(choices).toEqual([{ name: 'Rare Egg', value: 'rare' }]);
  });

  test('returns up to max results when no focus provided', async () => {
    const items = [];
    for (let i = 0; i < 30; i++) items.push({ id: `i${i}`, name: `Item ${i}` });
    const interaction = makeInteraction('');
    await autocomplete(interaction, items, { map: i => ({ name: i.name, value: i.id }), max: 25 });
    expect(interaction._calls.length).toBe(1);
    const choices = interaction._calls[0];
    expect(choices.length).toBe(25);
    expect(choices[0]).toEqual({ name: 'Item 0', value: 'i0' });
  });
});
