import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/incidents/route';
import { PATCH } from '@/app/api/incidents/[id]/route';

describe('API Route Handlers offline/unconfigured Supabase fallback & validation', () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const prevService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    if (prevUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevAnon !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevAnon;
    if (prevService !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevService;
  });

  it('GET /api/incidents returns graceful LOCAL_CACHE mode when env vars are missing', async () => {
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.configured).toBe(false);
    expect(json.mode).toBe('LOCAL_CACHE');
    expect(json.tickets).toEqual([]);
  });

  it('POST /api/incidents returns 202 LOCAL_CACHE fallback when admin credentials are absent', async () => {
    const req = new NextRequest('http://localhost/api/incidents', {
      method: 'POST',
      body: JSON.stringify({ ticketNumber: 'INC-2026-0999' }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(202);
    expect(json.synced).toBe(false);
    expect(json.mode).toBe('LOCAL_CACHE');
  });

  it('PATCH /api/incidents/[id] returns 202 LOCAL_CACHE fallback when admin credentials are absent', async () => {
    const req = new NextRequest('http://localhost/api/incidents/inc-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'RESOLVED' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'inc-1' }) });
    const json = await res.json();
    expect(res.status).toBe(202);
    expect(json.synced).toBe(false);
    expect(json.mode).toBe('LOCAL_CACHE');
  });
});
