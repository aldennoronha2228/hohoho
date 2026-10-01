import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    if (args[0] === '/components-metadata.json') {
      const { readFileSync } = await import('node:fs');
      return new Response(readFileSync('public/components-metadata.json', 'utf8'));
    }
    return original(...args);
  }) as typeof fetch;
});
import { exampleProjects } from '../../data/examples';
import { currentBuildResult, recordCircuitVerification } from '../tools/buildResult';

describe('workflow report consistency', () => {
  it('keeps the LED template board and description consistent and timing explicit', () => {
    const blink = exampleProjects.find(project => project.id === 'blink-led');
    expect(blink).toBeDefined();
    expect(blink!.components.some(component => component.type === 'wokwi-arduino-uno')).toBe(true);
    expect(blink!.code.match(/delay\(1000\)/g)).toHaveLength(2);
    expect(blink!.description.toLowerCase()).not.toContain('weather');
  });
  it('does not call unavailable circuit verification a safety pass', () => {
    recordCircuitVerification(null);
    expect(currentBuildResult().circuit_checks.status).toBe('unavailable_or_not_applicable');
    expect(currentBuildResult().physical_hardware_verified).toBe(false);
  });
});
