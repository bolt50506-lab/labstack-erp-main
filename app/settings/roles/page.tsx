'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Shield, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Role, Permission } from '@/lib/types';
import { getFriendlyErrorMessage } from '@/lib/utils/errors';

type RolePermission = { role_id: string; permission_id: string };

export default function SettingsRolesPage() {
  const supabase = getSupabaseClient();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', display_name: '', description: '' });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [rRes, pRes, rpRes] = await Promise.all([
      supabase.from('roles').select('*').order('name'),
      supabase.from('permissions').select('*').order('module, action'),
      supabase.from('role_permissions').select('role_id, permission_id'),
    ]);
    if (rRes.error) toast.error(getFriendlyErrorMessage(rRes.error));
    setRoles((rRes.data as Role[]) || []);
    setPermissions((pRes.data as Permission[]) || []);
    const map: Record<string, Set<string>> = {};
    for (const rp of (rpRes.data as RolePermission[]) || []) {
      if (!map[rp.role_id]) map[rp.role_id] = new Set();
      map[rp.role_id].add(rp.permission_id);
    }
    setRolePerms(map);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const togglePermission = async (roleId: string, permId: string, checked: boolean) => {
    setUpdating(`${roleId}-${permId}`);
    if (checked) {
      const { error } = await supabase.from('role_permissions').insert({ role_id: roleId, permission_id: permId });
      if (error) { toast.error(getFriendlyErrorMessage(error)); setUpdating(null); return; }
      setRolePerms((prev) => {
        const next = { ...prev };
        if (!next[roleId]) next[roleId] = new Set();
        next[roleId].add(permId);
        return next;
      });
    } else {
      const { error } = await supabase.from('role_permissions').delete().eq('role_id', roleId).eq('permission_id', permId);
      if (error) { toast.error(getFriendlyErrorMessage(error)); setUpdating(null); return; }
      setRolePerms((prev) => {
        const next = { ...prev };
        next[roleId]?.delete(permId);
        return next;
      });
    }
    setUpdating(null);
  };

  const handleCreateRole = async () => {
    if (!newRole.name.trim() || !newRole.display_name.trim()) {
      toast.error('Role name and display name are required');
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.from('roles').insert({
      name: newRole.name.trim().toLowerCase().replace(/\s+/g, '_'),
      display_name: newRole.display_name.trim(),
      description: newRole.description.trim() || null,
      is_system: false,
    }).select().single();
    if (error) {
      toast.error(getFriendlyErrorMessage(error));
      setCreating(false);
      return;
    }
    toast.success('Custom role created');
    setNewRole({ name: '', display_name: '', description: '' });
    setShowCreate(false);
    setCreating(false);
    load();
  };

  const handleDeleteRole = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('roles').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    setDeleteOpen(false);
    if (error) {
      toast.error(getFriendlyErrorMessage(error));
      return;
    }
    toast.success('Role deleted');
    setDeleteTarget(null);
    load();
  };

  const modules = Array.from(new Set(permissions.map((p) => p.module))).sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles & Permissions</h1>
          <p className="text-muted-foreground">Manage which roles can access which modules and actions</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" /> Create Custom Role
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-4">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2">
                      {role.is_system ? <Lock className="h-5 w-5 text-primary" /> : <Shield className="h-5 w-5 text-primary" />}
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {role.display_name}
                        {role.is_system && <Badge variant="secondary">System</Badge>}
                        {!role.is_system && <Badge variant="outline">Custom</Badge>}
                      </CardTitle>
                      <CardDescription>{role.description ?? role.name}</CardDescription>
                    </div>
                  </div>
                  {!role.is_system && role.name !== 'super_admin' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => { setDeleteTarget(role); setDeleteOpen(true); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {modules.map((mod) => (
                    <div key={mod}>
                      <p className="text-sm font-medium mb-2 capitalize">{mod}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {permissions.filter((p) => p.module === mod).map((perm) => {
                          const isChecked = rolePerms[role.id]?.has(perm.id) ?? false;
                          const isSuperAdmin = role.name === 'super_admin';
                          return (
                            <label key={perm.id} className="flex items-center gap-2 rounded-lg border p-2 hover:bg-muted/50 cursor-pointer">
                              <Checkbox
                                checked={isSuperAdmin || isChecked}
                                disabled={isSuperAdmin || updating === `${role.id}-${perm.id}`}
                                onCheckedChange={(v) => togglePermission(role.id, perm.id, v === true)}
                              />
                              <span className="text-sm capitalize">{perm.action}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Custom Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Display Name *</Label>
              <Input
                value={newRole.display_name}
                onChange={(e) => setNewRole({ ...newRole, display_name: e.target.value })}
                placeholder="e.g. Lab Manager"
              />
            </div>
            <div className="space-y-2">
              <Label>Role Key (auto from display name)</Label>
              <Input
                value={newRole.name || newRole.display_name.toLowerCase().replace(/\s+/g, '_')}
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                placeholder="e.g. lab_manager"
              />
              <p className="text-xs text-muted-foreground">Used internally. Leave blank to auto-generate.</p>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={newRole.description}
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                placeholder="What this role can do"
              />
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              After creating the role, you can assign permissions using the checkboxes above, then assign it to users from the Users page.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreateRole} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Custom Role</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete the role "{deleteTarget?.display_name}"? Users assigned to this role will lose access. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteRole} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
