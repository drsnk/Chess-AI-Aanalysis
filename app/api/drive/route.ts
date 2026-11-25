import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization');
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized: Missing Bearer token.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get('fileId');

  try {
    if (fileId) {
      const contentRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        {
          headers: { Authorization: token },
        }
      );

      if (!contentRes.ok) {
        const errText = await contentRes.text();
        return NextResponse.json(
          { error: `Drive read error: ${errText}` },
          { status: contentRes.status }
        );
      }

      const pgnContent = await contentRes.text();
      return NextResponse.json({ pgn: pgnContent });
    }

    const q = encodeURIComponent("trashed = false and name contains '.pgn'");
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,modifiedTime,size,description)&orderBy=modifiedTime desc&pageSize=30`,
      {
        headers: { Authorization: token },
      }
    );

    if (!listRes.ok) {
      const errData = await listRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData?.error?.message || 'Failed to list Google Drive PGN files.' },
        { status: listRes.status }
      );
    }

    const data = await listRes.json();
    return NextResponse.json({ files: data.files || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Google Drive request failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization');
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized: Missing Bearer token.' }, { status: 401 });
  }

  try {
    const { fileName, pgnContent, description, existingFileId } = await req.json();
    if (!fileName || !pgnContent) {
      return NextResponse.json(
        { error: 'fileName and pgnContent are required.' },
        { status: 400 }
      );
    }

    const cleanName = fileName.endsWith('.pgn') ? fileName : `${fileName}.pgn`;
    const metadata = {
      name: cleanName,
      mimeType: 'application/x-chess-pgn',
      description:
        description || 'Saved by GlassChess Tactician with opening blunder and tactical metadata.',
    };

    const boundary = '-------glasschess_pgn_boundary_2026';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
      pgnContent +
      closeDelim;

    const uploadUrl = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
          existingFileId
        )}?uploadType=multipart&fields=id,name,modifiedTime,size`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size';

    const uploadRes = await fetch(uploadUrl, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: token,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!uploadRes.ok) {
      const errData = await uploadRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData?.error?.message || 'Failed to upload PGN file to Google Drive.' },
        { status: uploadRes.status }
      );
    }

    const fileData = await uploadRes.json();
    return NextResponse.json({ file: fileData });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Google Drive upload failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.headers.get('Authorization');
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized: Missing Bearer token.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get('fileId');

  if (!fileId) {
    return NextResponse.json({ error: 'fileId is required.' }, { status: 400 });
  }

  try {
    const delRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: token },
      }
    );

    if (!delRes.ok && delRes.status !== 204) {
      const errText = await delRes.text();
      return NextResponse.json(
        { error: `Failed to delete file from Drive: ${errText}` },
        { status: delRes.status }
      );
    }

    return NextResponse.json({ deleted: true, fileId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Google Drive delete failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
