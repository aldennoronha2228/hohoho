import { create } from 'zustand';

export type StudioSurface = 'circuit' | 'schematic';
export const useStudioState = create<{
  surface: StudioSurface;
  setSurface: (surface: StudioSurface) => void;
}>((set) => ({ surface: 'circuit', setSurface: (surface) => set({ surface }) }));
