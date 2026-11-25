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
          borderRadius: '96px',
          border: '12px solid #38BDF8',
          padding: '88px',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexWrap: 'wrap',
            borderRadius: '40px',
            overflow: 'hidden',
            border: '8px solid #38BDF8',
          }}
        >
          <div style={{ width: '50%', height: '50%', backgroundColor: '#38BDF8', display: 'flex' }} />
          <div style={{ width: '50%', height: '50%', backgroundColor: '#1E293B', display: 'flex' }} />
          <div style={{ width: '50%', height: '50%', backgroundColor: '#1E293B', display: 'flex' }} />
          <div style={{ width: '50%', height: '50%', backgroundColor: '#F8FAFC', display: 'flex' }} />
        </div>
      </div>
    ),
    { width: 512, height: 512 }
  );
}
