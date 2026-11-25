import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0F172A',
          padding: '72px',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#1E293B',
            borderRadius: '84px',
            border: '10px solid #38BDF8',
            padding: '56px',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexWrap: 'wrap',
              borderRadius: '32px',
              overflow: 'hidden',
              border: '6px solid #38BDF8',
            }}
          >
            <div style={{ width: '50%', height: '50%', backgroundColor: '#38BDF8', display: 'flex' }} />
            <div style={{ width: '50%', height: '50%', backgroundColor: '#0F172A', display: 'flex' }} />
            <div style={{ width: '50%', height: '50%', backgroundColor: '#0F172A', display: 'flex' }} />
            <div style={{ width: '50%', height: '50%', backgroundColor: '#F8FAFC', display: 'flex' }} />
          </div>
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
