/**
 * Component: Break Library Match API
 * Documentation: documentation/integrations/plex.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Audiobooks.BreakMatch');

/**
 * POST /api/audiobooks/[asin]/break-match
 * Manually break a library ASIN match for a book.
 * Sets asin = null and asinManuallyCleared = true so future scans don't re-link it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { asin } = await params;

        if (!asin || typeof asin !== 'string') {
          return NextResponse.json(
            { error: 'ValidationError', message: 'asin is required' },
            { status: 400 }
          );
        }

        const libraryRecord = await prisma.plexLibrary.findFirst({
          where: { asin },
        });

        if (!libraryRecord) {
          return NextResponse.json(
            { error: 'NotFound', message: 'No library record found for this ASIN' },
            { status: 404 }
          );
        }

        // Clear the ASIN and mark as manually cleared so scans don't re-link
        await prisma.plexLibrary.update({
          where: { id: libraryRecord.id },
          data: {
            asin: null,
            asinManuallyCleared: true,
          },
        });

        // Also clear plexGuid/plexLibraryId on the audiobook record if linked
        await prisma.audiobook.updateMany({
          where: { audibleAsin: asin },
          data: {
            plexGuid: null,
            plexLibraryId: null,
          },
        });

        logger.info(`Manually unlinked ASIN ${asin} from library record ${libraryRecord.id} ("${libraryRecord.title}")`);

        return NextResponse.json({ success: true, cleared: true });
      } catch (error) {
        logger.error('Failed to break match', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'ServerError', message: 'Failed to break match' },
          { status: 500 }
        );
      }
    });
  });
}
