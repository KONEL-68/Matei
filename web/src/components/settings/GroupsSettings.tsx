import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth';

interface Group {
  id: number;
  name: string;
  description: string | null;
  position: number;
  instance_count: number;
  created_at: string;
}

interface GroupDetail extends Group {
  instances: Array<{ id: number; name: string; host: string; port: number; status: string }>;
}

interface InstanceOption {
  id: number;
  name: string;
  host: string;
  group_id: number | null;
}

interface GroupForm {
  name: string;
  description: string;
  position: number;
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await authFetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const emptyForm: GroupForm = { name: '', description: '', position: 0 };

export function GroupsSettings() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Group | null>(null);
  const [form, setForm] = useState<GroupForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);

  const { data: groups = [], isLoading } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: () => fetchJson<Group[]>('/api/groups'),
  });

  const { data: allInstances = [] } = useQuery<InstanceOption[]>({
    queryKey: ['instances-for-groups'],
    queryFn: () => fetchJson<InstanceOption[]>('/api/instances'),
  });

  const { data: expandedGroup } = useQuery<GroupDetail>({
    queryKey: ['group-detail', expandedGroupId],
    queryFn: () => fetchJson<GroupDetail>(`/api/groups/${expandedGroupId}`),
    enabled: expandedGroupId !== null,
  });

  const createMutation = useMutation({
    mutationFn: (data: GroupForm) =>
      fetchJson('/api/groups', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: GroupForm }) =>
      fetchJson(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetchJson(`/api/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['instances-for-groups'] });
      setDeleteConfirm(null);
      if (expandedGroupId === deleteConfirm) setExpandedGroupId(null);
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ groupId, instanceIds }: { groupId: number; instanceIds: number[] }) =>
      fetchJson(`/api/groups/${groupId}/instances`, {
        method: 'PUT',
        body: JSON.stringify({ instanceIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['group-detail'] });
      queryClient.invalidateQueries({ queryKey: ['instances-for-groups'] });
    },
  });

  const removeFromGroupMutation = useMutation({
    mutationFn: (instanceId: number) =>
      fetchJson(`/api/instances/${instanceId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...allInstances.find((i) => i.id === instanceId)!,
          group_id: null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['group-detail'] });
      queryClient.invalidateQueries({ queryKey: ['instances-for-groups'] });
    },
  });

  function resetForm() {
    setForm(emptyForm);
    setEditing(null);
    setShowForm(false);
  }

  function startEdit(group: Group) {
    setEditing(group);
    setForm({ name: group.name, description: group.description ?? '', position: group.position });
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  // Instances not assigned to this group (for the picker)
  const unassignedInstances = expandedGroupId
    ? allInstances.filter((i) => i.group_id !== expandedGroupId)
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Organize instances into groups for the dashboard view.
        </p>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditing(null); setForm(emptyForm); }}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Group
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
            {editing ? 'Edit Group' : 'New Group'}
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="block w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                placeholder="Production"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Position</label>
              <input
                type="number"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: parseInt(e.target.value, 10) || 0 })}
                className="block w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="block w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              placeholder="Optional description"
            />
          </div>
          <div className="mt-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={resetForm}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {editing ? 'Update' : 'Create'}
            </button>
          </div>
          {(createMutation.error || updateMutation.error) && (
            <p className="mt-2 text-sm text-red-600">{(createMutation.error ?? updateMutation.error)?.message}</p>
          )}
        </form>
      )}

      {/* Delete confirmation */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900 dark:border dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delete Group</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Instances in this group will become ungrouped. Continue?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
      ) : groups.length === 0 && !showForm ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No groups defined yet.</div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.id} className="rounded-lg border border-gray-200 dark:border-gray-700">
              {/* Group row */}
              <div className="flex items-center justify-between px-4 py-2.5">
                <button
                  onClick={() => setExpandedGroupId(expandedGroupId === g.id ? null : g.id)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`h-3.5 w-3.5 transition-transform ${expandedGroupId === g.id ? 'rotate-90' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  {g.name}
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    {g.instance_count} instance{g.instance_count !== 1 ? 's' : ''}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  {g.description && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 mr-2">{g.description}</span>
                  )}
                  <button
                    onClick={() => startEdit(g)}
                    className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(g.id)}
                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Expanded: instance list + assignment */}
              {expandedGroupId === g.id && (
                <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
                  {/* Current instances */}
                  {expandedGroup?.instances && expandedGroup.instances.length > 0 ? (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Assigned Instances</span>
                      {expandedGroup.instances.map((inst) => (
                        <div key={inst.id} className="flex items-center justify-between rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                          <span>{inst.name} <span className="text-xs text-gray-400 dark:text-gray-500">({inst.host}:{inst.port})</span></span>
                          <button
                            onClick={() => removeFromGroupMutation.mutate(inst.id)}
                            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                            title="Remove from group"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">No instances assigned.</p>
                  )}

                  {/* Add instances */}
                  {unassignedInstances.length > 0 && (
                    <div className="mt-3">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Add Instances</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {unassignedInstances.map((inst) => (
                          <button
                            key={inst.id}
                            onClick={() => assignMutation.mutate({ groupId: g.id, instanceIds: [inst.id] })}
                            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-blue-50 hover:border-blue-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-blue-950 dark:hover:border-blue-700"
                          >
                            + {inst.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
