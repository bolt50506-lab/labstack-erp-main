import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return NextResponse.json({ error: 'Server not configured for user creation' }, { status: 500 });
    }

    // --- Authentication: verify the caller has a valid, current session ---
    const authHeader = req.headers.get('authorization');
    const callerToken = authHeader?.replace('Bearer ', '');
    if (!callerToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const callerRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${callerToken}` },
    });
    if (!callerRes.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const callerAuthUser = await callerRes.json();
    const callerAuthUserId = callerAuthUser?.id;
    if (!callerAuthUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- Authorization: caller must be an active app_user whose role has
    // the administration/users permission (same gate the sidebar already
    // uses to decide whether to show the Users nav item) ---
    const callerRow = await fetch(
      `${supabaseUrl}/rest/v1/app_users?auth_user_id=eq.${callerAuthUserId}&is_active=eq.true&select=id,company_id,is_active,role:roles(id,name,role_permissions(permission:permissions(module,action)))`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const callerRows = await callerRow.json();
    const caller = Array.isArray(callerRows) ? callerRows[0] : null;
    if (!caller) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const roleName = caller.role?.name;
    const permissions: { module: string; action: string }[] = (caller.role?.role_permissions ?? []).map((rp: any) => rp.permission).filter(Boolean);
    const canManageUsers = roleName === 'super_admin' || permissions.some(p => p.module === 'administration' && p.action === 'users');
    if (!canManageUsers) {
      return NextResponse.json({ error: 'You do not have permission to create users' }, { status: 403 });
    }

    const body = await req.json();
    const { email, password, full_name, phone, role_id, branch_id, company_id } = body;

    if (!email || !password || !role_id) {
      return NextResponse.json({ error: 'Email, password, and role are required' }, { status: 400 });
    }

    // --- Tenant isolation: a company admin can only create users inside
    // their own company, regardless of what company_id the client sends ---
    if (roleName !== 'super_admin' && company_id !== caller.company_id) {
      return NextResponse.json({ error: 'Cannot create a user outside your own company' }, { status: 403 });
    }

    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      }),
    });

    const authData = await authRes.json();
    if (!authRes.ok) {
      return NextResponse.json({ error: authData.msg || authData.message || 'Failed to create auth user' }, { status: authRes.status });
    }

    const userId = authData.user?.id || authData.id;
    if (!userId) {
      return NextResponse.json({ error: 'Auth user created but ID missing' }, { status: 500 });
    }

    const dbRes = await fetch(`${supabaseUrl}/rest/v1/app_users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        auth_user_id: userId,
        company_id: company_id || null,
        branch_id: branch_id || null,
        role_id,
        full_name,
        email,
        phone: phone || null,
        is_active: true,
      }),
    });

    const dbData = await dbRes.json();
    if (!dbRes.ok) {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      return NextResponse.json({ error: dbData.message || 'Failed to create user record' }, { status: dbRes.status });
    }

    return NextResponse.json({ success: true, user: dbData });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
