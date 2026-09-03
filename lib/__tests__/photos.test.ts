/**
 * The compression ladder (doc 02 §3.6).
 *
 * A real photo on the emulator comes out as a flat frame that clears the 1MB
 * budget on the first attempt, so the part worth testing — what happens when it
 * does not — never runs on a device. These cases drive the decision directly.
 *
 * The guarantee that matters most is the last one: an operator walks to a
 * location, documents it, and the area then gets cleaned. If compression cannot
 * reach the budget, the photograph still has to survive. There is no second
 * chance to take a "before".
 *
 * The `mock` prefix on the shared state is required — Jest hoists mock
 * factories above the imports and rejects any other out-of-scope reference.
 */

import { MAX_PHOTO_BYTES, storePhoto, sweepOrphanPhotos } from '../photos';

const mockState = {
  /** Bytes reported for each successive saveAsync, in order. */
  sizes: [] as number[],
  saveUris: [] as string[],
  source: { width: 4000, height: 3000 },
  saveCount: 0,
  deleted: [] as string[],
  moved: [] as { from: string; to: string }[],
  resizes: [] as { width?: number | null; height?: number | null }[],
  compressions: [] as (number | undefined)[],
  files: new Set<string>(),
  dirEntries: [] as string[],
  dirCreated: false,
};

jest.mock('expo-crypto', () => ({ randomUUID: () => 'fixed-uuid' }));

jest.mock('expo-file-system', () => {
  const join = (parts: any[]) =>
    parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/').replace(/\/{2,}/g, '/');

  class MockFile {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = join(parts);
    }
    get size(): number | null {
      const index = mockState.saveUris.indexOf(this.uri);
      return index === -1 ? 4242 : mockState.sizes[index] ?? 0;
    }
    get exists(): boolean {
      return mockState.files.has(this.uri);
    }
    delete() {
      mockState.deleted.push(this.uri);
      mockState.files.delete(this.uri);
    }
    move(destination: any) {
      mockState.moved.push({ from: this.uri, to: destination.uri });
    }
  }

  class MockDirectory {
    uri: string;
    constructor(...parts: any[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockState.dirCreated;
    }
    create() {
      mockState.dirCreated = true;
    }
    list() {
      return mockState.dirEntries.map((uri) => new MockFile(uri));
    }
  }

  return { File: MockFile, Directory: MockDirectory, Paths: { document: { uri: 'doc:' } } };
});

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => {
      const context: any = {
        resize(size: any) {
          mockState.resizes.push(size);
          return context;
        },
        async renderAsync() {
          return {
            width: mockState.source.width,
            height: mockState.source.height,
            async saveAsync({ compress }: any) {
              mockState.compressions.push(compress);
              const uri = mockState.saveUris[mockState.saveCount] ?? `overflow-${mockState.saveCount}`;
              mockState.saveCount += 1;
              mockState.files.add(uri);
              return { uri };
            },
          };
        },
      };
      return context;
    },
  },
}));

const UNDER = MAX_PHOTO_BYTES - 1;
const OVER = MAX_PHOTO_BYTES + 1;

function reset(sizes: number[], source = { width: 4000, height: 3000 }) {
  mockState.sizes = sizes;
  mockState.saveUris = sizes.map((_, i) => `tmp-rung-${i}.jpg`);
  mockState.source = source;
  mockState.saveCount = 0;
  mockState.deleted = [];
  mockState.moved = [];
  mockState.resizes = [];
  mockState.compressions = [];
  mockState.files = new Set();
  mockState.dirEntries = [];
  mockState.dirCreated = false;
}

describe('storePhoto compression ladder', () => {
  it('stops at the first attempt that fits, without spending quality it does not need', async () => {
    reset([UNDER]);
    await storePhoto('camera://original.jpg');

    // One save only: a photo already under budget must not be squeezed further,
    // because every rung costs detail the photograph exists to show.
    expect(mockState.compressions).toEqual([0.7]);
  });

  it('steps down only as far as it has to', async () => {
    reset([OVER, OVER, UNDER]);
    await storePhoto('camera://original.jpg');

    expect(mockState.compressions).toEqual([0.7, 0.5, 0.5]);
  });

  it('deletes each rejected attempt instead of leaving them behind', async () => {
    reset([OVER, OVER, UNDER]);
    await storePhoto('camera://original.jpg');

    expect(mockState.deleted).toEqual(['tmp-rung-0.jpg', 'tmp-rung-1.jpg']);
    expect(mockState.moved).toHaveLength(1);
    expect(mockState.moved[0].from).toBe('tmp-rung-2.jpg');
  });

  it('still returns the photo when nothing reaches the budget', async () => {
    // The guarantee: documentation the operator went and took is never
    // discarded for being too large. The server accepts five times this.
    reset([OVER, OVER, OVER, OVER, OVER]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await storePhoto('camera://original.jpg');

    expect(result.uri).toContain('fixed-uuid.jpg');
    expect(mockState.moved).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('scales the long edge and keeps the aspect ratio', async () => {
    reset([UNDER], { width: 4000, height: 3000 });
    await storePhoto('camera://original.jpg');

    // 4000 → 1600 is a factor of 0.4, so 3000 → 1200. A stretched photograph of
    // a floor is worse than a smaller one.
    expect(mockState.resizes[0]).toEqual({ width: 1600, height: 1200 });
  });

  it('scales portrait photos by their height, not their width', async () => {
    reset([UNDER], { width: 3000, height: 4000 });
    await storePhoto('camera://original.jpg');

    expect(mockState.resizes[0]).toEqual({ width: 1200, height: 1600 });
  });

  it('does not upscale an image that is already small', async () => {
    reset([UNDER], { width: 800, height: 600 });
    await storePhoto('camera://original.jpg');

    expect(mockState.resizes).toEqual([]);
  });
});

describe('sweepOrphanPhotos', () => {
  it('removes only files no record refers to', () => {
    reset([]);
    mockState.dirCreated = true;
    mockState.dirEntries = ['doc:/field-photos/kept.jpg', 'doc:/field-photos/orphan.jpg'];

    const removed = sweepOrphanPhotos(['doc:/field-photos/kept.jpg']);

    expect(removed).toBe(1);
    expect(mockState.deleted).toEqual(['doc:/field-photos/orphan.jpg']);
  });

  it('keeps everything when every file is referenced', () => {
    reset([]);
    mockState.dirCreated = true;
    mockState.dirEntries = ['doc:/field-photos/a.jpg', 'doc:/field-photos/b.jpg'];

    const removed = sweepOrphanPhotos(['doc:/field-photos/a.jpg', 'doc:/field-photos/b.jpg']);

    expect(removed).toBe(0);
    expect(mockState.deleted).toEqual([]);
  });

  it('ignores empty paths rather than treating them as a file to keep', () => {
    reset([]);
    mockState.dirCreated = true;
    mockState.dirEntries = ['doc:/field-photos/orphan.jpg'];

    // Records with no photo store '' — that must not accidentally protect
    // anything, nor crash the sweep.
    const removed = sweepOrphanPhotos(['', 'doc:/field-photos/kept.jpg']);

    expect(removed).toBe(1);
  });
});
