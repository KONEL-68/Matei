import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface User {
  id: number;
  username: string;
  role: string;
  created_at: string;
  last_login: string | null;
}

export function UsersSettings() {
  const queryClient = useQueryClient();
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [addError, setAddError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [changeNewPassword, setChangeNewPassword] = useState('');
  const [changeMsg, setChangeMsg] = useState('');

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await authFetch('/api/users');
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    },
  });

  const createUser = useMutation({
    mutationFn: async () => {
      const res = await authFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create user');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setNewUsername('');
      setNewPassword('');
      setAddError('');
    },
    onError: (err: Error) => setAddError(err.message),
  });

  const deleteUser = useMutation({
    mutationFn: async (id: number) => {
      const res = await authFetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete user');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const res = await authFetch('/api/users/me/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: changeNewPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to change password');
      }
    },
    onSuccess: () => {
      setCurrentPassword('');
      setChangeNewPassword('');
      setChangeMsg('Password changed successfully');
    },
    onError: (err: Error) => setChangeMsg(err.message),
  });

  if (isLoading) return <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* User list */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Users</h3>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Username</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Last Login</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">{u.username}</td>
                <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => { if (confirm(`Delete user "${u.username}"?`)) deleteUser.mutate(u.id); }}
                    className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add user */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Add User</h3>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="username"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="password"
            />
          </div>
          <button
            onClick={() => createUser.mutate()}
            disabled={!newUsername || !newPassword || createUser.isPending}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add User
          </button>
        </div>
        {addError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{addError}</p>}
      </div>

      {/* Change own password */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">Change Password</h3>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">New Password</label>
            <input
              type="password"
              value={changeNewPassword}
              onChange={(e) => setChangeNewPassword(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <button
            onClick={() => changePassword.mutate()}
            disabled={!currentPassword || !changeNewPassword || changePassword.isPending}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Change
          </button>
        </div>
        {changeMsg && <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{changeMsg}</p>}
      </div>
    </div>
  );
}
