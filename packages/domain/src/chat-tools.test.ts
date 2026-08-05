import { describe, expect, it } from 'vitest';
import { CHAT_TOOLS, CHAT_TOOL_NAMES } from './chat-tools';

describe('CHAT_TOOLS', () => {
  it('exposes exactly the nine designed tools', () => {
    expect([...CHAT_TOOL_NAMES].sort()).toEqual([
      'create_event', 'create_reminder', 'delete_event', 'delete_reminder',
      'search_events', 'sum_spend', 'update_car', 'update_event', 'update_reminder',
    ]);
    expect(CHAT_TOOLS).toHaveLength(9);
  });

  it('gives every tool a name, a prescriptive description and an object schema', () => {
    for (const tool of CHAT_TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      // Descriptions must say WHEN to call, not just what the tool does.
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema).toHaveProperty('properties');
    }
  });

  it('has unique names', () => {
    expect(new Set(CHAT_TOOL_NAMES).size).toBe(CHAT_TOOL_NAMES.length);
  });

  it('requires an id on every update and delete tool', () => {
    for (const name of ['update_reminder', 'delete_reminder', 'update_event', 'delete_event']) {
      const tool = CHAT_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.required, name).toContain('id');
    }
  });

  it('requires cost on create_event, so a model that omits it fails fast instead of burning its retry', () => {
    // CreateEventSchema.cost is z.number().min(0) with no default, so an omitted cost is a
    // guaranteed Zod rejection. Tools are only offered on rounds 0-1 (round 2 is forced
    // tool-free), so surfacing this in the JSON Schema's `required` list — not just in Zod —
    // steers the model away from spending its one retry on a foreseeable failure.
    const tool = CHAT_TOOLS.find((t) => t.name === 'create_event');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('cost');
  });

  it('never asks the model for an owner or car identifier', () => {
    const json = JSON.stringify(CHAT_TOOLS);
    expect(json).not.toContain('ownerId');
    expect(json).not.toContain('carId');
  });
});
