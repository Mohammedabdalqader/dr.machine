// Team management for managers and admins.
//   { action: 'list' }
//   { action: 'create', email, password, full_name, role }
// There is no public sign-up: every account is created here.
import { audit, MANAGERS, type Role } from '../_shared/auth.ts';
import { userHandler } from '../_shared/handler.ts';
import { HttpError, json, readJSON, requireString } from '../_shared/http.ts';

const ROLES: Role[] = ['technician', 'engineer', 'manager', 'admin'];

export default userHandler(MANAGERS, async (req, { caller, admin }) => {
  const body = await readJSON(req);

  if (body.action === 'list') {
    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, full_name, role, language, created_at')
      .eq('company_id', caller.companyId)
      .order('created_at');
    if (error) throw error;
    const users = await Promise.all(
      profiles.map(async (p) => {
        const { data } = await admin.auth.admin.getUserById(p.id);
        return { ...p, email: data.user?.email ?? '', last_sign_in_at: data.user?.last_sign_in_at ?? null };
      }),
    );
    return json({ users });
  }

  if (body.action === 'create') {
    const email = requireString(body.email, 'email').toLowerCase();
    const password = requireString(body.password, 'password');
    const fullName = requireString(body.full_name, 'full_name');
    const role = body.role as Role;
    if (!ROLES.includes(role)) throw new HttpError(400, 'Unknown role');
    if (role === 'admin' && caller.role !== 'admin') throw new HttpError(403, 'Only an admin can create admins');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new HttpError(400, created.error.message);
    const userId = created.data.user.id;

    const { error } = await admin.from('profiles').insert({
      id: userId,
      company_id: caller.companyId,
      full_name: fullName,
      role,
      language: body.language === 'en' ? 'en' : 'ar',
    });
    if (error) {
      await admin.auth.admin.deleteUser(userId); // keep auth and profiles consistent
      throw error;
    }
    await audit(admin, caller, 'user.create', 'user', userId, { email, role });
    return json({ id: userId });
  }

  throw new HttpError(400, 'Unknown action');
});
