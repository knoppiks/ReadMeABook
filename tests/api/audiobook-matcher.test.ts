/**
 * Component: Audiobook Matcher Tests
 * Documentation: documentation/integrations/plex.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

// Works service mock — disable sibling expansion for isolated unit tests
vi.mock('@/lib/services/works.service', () => ({
  getSiblingAsins: vi.fn().mockResolvedValue(new Map()),
  persistDedupGroups: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/reported-issue.service', () => ({
  getOpenIssuesByAsins: vi.fn().mockResolvedValue(new Set()),
}));

describe('enrichAudiobookWithMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns isAvailable=true and library fields when ASIN matches a library record', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([
      {
        plexGuid: 'plex://album/123',
        plexRatingKey: '123',
        title: 'The Hobbit',
        author: 'J.R.R. Tolkien',
        asin: 'B00TEST1234',
        filePath: '/audiobooks/tolkien/the-hobbit',
      },
    ]);

    const { enrichAudiobookWithMatch } = await import('@/lib/utils/audiobook-matcher');
    const result = await enrichAudiobookWithMatch({
      asin: 'B00TEST1234',
      title: 'The Hobbit',
      author: 'J.R.R. Tolkien',
    });

    expect(result.isAvailable).toBe(true);
    expect(result.plexGuid).toBe('plex://album/123');
    expect(result.libraryMatchTitle).toBe('The Hobbit');
    expect(result.libraryMatchAuthor).toBe('J.R.R. Tolkien');
    expect(result.libraryFilePath).toBe('/audiobooks/tolkien/the-hobbit');
  });

  it('returns isAvailable=false and null library fields when no ASIN match exists', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);

    const { enrichAudiobookWithMatch } = await import('@/lib/utils/audiobook-matcher');
    const result = await enrichAudiobookWithMatch({
      asin: 'B00NOMATCH0',
      title: 'Unknown Book',
      author: 'Unknown Author',
    });

    expect(result.isAvailable).toBe(false);
    expect(result.plexGuid).toBeNull();
    expect(result.libraryMatchTitle).toBeNull();
    expect(result.libraryMatchAuthor).toBeNull();
    expect(result.libraryFilePath).toBeNull();
  });

  it('matches via ASIN embedded in plexGuid (backward compatibility)', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([
      {
        plexGuid: 'com.plexapp.agents.audible://B00LEGACY12',
        plexRatingKey: '456',
        title: 'Legacy Book',
        author: 'Some Author',
        asin: null,
        filePath: null,
      },
    ]);

    const { enrichAudiobookWithMatch } = await import('@/lib/utils/audiobook-matcher');
    const result = await enrichAudiobookWithMatch({
      asin: 'B00LEGACY12',
      title: 'Legacy Book',
      author: 'Some Author',
    });

    expect(result.isAvailable).toBe(true);
    expect(result.plexGuid).toBe('com.plexapp.agents.audible://B00LEGACY12');
    expect(result.libraryFilePath).toBeNull();
  });
});

describe('POST /api/audiobooks/[asin]/break-match', () => {
  const requireAuthMock = vi.hoisted(() => vi.fn());
  const requireAdminMock = vi.hoisted(() => vi.fn());

  vi.mock('@/lib/middleware/auth', () => ({
    requireAuth: requireAuthMock,
    requireAdmin: requireAdminMock,
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler());
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('clears ASIN and sets asinManuallyCleared=true on the matched library record', async () => {
    prismaMock.plexLibrary.findFirst.mockResolvedValue({
      id: 'lib-record-1',
      title: 'Wrongly Matched Book',
      asin: 'B00WRONG123',
    });
    prismaMock.plexLibrary.update.mockResolvedValue({});
    prismaMock.audiobook.updateMany.mockResolvedValue({ count: 0 });

    const { POST } = await import('@/app/api/audiobooks/[asin]/break-match/route');
    const request = {} as any;
    const params = Promise.resolve({ asin: 'B00WRONG123' });
    const response = await POST(request, { params });
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.cleared).toBe(true);
    expect(prismaMock.plexLibrary.update).toHaveBeenCalledWith({
      where: { id: 'lib-record-1' },
      data: { asin: null, asinManuallyCleared: true },
    });
  });

  it('returns 404 when no library record is found for the ASIN', async () => {
    prismaMock.plexLibrary.findFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/audiobooks/[asin]/break-match/route');
    const request = {} as any;
    const params = Promise.resolve({ asin: 'B00NOTFOUND' });
    const response = await POST(request, { params });

    expect(response.status).toBe(404);
  });
});
